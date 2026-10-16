'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')
const { encodeCommand, decodeCommand } = require('../lib/protocol/commands')
const { Writer } = require('../lib/protocol/stream')
const fixtures = require('./fixtures/native-loot-result-commands.json')

test('ordinary loot results retain native null and empty vectors inside the server command envelope', () => {
  for (const fixture of fixtures) {
    const fields = { field_0x80: { id: 235, fields: fixture.fields } }
    const bytes = Buffer.from(fixture.payloadHex, 'hex')
    assert.deepEqual(encodeMessage(22192, fields), bytes)
    assert.deepEqual(decodeMessage(22192, bytes), fields)
    for (let end = 0; end < bytes.length; end++) assert.throws(() => decodeCommand(bytes.subarray(0, end)))
    assert.throws(() => decodeCommand(Buffer.concat([bytes, Buffer.from([0])])), /trailing/)
  }
})

test('draft loot stays explicitly unresolved and malformed card/count fields are rejected', () => {
  const unknownType = new Writer().vint(235).bool(true).vint(2).toBuffer()
  assert.throws(() => decodeCommand(unknownType), /type 2 has no verified codec/)
  assert.throws(() => encodeCommand({ id: 235, fields: { field_0x20: { type: 2 } } }), /type 2 has no verified codec/)
  for (const count of [-2, 513, 2147483647]) {
    assert.throws(() => decodeCommand(new Writer().vint(235).bool(true).vint(0).vint(count).toBuffer()), /collection count/)
  }
  const nonempty = fixtures.find(row => row.fields.field_0x20?.field_0x8?.length > 0)
  for (const spellIndex of [-1, 0, 125, null, 1.5]) {
    const command = structuredClone(nonempty)
    command.fields.field_0x20.field_0x8[0].spellIndex = spellIndex
    assert.throws(() => encodeCommand(command), /spell index/)
  }
  const command = structuredClone(nonempty)
  command.fields.field_0x20.field_0x8 = Array(513).fill(command.fields.field_0x20.field_0x8[0])
  assert.throws(() => encodeCommand(command), /collection count/)
})

test('server-authored loot in a client turn cannot grant resources or partially apply other commands', async () => {
  const { encodeEndClientTurn } = require('../lib/protocol/commands')
  const { createStarterHandlers } = require('../server/starter-handlers')
  const entries = []
  let applied = false
  const handlers = createStarterHandlers({ store: { applyStarterTurn: () => { applied = true } }, logger: entry => entries.push(entry) })
  const command = fixtures.find(row => row.fields.field_0x20?.field_0x8?.length > 0)
  const payload = encodeEndClientTurn({ commands: [require('../docs/native-lobby-actions.json').reward, command] })
  await handlers.get(13597)({}, {}, { payload })
  assert.equal(applied, false)
  assert.ok(entries.some(entry => entry.event === 'unsupported-turn' && entry.commandIds.includes(235) && entry.applied === false))
})
