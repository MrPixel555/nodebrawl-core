'use strict'
// Synthetic client state for the native protocol VM, never device credentials.
const { createStarterHomeProvider } = require('../server/home')
const { encodeMessage, loginOk } = require('../lib/protocol/messages')
const { keyPair, boxKey } = require('../lib/protocol/salsa17')
const { sealLoginReply, SessionCipher } = require('../lib/protocol/transport')
const development = require('../server/data/development.json')

async function main () {
  const account = { id: [0, 8192], name: 'بازیکن', token: 'synthetic-token', createdAt: '2026-01-01T00:00:00.000Z' }
  const secret = Buffer.alloc(32, 7)
  const peer = Buffer.from('d33c93779ee51583730e78e83c2e5f90bc5cfc28319bd69af82226b8bb347c65', 'hex')
  const clientPublicKey = keyPair(secret).publicKey
  const clientNonce = Buffer.alloc(24, 5)
  const serverNonce = Buffer.alloc(24, 9)
  const sessionKey = Buffer.alloc(32, 11)
  const sharedKey = boxKey(peer, secret)
  const home = await createStarterHomeProvider()(account)
  const contentUrls = [development.contentUrl]
  const payload = encodeMessage(20758, loginOk(account, { field_0x90: 3, field_0x94: 0, field_0x98: 1945 }, new Date('2026-01-02T00:00:00.000Z'), contentUrls))
  const loginBox = sealLoginReply({ payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey: peer, serverNonce, sessionKey })
  const cipher = new SessionCipher(sessionKey, serverNonce)
  const frames = [{ id: 20758, version: 1, payload: loginBox.toString('hex') }, { id: 21217, version: home.version, payload: cipher.encrypt(home.payload).toString('hex') }, { id: 20108, version: 0, payload: cipher.encrypt(Buffer.alloc(0)).toString('hex') }]
  cipher.close()
  console.log(JSON.stringify({ accountId: account.id, contentUrls, clientSecret: secret.toString('hex'), clientPublicKey: clientPublicKey.toString('hex'), clientNonce: clientNonce.toString('hex'), homeBytes: home.payload.length, frames }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
