'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { assetName, fingerprintSha, contentVersion, contentUrl, fingerprintManifestSha256 } = require('../server/content')
const { downloadAsset } = require('../server/content-download')

async function fetchContent ({ root = path.resolve(__dirname, '../content'), baseUrl, concurrency = 4, fetcher = fetch, logger = () => {} }) {
  baseUrl = contentUrl(baseUrl)
  if (new URL(baseUrl).protocol !== 'https:') throw new Error('Content source must use HTTPS')
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Invalid download concurrency')
  const bytes = await fs.readFile(path.join(root, 'fingerprint.json'))
  if (createHash('sha256').update(bytes).digest('hex') !== fingerprintManifestSha256) throw new Error('Content manifest hash mismatch')
  const manifest = JSON.parse(bytes.toString('utf8'))
  if (manifest.sha !== fingerprintSha || manifest.version !== contentVersion || !Array.isArray(manifest.files)) throw new Error('Wrong content fingerprint')
  if (manifest.files.some(r => !assetName(r.file) || !/^[a-f0-9]{40}$/.test(r.sha))) throw new Error('Invalid content entry')
  let cursor = 0; let downloaded = 0; let present = 0
  const failures = []
  const worker = async () => {
    while (cursor < manifest.files.length) {
      const entry = manifest.files[cursor++]
      const filename = path.join(root, 'assets', ...entry.file.split('/'))
      try {
        try {
          const raw = await fs.readFile(filename)
          if (createHash('sha1').update(raw).digest('hex') === entry.sha) { present++; continue }
          throw new Error('Existing content failed its hash; preserve it for inspection')
        } catch (error) { if (error.code !== 'ENOENT') throw error }
        const url = baseUrl + '/' + fingerprintSha + '/' + entry.file
        const size = await downloadAsset({ root, entry, url, fetcher })
        downloaded++
        logger({ event: 'content-downloaded', file: entry.file, bytes: size })
      } catch (error) { failures.push({ file: entry.file, error: error.message }); logger({ event: 'content-download-failed', file: entry.file, error: error.message }) }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return { present, downloaded, failures }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--base-url') throw new Error('Usage: node tools/fetch-content.js --base-url https://CONTENT-SOURCE')
  fetchContent({ baseUrl: args[1], logger: entry => console.log(JSON.stringify(entry)) }).then(result => {
    console.log(JSON.stringify({ present: result.present, downloaded: result.downloaded, failed: result.failures.length }))
    if (result.failures.length) process.exitCode = 1
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}

module.exports = { fetchContent }
