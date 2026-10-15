'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')

async function downloadAsset (options) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, 30000)
  timer.unref()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  try { return await transfer({ ...options, signal: controller.signal }) } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

async function transfer ({ root, entry, url, fetcher = fetch, signal }) {
  const source = new URL(url)
  if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Content source must use HTTPS without credentials')
  if (!entry || typeof entry.file !== 'string' || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(entry.file) || entry.file.split('/').some(p => p === '.' || p === '..') || !/^[a-f0-9]{40}$/.test(entry.sha)) throw new Error('Invalid content entry')
  const filename = path.join(root, 'assets', ...entry.file.split('/'))
  const response = await fetcher(source.href, { signal, redirect: 'error' })
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Content HTTP ${response.status}`) }
  const declared = response.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 64 * 1024 * 1024)) { await response.body.cancel(); throw new Error('Content size limit exceeded') }
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const temporary = filename + '.' + randomBytes(8).toString('hex') + '.part'
  try {
    const output = await fs.open(temporary, 'wx')
    const hash = createHash('sha1')
    let size = 0
    try {
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > 64 * 1024 * 1024) throw new Error('Content size limit exceeded')
        hash.update(chunk)
        await output.writeFile(chunk)
      }
    } finally { await output.close() }
    if ((declared && size !== Number(declared)) || hash.digest('hex') !== entry.sha) throw new Error('Downloaded asset fingerprint mismatch')
    // Never overwrite a local file, including one another worker just created.
    try { await fs.link(temporary, filename) } catch (error) {
      if (error.code !== 'EEXIST' || createHash('sha1').update(await fs.readFile(filename)).digest('hex') !== entry.sha) throw error
    }
    return size
  } finally { await fs.rm(temporary, { force: true }) }
}

module.exports = { downloadAsset }
