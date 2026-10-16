'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')
const { Writer } = require('../lib/protocol/stream')
const { encodeCommand } = require('../lib/protocol/commands')
const fixtures = require('./fixtures/native-command-messages.json')

for (const [index, fixture] of fixtures.entries()) {
  test(`nested command envelope ${fixture.id} native fixture ${index}`, () => {
    const fields = { ...fixture.fields }
    if (fields.field_0x98 !== undefined && fields.field_0x98 !== null) fields.field_0x98 = Buffer.from(fields.field_0x98.hex, 'hex')
    const payload = Buffer.from(fixture.payloadHex, 'hex')
    assert.deepEqual(encodeMessage(fixture.id, fields), payload)
    // Defaulted base fields are present on decode even if omitted on encode.
    const decoded = decodeMessage(fixture.id, payload)
    assert.deepEqual(decoded, fields)
    assert.deepEqual(encodeMessage(fixture.id, decoded), payload)
    for (let end = 0; end < payload.length; end++) assert.throws(() => decodeMessage(fixture.id, payload.subarray(0, end)))
    assert.throws(() => decodeMessage(fixture.id, Buffer.concat([payload, Buffer.from([0])])), /trailing/)
  })
}

test('command envelopes enforce native origin and retain unknown nested codec failures', () => {
  const client = { id: 628, fields: { field_0x1c: 0 } }
  const server = { id: 203, fields: { field_0x1c: 0, field_0x20: 0 } }
  assert.throws(() => encodeMessage(22192, { field_0x80: client }), /origin/)
  assert.throws(() => decodeMessage(22192, encodeCommand(client)), /origin/)
  assert.throws(() => encodeMessage(16194, { field_0x80: server }), /origin/)
  assert.throws(() => decodeMessage(16194, new Writer().vint(0).vint(0).bool(true).raw(encodeCommand(server)).toBuffer()), /origin/)
  assert.throws(() => encodeMessage(22192, { field_0x80: { id: 252 } }), /no verified codec/)
  assert.throws(() => encodeMessage(26980, { commands: [{ id: 252 }] }), /no verified codec/)
})

test('command batch collection and byte lengths are bounded; empty optional bytes use native absent form', () => {
  for (const count of [-1, 1001, 2147483647]) assert.throws(() => decodeMessage(26980, new Writer().vint(0).vint(0).vint(count).toBuffer()), /collection/)
  assert.throws(() => encodeMessage(26980, { commands: Array(1001).fill({ id: 805 }) }), /command count/)
  assert.throws(() => encodeMessage(26980, { field_0x98: Buffer.alloc(900001) }), /batch bytes/)
  assert.throws(() => encodeMessage(26980, { field_0x98: 'invalid' }), /batch bytes/)
  assert.throws(() => decodeMessage(26980, new Writer().vint(0).vint(0).vint(0).bool(true).int(900001).toBuffer()), /length/)
  assert.equal(decodeMessage(26980, encodeMessage(26980, { field_0x98: Buffer.alloc(0) })).field_0x98, null)
})
