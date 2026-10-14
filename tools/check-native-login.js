'use strict'
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { keyPair, boxKey } = require('../lib/protocol/salsa17')
const { sealLogin, loginNonce } = require('../lib/protocol/transport')
const v = JSON.parse(fs.readFileSync(0, 'utf8'))
const serverPublicKey = Buffer.from('d33c93779ee51583730e78e83c2e5f90bc5cfc28319bd69af82226b8bb347c65', 'hex')
const secret = Buffer.from(v.clientSecret, 'hex')
const clientPublicKey = keyPair(secret).publicKey
const sharedKey = boxKey(serverPublicKey, secret)
assert.equal(clientPublicKey.toString('hex'), v.clientPublicKey)
assert.equal(sharedKey.toString('hex'), v.nativeKey)
assert.equal(loginNonce(clientPublicKey, serverPublicKey).toString('hex'), v.nativeNonce)
assert.equal(sealLogin({ payload: Buffer.from(v.loginPayload, 'hex'), serverHelloNonce: Buffer.from(v.serverHelloNonce, 'hex'), clientNonce: Buffer.from(v.clientNonce, 'hex'), sharedKey, clientPublicKey, serverPublicKey }).toString('hex'), v.clientPublicKey + v.nativeBox)
