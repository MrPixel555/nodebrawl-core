'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { replyNonce, sealLoginReply, openLoginReply, SessionCipher, incrementNonce } = require('../lib/protocol/transport')
const { seal } = require('../lib/protocol/salsa17')
const vectors = require('./fixtures/native-transport.json')

for (const vector of vectors) {
  const params = Object.fromEntries(Object.entries(vector).filter(([, value]) => typeof value === 'string' && /^(?:[0-9a-f]{2})*$/.test(value)).map(([name, value]) => [name, Buffer.from(value, 'hex')]))
  test(`native Messaging accepts Login reply and clears handshake state, variant ${vector.variant}`, () => {
    assert.equal(vector.nativeLoginReplyAccepted, true)
    assert.equal(vector.nativeStateAfterLoginReply, 5)
    assert.equal(vector.nativeHandshakeMaterialCleared, true)
    assert.equal(replyNonce(params.clientNonce, params.clientPublicKey, params.serverPublicKey).toString('hex'), vector.replyNonce)
    assert.equal(sealLoginReply(params).toString('hex'), vector.box)
    const decoded = openLoginReply(params)
    assert.deepEqual(decoded, { serverNonce: params.serverNonce, sessionKey: params.sessionKey, payload: params.payload })
    const corrupt = Buffer.from(params.box); corrupt[0] ^= 1
    assert.throws(() => openLoginReply({ ...params, box: corrupt }), /authentication/)
    const tooShort = seal(Buffer.alloc(55), params.replyNonce, params.sharedKey)
    assert.throws(() => openLoginReply({ ...params, box: tooShort }), /envelope/)
  })

  test(`native bidirectional session nonce progression, variant ${vector.variant}`, () => {
    const serverReceive = new SessionCipher(params.sessionKey, params.clientNonce)
    const clientSend = new SessionCipher(params.sessionKey, params.clientNonce)
    const serverSend = new SessionCipher(params.sessionKey, params.serverNonce)
    const clientReceive = new SessionCipher(params.sessionKey, params.serverNonce)
    for (const { payload, box } of vector.outgoing) {
      assert.equal(clientSend.encrypt(Buffer.from(payload, 'hex')).toString('hex'), box)
      assert.equal(serverReceive.decrypt(Buffer.from(box, 'hex')).toString('hex'), payload)
    }
    for (const { payload, box } of vector.incoming) {
      assert.equal(serverSend.encrypt(Buffer.from(payload, 'hex')).toString('hex'), box)
      assert.equal(clientReceive.decrypt(Buffer.from(box, 'hex')).toString('hex'), payload)
    }
    assert.equal(vector.nativeIncomingFramesAccepted, 2)
    assert.equal(vector.nativeOutgoingBoxesMatched, 2)
    for (const cipher of [serverReceive, clientSend, serverSend, clientReceive]) cipher.close()
  })
}

test('nonce carry propagates through all 24 bytes and exhaustion closes a session', () => {
  const nonce = Buffer.alloc(24, 255)
  nonce[23] = 127
  const expected = Buffer.alloc(24); expected[0] = 1; expected[23] = 128
  assert.deepEqual(incrementNonce(nonce), expected)
  assert.equal(nonce[0], 255)
  const cipher = new SessionCipher(Buffer.alloc(32), Buffer.alloc(24, 255))
  assert.throws(() => cipher.encrypt(Buffer.alloc(0)), /exhausted/)
  assert.throws(() => cipher.encrypt(Buffer.alloc(0)), /closed/)
})

test('authentication failures and replay permanently close a receive cipher', () => {
  const key = Buffer.alloc(32, 7)
  const nonce = Buffer.alloc(24, 3)
  const sender = new SessionCipher(key, nonce)
  const receiver = new SessionCipher(key, nonce)
  key.fill(0); nonce.fill(0)
  const box = sender.encrypt(Buffer.from('heartbeat'))
  assert.equal(receiver.decrypt(box).toString(), 'heartbeat')
  assert.throws(() => receiver.decrypt(box), /authentication/)
  assert.throws(() => receiver.decrypt(sender.encrypt(Buffer.alloc(0))), /closed/)
  sender.close()
  assert.throws(() => sender.encrypt(Buffer.alloc(0)), /closed/)
})
