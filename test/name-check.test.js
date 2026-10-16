'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createNameHandlers, isValidPlayerName } = require('../server/name-handlers')
const { createAllianceHandlers } = require('../server/alliance-handlers')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')

test('name preflight has the exact native success/error polarity and does not mutate the account or log names', async () => {
  const events = []; const sent = []
  const account = { name: 'Player', starter: { nameSet: false, nameChangeCount: -1 } }
  const before = structuredClone(account)
  const handler = createNameHandlers({ logger: entry => events.push(entry) }).get(16592)
  for (const name of ['بازیکن', 'Player name', null, '', '  ', 'a\nname', 'a\x7fname', 'ا'.repeat(101)]) {
    await handler({ account, send: (id, fields) => sent.push({ id, fields }) }, { field_0x80: name })
  }
  assert.deepEqual(account, before)
  assert.deepEqual(sent.map(row => row.id), Array(8).fill(20821))
  assert.deepEqual(sent.map(row => row.fields), [true, true, false, false, false, false, false, false].map(accepted => ({ field_0x7c: !accepted, field_0x80: accepted ? 0 : 1, field_0x88: null })))
  assert.deepEqual(events, [true, true, false, false, false, false, false, false].map(accepted => ({ event: 'name-check-result', accepted })))
  assert.equal(createAllianceHandlers().has(16592), false)
  assert.equal(isValidPlayerName('ا'.repeat(100)), true)
})

test('name request and reply bytes match the original native codecs and reply consumer', () => {
  const report = require('../docs/native-name-check.json')
  assert.equal(report.acceptedFlag, false)
  assert.equal(report.acceptedTransitions, 2)
  assert.equal(report.rejectedTransitions, 1)
  for (const fixture of report.fixtures) {
    const payload = Buffer.from(fixture.payload, 'hex')
    assert.deepEqual(encodeMessage(fixture.id, fixture.fields), payload)
    assert.deepEqual(decodeMessage(fixture.id, payload), fixture.fields)
    for (let size = 0; size < payload.length; size++) assert.throws(() => decodeMessage(fixture.id, payload.subarray(0, size)))
    assert.throws(() => decodeMessage(fixture.id, Buffer.concat([payload, Buffer.from([0])])), /trailing/)
  }
})
