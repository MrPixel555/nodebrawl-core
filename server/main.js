'use strict'
const path = require('node:path')
const { AccountStore } = require('./accounts')
const { loadHomeProvider } = require('./home')
const { createGameServer } = require('./core')
const { createStarterHandlers } = require('./starter-handlers')
const { createStartupHandlers } = require('./startup-handlers')
const { createAllianceHandlers } = require('./alliance-handlers')
const { createNameHandlers } = require('./name-handlers')
const { NativeTransport } = require('./transport')
const { loadServerKey, publicKey } = require('./key')
const { profile } = require('../lib/protocol/messages')
const { loadContent, createContentServer, contentUrl } = require('./content')
const development = require('./data/development.json')

async function main () {
  const port = Number(process.env.PORT || 9339)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  const mode = process.env.TRANSPORT || 'plaintext'
  if (!['plaintext', 'nacl17'].includes(mode)) throw new Error('Invalid TRANSPORT; use plaintext or nacl17')
  if (process.env.TRACE_NETWORK && !['0', '1'].includes(process.env.TRACE_NETWORK)) throw new Error('TRACE_NETWORK must be 0 or 1')
  const secret = mode === 'nacl17' ? await loadServerKey(process.env.SERVER_KEY_PATH || path.resolve(__dirname, '../.local/server-key.json')) : null
  const transportFactory = secret ? () => new NativeTransport(secret) : null
  const homeProvider = await loadHomeProvider({ mode: process.env.HOME_MODE, templatePath: process.env.HOME_TEMPLATE_PATH })
  const store = new AccountStore(process.env.DATA_DIR || path.resolve(__dirname, '../.local/accounts'))
  const logger = entry => console.log(JSON.stringify(entry))
  const traceNetwork = process.env.TRACE_NETWORK === '1'
  const contentPort = Number(process.env.CONTENT_PORT ?? 9338)
  if (!Number.isInteger(contentPort) || contentPort < 0 || contentPort > 65535) throw new Error('Invalid CONTENT_PORT')
  const contentUrls = [contentUrl(process.env.CONTENT_URL || development.contentUrl)]
  const content = await loadContent({ root: process.env.CONTENT_ROOT, upstream: process.env.CONTENT_UPSTREAM_URL ?? development.contentUpstreamUrl, logger })
  const assets = createContentServer(content)
  await new Promise((resolve, reject) => { assets.once('error', reject); assets.listen(contentPort, process.env.CONTENT_HOST || process.env.HOST || '127.0.0.1', resolve) })
  const handlers = createStartupHandlers({ logger, traceNetwork })
  for (const [id, handler] of createAllianceHandlers()) handlers.set(id, handler)
  for (const [id, handler] of createNameHandlers({ logger })) handlers.set(id, handler)
  if (process.env.HOME_MODE === 'starter') for (const [id, handler] of createStarterHandlers({ store, logger, traceNetwork })) handlers.set(id, handler)
  const game = createGameServer({ store, homeProvider, transportFactory, handlers, traceNetwork, logger, contentUrls })
  try {
    await new Promise((resolve, reject) => { game.server.once('error', reject); game.server.listen(port, process.env.HOST || '127.0.0.1', resolve) })
  } catch (error) { content.close(); assets.close(); throw error }
  console.log(`Clash Royale protocol server listening on ${process.env.HOST || '127.0.0.1'}:${port}`)
  console.log(`libg.so SHA-256: ${profile.library_sha256}; transport: ${mode}`)
  if (process.env.TRACE_NETWORK === '1') console.log('Network metadata tracing enabled; payloads, credentials and keys are omitted.')
  if (secret) console.log(`Development server public key: ${publicKey(secret).toString('hex')}; client must use this peer key`)
  if (!homeProvider) console.log('Home data missing: login will return a clear LoginFailed response, rather than an invalid Home packet.')
  if (process.env.HOME_MODE === 'starter') console.log('Starter Home enabled: 95 unlocked cards, 8 active cards, 5 decks, Arena1, level 1. Expanded inventory native codec verified; Android inventory and battle gameplay remain unverified.')
  console.log(`Content server listening on ${process.env.CONTENT_HOST || process.env.HOST || '127.0.0.1'}:${assets.address().port}; advertised URL: ${contentUrls[0]}`)
  if (new URL(contentUrls[0]).protocol === 'http:') console.log('The supplied APK targets Android SDK 28 without a cleartext HTTP opt-in. Use a trusted HTTPS CONTENT_URL for device downloads; HTTP is available for local checks or behind your HTTPS proxy.')
  console.log(`Content fingerprint ${content.manifest.sha}: ${content.entries.size - content.missing.length}/${content.entries.size} files verified; ${content.missing.length} missing, fetched with SHA-1 verification when requested if an upstream is configured.`)
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM']) { process.on(signal, async () => {
    if (stopping) return
    stopping = true
    try { await game.stop(); content.close(); assets.closeAllConnections(); await new Promise((resolve, reject) => assets.close(error => error ? reject(error) : resolve())); secret?.fill(0) } catch (error) { console.error(error.message); process.exitCode = 1 }
  }) }
}
module.exports = { main }
