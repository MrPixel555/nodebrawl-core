'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const cipher = require('../lib/protocol/salsa17')

for (const vector of require('./fixtures/native-salsa17-box.json')) {
  test(`native Salsa17 authenticated box, ${vector.plaintext.length / 2} plaintext bytes`, () => {
    const key = Buffer.from(vector.key, 'hex')
    const nonce = Buffer.from(vector.nonce, 'hex')
    const plaintext = Buffer.from(vector.plaintext, 'hex')
    const box = Buffer.from(vector.box, 'hex')
    assert.deepEqual(cipher.seal(plaintext, nonce, key), box)
    assert.deepEqual(cipher.open(box, nonce, key), plaintext)
    const corrupted = Buffer.from(box)
    corrupted[0] ^= 1
    assert.throws(() => cipher.open(corrupted, nonce, key), /authentication/)
    const wrongNonce = Buffer.from(nonce)
    wrongNonce[0] ^= 1
    assert.throws(() => cipher.open(box, wrongNonce, key), /authentication/)
    const wrongKey = Buffer.from(key)
    wrongKey[0] ^= 1
    assert.throws(() => cipher.open(box, nonce, wrongKey), /authentication/)
    assert.equal(vector.nativeRoundtripEqual, true)
    assert.equal(vector.nativeCorruptMacRejected, true)
  })
}

for (const vector of require('./fixtures/native-curve-boxes.json')) {
  test(`native Curve25519 and HSalsa17 box, ${vector.plaintext.length / 2} plaintext bytes`, () => {
    const key = cipher.boxKey(Buffer.from(vector.peerPublicKey, 'hex'), Buffer.from(vector.privateKey, 'hex'))
    const nonce = Buffer.from(vector.nonce, 'hex')
    const plaintext = Buffer.from(vector.plaintext, 'hex')
    assert.equal(cipher.seal(plaintext, nonce, key).toString('hex'), vector.box)
    assert.deepEqual(cipher.open(Buffer.from(vector.box, 'hex'), nonce, key), plaintext)
    assert.equal(vector.runtimeState, 'zero-initialized BSS in emulator')
  })
}

test('cipher rejects invalid lengths and Curve25519 low-order peer keys', () => {
  assert.throws(() => cipher.stream(1048609, Buffer.alloc(24), Buffer.alloc(32)), /limit/)
  assert.throws(() => cipher.open(Buffer.alloc(15), Buffer.alloc(24), Buffer.alloc(32)), /Truncated/)
  assert.throws(() => cipher.boxKey(Buffer.alloc(32), Buffer.alloc(32)), /Invalid Curve25519/)
  assert.throws(() => cipher.core(Buffer.alloc(15), Buffer.alloc(32)), /16-byte/)
})

for (const vector of require('./fixtures/blake2b.json')) {
  test(`BLAKE2b-${vector.length * 8}, ${vector.input.length / 2} bytes matches Python hashlib`, () => {
    const { blake2b } = require('../lib/protocol/blake2b')
    assert.equal(blake2b(Buffer.from(vector.input, 'hex'), vector.length).toString('hex'), vector.digest)
  })
}
