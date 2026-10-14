'use strict'
// Test-only JSON stdin/stdout bridge. All private scalars are synthetic fixtures.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { diffieHellman, createPublicKey } = require('node:crypto')
const { keyPair } = require('../lib/protocol/salsa17')
const { x25519 } = require('../lib/protocol/crypto-math')
const { NativeTransport } = require('../server/transport')
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const secret = Buffer.alloc(32, 29)
const peer = keyPair(secret)
if (input.operation === 'public') console.log(JSON.stringify({ publicKey: peer.publicKey.toString('hex') }))
else if (input.operation === 'shared') {
  const clientSecret = Buffer.from(input.clientSecret, 'hex')
  const raw = diffieHellman({ privateKey: keyPair(clientSecret).privateKey, publicKey: createPublicKey(peer.privateKey) })
  assert.deepEqual(Buffer.from(x25519(clientSecret, peer.publicKey)), raw)
  console.log(JSON.stringify({ shared: raw.toString('hex') }))
} else if (input.operation === 'reply') {
  const transport = new NativeTransport(secret)
  transport.hello(Buffer.from(input.helloNonce, 'hex'))
  const login = transport.decode({ id: 10101, payload: Buffer.from(input.loginBox, 'hex') })
  assert.equal(login.toString('hex'), input.loginPayload)
  const payload = Buffer.from(require('../test/fixtures/native-extra.json').find(f => f.id === 20758 && f.variant === 1).payload, 'hex')
  const frames = [
    transport.encode({ id: 20758, version: 1, payload }),
    transport.encode({ id: 21217, version: 0, payload: Buffer.from(input.homePayload, 'hex') }),
    transport.encode({ id: 20108, version: 0, payload: Buffer.alloc(0) }),
  ].map(frame => ({ ...frame, payload: frame.payload.toString('hex') }))
  transport.close()
  console.log(JSON.stringify({ frames, loginPayloadAccepted: true }))
} else throw new Error('Unsupported oracle operation')
