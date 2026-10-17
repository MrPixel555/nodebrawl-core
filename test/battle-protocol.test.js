'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')

for (const [index, fixture] of require('./fixtures/native-battle-fixes.json').entries()) {
  test(`original native battle event/result fixture ${index} (${fixture.id})`, () => {
    const wire = Buffer.from(fixture.payloadHex, 'hex')
    assert.equal(fixture.nativeDecodeConsumed, wire.length)
    assert.equal(fixture.nativeReencodeEqual, true)
    assert.deepEqual(decodeMessage(fixture.id, wire), fixture.fields)
    assert.deepEqual(encodeMessage(fixture.id, fixture.fields), wire)
    for (let end = 0; end < wire.length; end++) assert.throws(() => decodeMessage(fixture.id, wire.subarray(0, end)))
    assert.throws(() => decodeMessage(fixture.id, Buffer.concat([wire, Buffer.from([0])])), /trailing/)
  })
}

test('native result carries each player crown count and a bounded optional final snapshot', () => {
  const snapshot = Buffer.from('00012a', 'hex')
  const wire = encodeMessage(22871, { field_0x7c: 2, field_0x9c: 0, field_0xa0: 3, field_0xb0: snapshot })
  const result = decodeMessage(22871, wire)
  assert.equal(result.field_0x7c, 2)
  assert.equal(result.field_0xa0, 3)
  assert.deepEqual(result.field_0xb0, snapshot)
})
