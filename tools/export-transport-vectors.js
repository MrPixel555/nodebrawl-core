'use strict'
const { keyPair, boxKey } = require('../lib/protocol/salsa17')
const { replyNonce, sealLoginReply, SessionCipher, incrementNonce } = require('../lib/protocol/transport')
const extras = require('../test/fixtures/native-extra.json')
const peer = Buffer.from('d33c93779ee51583730e78e83c2e5f90bc5cfc28319bd69af82226b8bb347c65', 'hex')
const vectors = []
for (let variant = 0; variant < 2; variant++) {
  const secret = Buffer.from(Array.from({ length: 32 }, (_, n) => (n * 7 + variant * 13 + 1) & 255))
  const clientPublicKey = keyPair(secret).publicKey
  const clientNonce = Buffer.from(Array.from({ length: 24 }, (_, n) => (n * 5 + variant * 9 + 3) & 255))
  const serverNonce = Buffer.from(Array.from({ length: 24 }, (_, n) => (n * 11 + variant * 17) & 255))
  const sessionKey = Buffer.from(Array.from({ length: 32 }, (_, n) => (n * 13 + variant * 19) & 255))
  const sharedKey = boxKey(peer, secret)
  const payload = Buffer.from(extras.find(f => f.id === 20758 && f.variant === variant).payload, 'hex')
  const box = sealLoginReply({ payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey: peer, serverNonce, sessionKey })
  const clientCipher = new SessionCipher(sessionKey, clientNonce)
  const serverCipher = new SessionCipher(sessionKey, serverNonce)
  const outgoing = [Buffer.alloc(0), Buffer.from('synthetic session payload')].map(payload => ({ payload: payload.toString('hex'), box: clientCipher.encrypt(payload).toString('hex') }))
  const incoming = [Buffer.alloc(0), Buffer.alloc(0)].map(payload => ({ id: 20108, version: 0, payload: payload.toString('hex'), box: serverCipher.encrypt(payload).toString('hex') }))
  vectors.push({ variant, clientSecret: secret.toString('hex'), clientPublicKey: clientPublicKey.toString('hex'), serverPublicKey: peer.toString('hex'), clientNonce: clientNonce.toString('hex'), serverNonce: serverNonce.toString('hex'), sessionKey: sessionKey.toString('hex'), sharedKey: sharedKey.toString('hex'), replyNonce: replyNonce(clientNonce, clientPublicKey, peer).toString('hex'), payload: payload.toString('hex'), box: box.toString('hex'), outgoing, incoming, finalClientNonce: incrementNonce(incrementNonce(clientNonce)).toString('hex'), finalServerNonce: incrementNonce(incrementNonce(serverNonce)).toString('hex') })
  clientCipher.close(); serverCipher.close()
}
console.log(JSON.stringify(vectors, null, 2))
