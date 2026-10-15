'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { once } = require('node:events')
const { createHash } = require('node:crypto')
const { loadContent, createContentServer, contentUrl, fingerprintSha } = require('../server/content')
const { downloadAsset } = require('../server/content-download')
const { contentEvent } = require('../server/startup-handlers')
const { Response } = globalThis
const fingerprint = require('../content/fingerprint.json')
const entry = fingerprint.files[0]
const rootOfRepo = path.resolve(__dirname, '..')

async function fixture (t, present = true, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-content-'))
  t.after(() => fs.rm(root, { force: true, recursive: true }))
  await fs.copyFile(path.join(rootOfRepo, 'content/fingerprint.json'), path.join(root, 'fingerprint.json'))
  const body = await fs.readFile(path.join(rootOfRepo, 'content/assets', entry.file))
  const file = path.join(root, 'assets', entry.file)
  await fs.mkdir(path.dirname(file), { recursive: true })
  if (present) await fs.writeFile(file, body)
  const logs = []
  const content = await loadContent({ root, logger: item => logs.push(item), ...options })
  const server = createContentServer(content)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { content.close(); server.closeAllConnections(); server.close(resolve) }))
  const request = (route, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, headers, method }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    req.on('error', reject); req.end()
  })
  return { root, file, body, content, request, logs }
}

test('content HTTP serves original fingerprint and byte-exact APK assets, HEAD, ranges and cache validation', async t => {
  const f = await fixture(t)
  assert.equal(f.content.missing.length, 1199)
  const manifest = await f.request('/' + fingerprintSha + '/fingerprint.json')
  assert.equal(manifest.status, 200)
  assert.equal(JSON.parse(manifest.body).sha, fingerprintSha)
  for (const prefix of ['', fingerprintSha + '/', entry.sha + '/']) {
    const response = await f.request('/' + prefix + entry.file)
    assert.equal(response.status, 200)
    assert.deepEqual(response.body, f.body)
    assert.equal(createHash('sha1').update(response.body).digest('hex'), entry.sha)
    assert.equal(Number(response.headers['content-length']), f.body.length)
  }
  const head = await f.request('/' + entry.file, {}, 'HEAD')
  assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), f.body.length)
  const range = await f.request('/' + entry.file, { Range: 'bytes=2-11' })
  assert.equal(range.status, 206); assert.deepEqual(range.body, f.body.subarray(2, 12))
  assert.equal(range.headers['content-range'], `bytes 2-11/${f.body.length}`)
  const suffix = await f.request('/' + entry.file, { Range: 'bytes=-7' })
  assert.deepEqual(suffix.body, f.body.subarray(-7))
  assert.equal((await f.request('/' + entry.file, { 'If-None-Match': '"' + entry.sha + '"' })).status, 304)
  assert.equal((await f.request('/' + entry.file, { Range: 'bytes=1-2', 'If-Range': '"different-version"' })).status, 200)
  for (const value of ['bytes=-0', 'bytes=999999999-', 'bytes=0-2,4-5']) assert.equal((await f.request('/' + entry.file, { Range: value })).status, 416)
})

test('content server refuses traversal, unknown files, bad digests, corruption and external symlinks', async t => {
  const f = await fixture(t)
  for (const name of ['/../package.json', '/%2e%2e/package.json', '/sc/%5c..%5csecret', '/%00']) assert.equal((await f.request(name)).status, 400)
  for (const name of ['/package.json', '/.local/accounts/accounts.json', '/0000000000000000000000000000000000000000/' + entry.file]) assert.equal((await f.request(name)).status, 404)
  assert.equal((await f.request('/fingerprint.json', {}, 'POST')).status, 405)
  await fs.writeFile(f.file, 'corrupted')
  assert.equal((await f.request('/' + entry.file)).status, 503)
  await fs.rm(f.file)
  const external = path.join(f.root, 'private.txt')
  await fs.writeFile(external, 'a-private-value')
  await fs.symlink(external, f.file)
  const response = await f.request('/' + entry.file)
  assert.equal(response.status, 503)
  assert(!response.body.includes('a-private-value'))
  assert(!JSON.stringify(f.logs).includes('a-private-value'))
})

