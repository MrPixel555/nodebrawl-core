'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { Writer } = require('../lib/protocol/stream')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')
const { createAllianceHandlers } = require('../server/alliance-handlers')

test('alliance lists distinguish native nullable wire data from an initialized empty UI list', () => {
  const empty = encodeMessage(25074, { field_0x80: 'query', field_0x88: [] })
  const absent = encodeMessage(25074, { field_0x80: 'query', field_0x88: null })
  assert.notDeepEqual(empty, absent)
  assert.deepEqual(decodeMessage(25074, empty).field_0x88, [])
  assert.equal(decodeMessage(25074, absent).field_0x88, null)
  for (const count of [-2, 10001, 2147483647]) assert.throws(() => decodeMessage(25074, new Writer().string('query').vint(count).toBuffer()), /collection count/)
  assert.throws(() => encodeMessage(25074, { field_0x88: 'invalid' }), /alliance count/)
  const fixture = require('./fixtures/native-alliances.json').find(fixture => fixture.id === 25074 && fixture.fields.field_0x88?.length)
  const payload = Buffer.from(fixture.payload, 'hex')
  for (let n = 0; n < payload.length; n++) assert.throws(() => decodeMessage(25074, payload.subarray(0, n)))
  assert.throws(() => decodeMessage(25074, Buffer.concat([payload, Buffer.from([0])])), /trailing/)
})

test('clan creation and header codecs enforce native string and data-table types', () => {
  assert.throws(() => encodeMessage(10453, { field_0x80: 'ا'.repeat(31) }), /string limit/)
  assert.throws(() => encodeMessage(10453, { field_0x88: 'a'.repeat(561) }), /string limit/)
  for (const kind of [1, 26, 57]) assert.throws(() => encodeMessage(10453, { field_0x90: [kind, 0] }), /reference type/)
  const invalid = new Writer().string('Clan').string('Description').dataReference([26, 0]).vint(1).vint(0).dataReference([0, 0]).toBuffer()
  assert.throws(() => decodeMessage(10453, invalid), /reference type/)
  assert.throws(() => encodeMessage(25074, { field_0x88: [{ field_0x10: [26, 0] }] }), /reference type/)
})

test('authenticated clan search returns an initialized empty list for the current empty registry', async () => {
  const handler = createAllianceHandlers().get(16592)
  const sent = []
  const session = { send: (id, fields) => sent.push({ id, fields }) }
  await handler(session, { field_0x80: 'قبیله' })
  assert.deepEqual(sent, [{ id: 25074, fields: { field_0x80: 'قبیله', field_0x88: [] } }])
  for (const value of [null, 'a'.repeat(1025)]) await assert.rejects(handler(session, { field_0x80: value }), /search query/)
})
