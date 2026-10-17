'use strict'
// Offline native-patch verifier. The client ephemeral key is a VM fixture.
// The pinned server private key is neither needed nor read by this test.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { keyPair, boxKey, open } = require('../../lib/protocol/salsa17')
const { loginNonce, sealLoginReply, SessionCipher } = require('../../lib/protocol/transport')
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const secret = Buffer.from(input.clientSecret, 'hex')
const clientPublicKey = keyPair(secret).publicKey
const serverPublicKey = Buffer.from(input.serverPublicKey, 'hex')
const sharedKey = boxKey(serverPublicKey, secret)
const box = Buffer.from(input.loginBox, 'hex')
assert.deepEqual(box.subarray(0, 32), clientPublicKey)
const plain = open(box.subarray(32), loginNonce(clientPublicKey, serverPublicKey), sharedKey)
assert.equal(plain.subarray(0, 24).toString('hex'), input.helloNonce)
assert.equal(plain.subarray(48).toString('hex'), input.loginPayload)
const clientNonce = plain.subarray(24, 48)
const serverNonce = Buffer.alloc(24, 81)
const sessionKey = Buffer.alloc(32, 91)
const payload = Buffer.from(require('../../test/fixtures/native-extra.json').find(f => f.id === 20758 && f.variant === 1).payload, 'hex')
const cipher = new SessionCipher(sessionKey, serverNonce)
const frames = [
  { id: 20758, version: 1, payload: sealLoginReply({ payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey, serverNonce, sessionKey }) },
  { id: 21217, version: 0, payload: cipher.encrypt(Buffer.from(input.homePayload, 'hex')) },
  { id: 20108, version: 0, payload: cipher.encrypt(Buffer.alloc(0)) },
].map(frame => ({ ...frame, payload: frame.payload.toString('hex') }))
cipher.close()
sharedKey.fill(0)
secret.fill(0)
console.log(JSON.stringify({ frames, loginPayloadAccepted: true }))
