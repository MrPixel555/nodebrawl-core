'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { Writer } = require('../lib/protocol/stream')
const { encodeEventCatalogue, decodeEventCatalogue, MAX_EVENT_COUNT, MAX_EVENT_STRING_BYTES, MAX_EVENT_CATALOGUE_BYTES } = require('../lib/protocol/event-catalogue')
const fixtures = require('./fixtures/native-party-catalogue.json')

for (const fixture of fixtures) {
  test(`event catalogue matches original native codecs, revision=${fixture.fields.revision}`, () => {
    const payload = Buffer.from(fixture.payloadHex, 'hex')
    assert.deepEqual(decodeEventCatalogue(payload), fixture.fields)
    assert.deepEqual(encodeEventCatalogue(fixture.fields), payload)
    assert.equal(fixture.nativeDecodeConsumed, payload.length)
    assert.equal(fixture.nativeReencodeEqual, true)
  })
}

test('event catalogue preserves native CASUAL mode names and nullable JSON', () => {
  const party = decodeEventCatalogue(Buffer.from(fixtures[1].payloadHex, 'hex'))
  assert.deepEqual(party.events.map(event => event.category), [20, 20])
  assert.deepEqual(party.events.map(event => JSON.parse(event.json).GameMode), ['DoubleElixir', 'TeamVsTeamLadder'])
  assert.equal(party.events[1].name, 'نبرد')
  const metadata = decodeEventCatalogue(Buffer.from(fixtures[2].payloadHex, 'hex'))
  assert.equal(metadata.events[0].json, null)
  assert.equal(metadata.events[0].personallyTargeted, true)
})

test('event catalogue rejects truncated, malformed and oversized wire data', () => {
  const payload = Buffer.from(fixtures[1].payloadHex, 'hex')
  const badCount = value => new Writer().vint(1).vint(value).toBuffer()
  const namePrefix = () => new Writer().vint(1).vint(1).vint(0).vint(0).vint(0)
  const invalid = [null, Buffer.alloc(0), Buffer.concat([payload, Buffer.from([0])]),
    badCount(-1), badCount(MAX_EVENT_COUNT + 1), Buffer.alloc(MAX_EVENT_CATALOGUE_BYTES + 1),
    namePrefix().int(MAX_EVENT_STRING_BYTES + 1).toBuffer(), namePrefix().int(-1).toBuffer(),
    namePrefix().int(1).byte(255).toBuffer()]
  for (const size of [1, 2, 5, 8, payload.length - 1]) invalid.push(payload.subarray(0, size))
  for (const value of invalid) assert.throws(() => decodeEventCatalogue(value))
})

test('event catalogue encoding bounds fields, counts and total size', () => {
  const event = fixtures[1].fields.events[0]
  for (const invalid of [null, { events: null }, { revision: 0, events: Array(MAX_EVENT_COUNT + 1) },
    { revision: 2147483648, events: [] }, { revision: 0, events: [null] },
    { revision: 0, events: [{ ...event, name: null }] },
    { revision: 0, events: [{ ...event, name: 'x'.repeat(MAX_EVENT_STRING_BYTES + 1) }] },
    { revision: 0, events: [{ ...event, personallyTargeted: 1 }] },
    { revision: 0, events: [{ ...event, json: undefined }] }]) assert.throws(() => encodeEventCatalogue(invalid))
  const large = { ...event, name: 'x'.repeat(MAX_EVENT_STRING_BYTES) }
  assert.throws(() => encodeEventCatalogue({ revision: 0, events: Array(17).fill(large) }), /payload limit/)
})
