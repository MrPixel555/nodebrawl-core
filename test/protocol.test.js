'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { Reader, Writer, ProtocolError } = require('../lib/protocol/stream')
const { encodeFrame, FrameDecoder } = require('../lib/protocol/frame')
const { encodeMessage, decodeMessage, profile } = require('../lib/protocol/messages')
const fixtures = [...require('./fixtures/native-flat.json'), ...require('./fixtures/native-extra.json'), ...require('./fixtures/native-startup.json'), ...require('./fixtures/native-alliances.json')]

for (const fixture of fixtures) {
  test(`native libg.so codec ${fixture.id}, variant ${fixture.variant}`, () => {
    const fields = Object.fromEntries(Object.entries(fixture.fields).map(([key, value]) => [key, value?.hex !== undefined ? Buffer.from(value.hex, 'hex') : value]))
    const payload = Buffer.from(fixture.payload, 'hex')
    assert.deepEqual(encodeMessage(fixture.id, fields), payload)
    assert.deepEqual(decodeMessage(fixture.id, payload), fields)
    assert.equal(fixture.native_decode_consumed, payload.length)
  })
}

test('native VInt boundary vectors, including negative values', () => {
  const vectors = [[-2147483648, 'c080808000'], [-8192, 'c0807f'], [-64, 'c07f'], [-1, '7f'], [0, '00'], [1, '01'], [63, '3f'], [64, '8001'], [8191, 'bf7f'], [8192, '808001'], [2147483647, 'bfffffff0f']]
  for (const [value, hex] of vectors) { assert.equal(new Writer().vint(value).toBuffer().toString('hex'), hex); assert.equal(new Reader(Buffer.from(hex, 'hex')).vint(), value) }
})

test('packed booleans share bytes and reset on another primitive', () => {
  const w = new Writer()
  for (const value of [true, false, true, true, false, false, false, true, true]) w.bool(value)
  w.vint(3).bool(true).bool(true)
  assert.equal(w.toBuffer().toString('hex'), '8d010303')
  const r = new Reader(w.toBuffer())
  for (const value of [true, false, true, true, false, false, false, true, true]) assert.equal(r.bool(), value)
  assert.equal(r.vint(), 3); assert.equal(r.bool(), true); assert.equal(r.bool(), true); r.finish()
})

test('strict lengths reject truncated, excessive and invalid UTF-8 payloads', () => {
  for (const hex of ['808080808080', '80', '0000000478', 'fffffffe', '00000001ff']) {
    assert.throws(() => hex.startsWith('80') ? new Reader(Buffer.from(hex, 'hex')).vint() : new Reader(Buffer.from(hex, 'hex')).string(), ProtocolError)
  }
  assert.throws(() => decodeMessage(10108, Buffer.from([0])), /trailing/)
  assert.throws(() => new Writer().vint(2147483648), /int32/)
  const oversized = { field_0x80_0x8: 'ا'.repeat(513), field_0x80_0x20_json: '{}' }
  assert.throws(() => encodeMessage(10459, oversized), /string limit/)
  assert.throws(() => decodeMessage(10459, new Writer().string(oversized.field_0x80_0x8).string('{}').toBuffer()), /string length/)
})

test('frames decode at every split point and with coalesced frames', () => {
  const packet = encodeFrame(20758, 1, Buffer.from('hello'))
  const second = encodeFrame(20108, 0, Buffer.alloc(0))
  for (let n = 0; n <= packet.length; n++) {
    const decoder = new FrameDecoder()
    const frames = [...decoder.push(packet.subarray(0, n)), ...decoder.push(Buffer.concat([packet.subarray(n), second]))]
    assert.deepEqual(frames, [{ id: 20758, version: 1, payload: Buffer.from('hello') }, { id: 20108, version: 0, payload: Buffer.alloc(0) }])
  }
  const header = Buffer.alloc(7); header.writeUIntBE(1048577, 2, 3)
  assert.throws(() => new FrameDecoder().push(header), /limit/)
})

test('catalog belongs to the uploaded ARM64 library', () => {
  assert.equal(profile.library_sha256, '4dd79f7c143fe87dba0e3c7521fe150bf1e018783a2e04632bd38bba5dafde5a')
  assert.equal(profile.messages.length, 284)
  assert.equal(profile.messages.filter(m => m.fields !== null).length, 155)
  assert.equal(profile.messages.find(m => m.id === 10101).fields, null)
  assert.equal(profile.messages.find(m => m.id === 20103).fields, null)
})

test('large payload survives single-byte fragmentation and retains its own bytes', () => {
  const payload = Buffer.alloc(65536, 0x7b)
  const frame = encodeFrame(21217, 3, payload)
  const decoder = new FrameDecoder()
  let frames = []
  for (let n = 0; n < frame.length; n++) frames = frames.concat(decoder.push(frame.subarray(n, n + 1)))
  frame.fill(0)
  assert.deepEqual(frames, [{ id: 21217, version: 3, payload }])
})

test('frame batches and invalid limits are bounded, and errors close the decoder', () => {
  for (const maxPayload of [-1, 0x1000000, Infinity, NaN]) assert.throws(() => new FrameDecoder({ maxPayload }), /limit/)
  const decoder = new FrameDecoder({ maxFrames: 2 })
  const empty = encodeFrame(10108, 0, Buffer.alloc(0))
  assert.throws(() => decoder.push(Buffer.concat([empty, empty, empty])), /batch limit/)
  assert.throws(() => decoder.push(empty), /closed/)
})