test('on-demand content downloads deduplicate, verify SHA-1 and become available through HTTP', async t => {
  const body = await fs.readFile(path.join(rootOfRepo, 'content/assets', entry.file))
  let requests = 0
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://content.example/' + fingerprintSha + '/' + entry.file)
    assert.equal(options.redirect, 'error')
    requests++
    return new Response(body, { status: 200, headers: { 'Content-Length': String(body.length) } })
  }
  const f = await fixture(t, false, { upstream: 'https://content.example', fetcher })
  const responses = await Promise.all([f.request('/' + entry.file), f.request('/' + entry.file)])
  for (const response of responses) { assert.equal(response.status, 200); assert.deepEqual(response.body, body) }
  assert.equal(requests, 1)
  assert.deepEqual(await fs.readFile(f.file), body)
  assert.equal((await f.request('/' + entry.file)).status, 200)
  assert.equal(requests, 1)
})

test('download failure, wrong hash and size mismatch never publish incomplete content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-content-download-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const base = { root, entry, url: 'https://content.example/file' }
  for (const response of [new Response('no', { status: 404 }), new Response('wrong'), new Response('wrong', { headers: { 'Content-Length': '90' } }), new Response('wrong', { headers: { 'Content-Length': '999999999' } })]) {
    await assert.rejects(downloadAsset({ ...base, fetcher: async () => response }))
    await assert.rejects(fs.access(path.join(root, 'assets', entry.file)), /ENOENT/)
  }
  assert.deepEqual(await fs.readdir(path.join(root, 'assets', path.dirname(entry.file))), [])
  await assert.rejects(downloadAsset({ ...base, url: 'http://content.example/file' }), /HTTPS/)
  for (const url of ['http://0.0.0.0:9338', 'https://user:password@content.example', 'file:///private', 'https://content.example?token=secret']) assert.throws(() => contentUrl(url))
})

test('download analytics reveal only known content paths and omit queries, credentials and arbitrary metadata', () => {
  const event = contentEvent('ContentDownloadFailed', { download_url: 'https://user:password@cdn.example/' + fingerprintSha + '/' + entry.file + '?token=secret', error_code: 404, account: 'private-account' })
  assert.deepEqual(event, { event: 'client-content-event', phase: 'ContentDownloadFailed', errorCode: 404, host: 'cdn.example', file: entry.file })
  assert.equal(contentEvent('private-event', { download_url: 'https://cdn.example/file' }), null)
  assert.deepEqual(contentEvent('ContentDownloadFailed', { download_url: 'https://cdn.example/private-account' }), { event: 'client-content-event', phase: 'ContentDownloadFailed' })
  assert(!JSON.stringify(event).includes('secret'))
  assert(!JSON.stringify(event).includes('password'))
  const native = require('./fixtures/native-startup.json').find(f => f.variant === 2)
  assert.deepEqual(contentEvent(native.fields.field_0x80_0x8, JSON.parse(native.fields.field_0x80_0x20_json)), { event: 'client-content-event', phase: 'ContentDownloadFailed', errorCode: 404, host: 'content.example', file: entry.file })
})

test('changed manifests are rejected even when their declared fingerprint is unchanged', async t => {
  const f = await fixture(t)
  const changed = { ...fingerprint, files: fingerprint.files.slice(1) }
  await fs.writeFile(path.join(f.root, 'fingerprint.json'), JSON.stringify(changed))
  await assert.rejects(loadContent({ root: f.root }), /manifest hash/)
})

test('HTTP diagnostics cover rejected and missing routes without exposing private request data', async t => {
  const f = await fixture(t, false)
  await f.request('/private-account?token=secret', { Authorization: 'private-credential' })
  await f.request('/%2e%2e/private-account?token=secret')
  await f.request('/' + entry.file + '?token=secret')
  await f.request('/fingerprint.json?token=secret', {}, 'HEAD')
  assert.deepEqual(f.logs.filter(e => e.event === 'content-http-response'), [
    { event: 'content-http-response', method: 'GET', route: 'unrecognized', status: 404 },
    { event: 'content-http-response', method: 'GET', route: 'unrecognized', status: 400 },
    { event: 'content-http-response', method: 'GET', route: 'asset', file: entry.file, status: 404 },
    { event: 'content-http-response', method: 'HEAD', route: 'fingerprint', status: 200 },
  ])
  for (const value of ['private-account', 'private-credential', 'secret']) assert(!JSON.stringify(f.logs).includes(value))
})

test('content shutdown aborts an active upstream request and leaves no published file', async t => {
  let started
  const seen = new Promise(resolve => { started = resolve })
  const fetcher = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Download cancelled')), { once: true })
    started()
  })
  const f = await fixture(t, false, { upstream: 'https://content.example', fetcher })
  const work = f.content.restore(entry.file)
  await seen
  f.content.close()
  assert.equal(await work, false)
  await assert.rejects(fs.access(f.file), /ENOENT/)
})
