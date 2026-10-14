'use strict'
const path = require('node:path')
const { AccountStore } = require('./accounts')
const { loadHomeTemplate } = require('./home')
const { createGameServer } = require('./core')
const { NativeTransport } = require('./transport')
const { loadServerKey, publicKey } = require('./key')
const { profile } = require('../lib/protocol/messages')

async function main () {
  const port = Number(process.env.PORT || 9339)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  const mode = process.env.TRANSPORT || 'plaintext'
  if (!['plaintext', 'nacl17'].includes(mode)) throw new Error('Invalid TRANSPORT; use plaintext or nacl17')
  const secret = mode === 'nacl17' ? await loadServerKey(process.env.SERVER_KEY_PATH || path.resolve(__dirname, '../.local/server-key.json')) : null
  const transportFactory = secret ? () => new NativeTransport(secret) : null
  const homeProvider = await loadHomeTemplate(process.env.HOME_TEMPLATE_PATH)
  const store = new AccountStore(process.env.DATA_DIR || path.resolve(__dirname, '../.local/accounts'))
  const game = createGameServer({ store, homeProvider, transportFactory, logger: entry => console.log(JSON.stringify(entry)) })
  await new Promise((resolve, reject) => { game.server.once('error', reject); game.server.listen(port, process.env.HOST || '127.0.0.1', resolve) })
  console.log(`Clash Royale protocol server listening on ${process.env.HOST || '127.0.0.1'}:${port}`)
  console.log(`libg.so SHA-256: ${profile.library_sha256}; transport: ${mode}`)
  if (secret) console.log(`Development server public key: ${publicKey(secret).toString('hex')}; client must use this peer key`)
  if (!homeProvider) console.log('Home data missing: login will return a clear LoginFailed response, rather than an invalid Home packet.')
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM']) { process.on(signal, async () => {
    if (stopping) return
    stopping = true
    try { await game.stop(); secret?.fill(0) } catch (error) { console.error(error.message); process.exitCode = 1 }
  }) }
}
module.exports = { main }
