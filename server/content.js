'use strict'
const http = require('node:http')
const fs = require('node:fs/promises')
const { constants, createReadStream } = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { downloadAsset } = require('./content-download')

const fingerprintSha = '8f3a0350bb1c87f1676dc4571fd5a84cf6afe5dc'
const contentVersion = '3.1945.13'
const fingerprintManifestSha256 = '89d48ec5e1eb9b68153960844dc013fbb636858eb1424ea7252f80d8a9717e52'
const assetName = name => typeof name === 'string' && name.length < 240 && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(name) && !name.split('/').some(part => part === '.' || part === '..')

function contentUrl (value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || ['0.0.0.0', '::', '[::]'].includes(url.hostname)) throw new Error('Invalid CONTENT_URL')
  return url.href.replace(/\/$/, '')
}

async function loadContent ({ root = path.resolve(__dirname, '../content'), logger = () => {}, upstream = null, fetcher = fetch } = {}) {
  if (upstream) {
    upstream = contentUrl(upstream)
    if (new URL(upstream).protocol !== 'https:') throw new Error('CONTENT_UPSTREAM_URL must use HTTPS')
  }
  root = await fs.realpath(root)
  const bytes = await fs.readFile(path.join(root, 'fingerprint.json'))
  if (createHash('sha256').update(bytes).digest('hex') !== fingerprintManifestSha256) throw new Error('Content manifest hash does not match the supplied APK')
  const manifest = JSON.parse(bytes.toString('utf8'))
  if (manifest.sha !== fingerprintSha || manifest.version !== contentVersion || !Array.isArray(manifest.files) || manifest.files.length !== 1200) throw new Error('Content fingerprint does not match this APK')
  const entries = new Map()
  for (const entry of manifest.files) {
    if (!assetName(entry.file) || !/^[a-f0-9]{40}$/.test(entry.sha) || entries.has(entry.file)) throw new Error('Invalid content manifest entry')
    entries.set(entry.file, { sha: entry.sha, signature: null })
  }
  async function open (name) {
    const entry = entries.get(name)
    if (!entry) return null
    const filename = path.join(root, 'assets', ...name.split('/'))
    let file
    try {
      const resolved = await fs.realpath(filename)
      if (!resolved.startsWith(root + path.sep + 'assets' + path.sep)) throw new Error('Asset escapes content root')
      file = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('Invalid asset file')
      const signature = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
      if (entry.signature !== signature) {
        const hash = createHash('sha1')
        for await (const chunk of file.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk)
        if (hash.digest('hex') !== entry.sha) throw new Error('Asset fingerprint mismatch')
        entry.signature = signature
      }
      return { file, size: stat.size, sha: entry.sha }
    } catch (error) {
      await file?.close()
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
  const missing = []
  for (const name of entries.keys()) {
    const asset = await open(name)
    if (!asset) missing.push(name)
    else await asset.file.close()
  }
  const pending = new Map()
  let active = 0
  const waiting = []
  const controllers = new Set()
  let stopped = false
  const restore = async name => {
    if (stopped || !upstream || !entries.has(name)) return false
    if (pending.has(name)) return pending.get(name)
    if (pending.size >= 64) return false
    const run = async () => {
      const controller = new AbortController()
      controllers.add(controller)
      if (active >= 4) await new Promise(resolve => waiting.push(resolve))
      active++
      try { return await downloadAsset({ root, entry: { file: name, sha: entries.get(name).sha }, url: upstream + '/' + fingerprintSha + '/' + name, fetcher, signal: controller.signal }) } finally { controllers.delete(controller); active--; waiting.shift()?.() }
    }
    const work = run().then(bytes => {
      logger({ event: 'content-downloaded', file: name, bytes })
      return true
    }).catch(error => { logger({ event: 'content-download-failed', file: name, error: error.message }); return false }).finally(() => pending.delete(name))
    pending.set(name, work)
    return work
  }
  const close = () => { stopped = true; for (const controller of controllers) controller.abort() }
  return { manifest, bytes, entries, missing, open, restore, close, logger }
}

function byteRange (header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null
  return { start, end, partial: true }
}

function createContentServer (content) {
  const server = http.createServer((request, response) => {
    // Include rejected routes in diagnostics, without retaining raw paths,
    // query strings, client addresses or headers.
    const receipt = { event: 'content-http-response', method: ['GET', 'HEAD'].includes(request.method) ? request.method : 'OTHER', route: 'unrecognized' }
    response.once('finish', () => content.logger({ ...receipt, status: response.statusCode }))
    const run = async () => {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return }
      let route
      try { route = decodeURIComponent(request.url.split('?')[0]) } catch (_) { response.writeHead(400); response.end(); return }
      if (route.includes('\\') || route.includes('\0') || route.split('/').some(part => part === '.' || part === '..')) { response.writeHead(400); response.end(); return }
      let name = route.slice(1)
      if (name.startsWith(fingerprintSha + '/')) name = name.slice(41)
      if (name === 'fingerprint.json') {
        receipt.route = 'fingerprint'
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': content.bytes.length, 'Cache-Control': 'public, max-age=31536000, immutable' })
        response.end(request.method === 'HEAD' ? undefined : content.bytes)
        return
      }
      // Some download paths carry the individual file digest as their prefix.
      if (/^[a-f0-9]{40}\//.test(name)) {
        const sha = name.slice(0, 40)
        name = name.slice(41)
        if (content.entries.get(name)?.sha !== sha) { response.writeHead(404); response.end(); return }
      }
      if (!assetName(name) || !content.entries.has(name)) { response.writeHead(404); response.end(); return }
      receipt.route = 'asset'; receipt.file = name
      let asset = await content.open(name)
      if (!asset && await content.restore(name)) asset = await content.open(name)
      if (!asset) {
        content.logger({ event: 'content-file-missing', file: name })
        response.writeHead(404); response.end(); return
      }
      let streaming = false
      try {
        const etag = '"' + asset.sha + '"'
        const headers = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable' }
        if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return }
        const range = byteRange(!request.headers['if-range'] || request.headers['if-range'] === etag ? request.headers.range : null, asset.size)
        if (!range) { response.writeHead(416, { 'Content-Range': `bytes */${asset.size}` }); response.end(); return }
        const size = range.end - range.start + 1
        if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${asset.size}`
        response.writeHead(range.partial ? 206 : 200, { ...headers, 'Content-Length': size })
        content.logger({ event: 'content-file-served', file: name, bytes: size, partial: range.partial })
        if (request.method === 'HEAD' || size === 0) { response.end(); return }
        const stream = createReadStream('', { fd: asset.file.fd, autoClose: false, start: range.start, end: range.end })
        streaming = true
        const close = () => { stream.destroy(); asset.file.close().catch(() => {}) }
        response.once('close', close)
        stream.once('error', () => response.destroy())
        stream.pipe(response)
      } finally { if (!streaming) await asset.file.close() }
    }
    run().catch(() => {
      content.logger({ event: 'content-file-error', reason: 'Asset unavailable or failed fingerprint verification' })
      if (response.headersSent) response.destroy()
      else { response.writeHead(503); response.end() }
    })
  })
  server.on('clientError', (error, socket) => {
    if (error.code === 'ECONNRESET') { socket.destroy(); return }
    content.logger({ event: 'content-http-invalid', reason: 'Invalid HTTP request; use HTTP on the local content port or a separate trusted HTTPS endpoint' })
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  })
  server.maxConnections = 64
  server.requestTimeout = 30000
  server.headersTimeout = 10000
  return server
}

module.exports = { loadContent, createContentServer, contentUrl, byteRange, fingerprintSha, contentVersion, fingerprintManifestSha256, assetName }
