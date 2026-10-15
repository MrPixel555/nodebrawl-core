'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { deflateSync } = require('node:zlib')
const { encodeSectorStateEnvelope, decodeSectorStateEnvelope, MAX_SNAPSHOT_BYTES, MAX_ENVELOPE_BYTES } = require('../lib/protocol/sector-state')
const { schemaFor } = require('../lib/protocol/messages')
const fixtures = require('./fixtures/native-sector-envelope.json')

for (const fixture of fixtures) {
  test(`28991 original deferred consumer receives synthetic snapshot, compressed=${fixture.compressed}`, () => {
    const snapshot = Buffer.from(fixture.opaqueSnapshotHex, 'hex')
    const payload = Buffer.from(fixture.payloadHex, 'hex')
    assert.deepEqual(decodeSectorStateEnvelope(payload), { compressed: fixture.compressed, snapshot })
    assert.deepEqual(decodeSectorStateEnvelope(encodeSectorStateEnvelope(snapshot, { compressed: fixture.compressed })), { compressed: fixture.compressed, snapshot })
    assert.equal(fixture.nativeDeferredSnapshotMatched, true)
    assert.equal(fixture.nativeVirtualDecodeConsumed, 0)
    assert.equal(fixture.syntheticSnapshot, true)
    assert.throws(() => schemaFor(28991), /unresolved GameMode snapshot/)
  })
}

test('sector envelope rejects corrupt, truncated, oversized and concatenated streams', () => {
  const valid = encodeSectorStateEnvelope(Buffer.from('snapshot'))
  const size = value => { const copy = Buffer.from(valid); copy.writeInt32LE(value, 1); return copy }
  const checksum = Buffer.from(valid); checksum[checksum.length - 1] ^= 255
  const invalid = [null, Buffer.alloc(0), Buffer.from([0]), Buffer.from([2, 0]), Buffer.from([1, 1]),
    size(-1), size(0), size(MAX_SNAPSHOT_BYTES + 1), size(1), size(100),
    checksum, valid.subarray(0, -1), Buffer.concat([valid, Buffer.from([0])]),
    Buffer.concat([valid, deflateSync(Buffer.from('second stream'))]), Buffer.alloc(MAX_ENVELOPE_BYTES + 1)]
  for (const payload of invalid) assert.throws(() => decodeSectorStateEnvelope(payload))
})

test('sector encoder bounds uncompressed and wire sizes and decoder owns returned bytes', () => {
  for (const snapshot of [null, Buffer.alloc(0), Buffer.alloc(MAX_SNAPSHOT_BYTES + 1)]) assert.throws(() => encodeSectorStateEnvelope(snapshot), /snapshot size/)
  assert.throws(() => encodeSectorStateEnvelope(Buffer.alloc(MAX_ENVELOPE_BYTES), { compressed: false }), /payload limit/)
  assert.throws(() => encodeSectorStateEnvelope(Buffer.from('a'), { compressed: 1 }), /compression flag/)
  const payload = encodeSectorStateEnvelope(Buffer.from('copied'), { compressed: false })
  const result = decodeSectorStateEnvelope(payload)
  payload.fill(0)
  assert.equal(result.snapshot.toString(), 'copied')
  const large = Buffer.alloc(MAX_SNAPSHOT_BYTES, 17)
  assert.deepEqual(decodeSectorStateEnvelope(encodeSectorStateEnvelope(large)).snapshot, large)
})

test('packet coverage distinguishes a compression envelope from a GameMode codec', () => {
  const { execFileSync } = require('node:child_process')
  const report = JSON.parse(execFileSync(process.execPath, ['tools/packets.js', '--json']))
  const message = report.messages.find(message => message.id === 28991)
  assert.equal(message.codec, false)
  assert.equal(message.fields, null)
  assert.equal(message.runtimeSupport, null)
  assert.match(message.envelopeSupport, /inner GameMode snapshot unresolved/)
})
