'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { Writer } = require('../lib/protocol/stream')
const { commandCatalog, encodeCommand, decodeCommand, encodeEndClientTurn, decodeEndClientTurn, UnverifiedCommandError } = require('../lib/protocol/commands')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')

for (const fixture of [...require('./fixtures/native-commands.json'), ...require('./fixtures/native-player-commands.json'), ...require('./fixtures/native-resource-pack-commands.json'), ...require('./fixtures/native-loot-result-commands.json'), ...require('./fixtures/native-battle-commands.json'), require('./fixtures/native-arena-boost-command.json')]) {
  test(`native command ${fixture.id} encode/decode, variant ${fixture.variant}`, () => {
    const command = { id: fixture.id, fields: fixture.fields }
    const payload = Buffer.from(fixture.payloadHex, 'hex')
    assert.deepEqual(encodeCommand(command), payload)
    assert.deepEqual(decodeCommand(payload), command)
    assert.equal(fixture.nativeDecodeConsumed, payload.length)
    assert.equal(fixture.nativeReencodeEqual, true)
  })
}

for (const fixture of require('./fixtures/native-turns.json')) {
  test(`native EndClientTurn message 13597 with ${fixture.fields.commands.length} commands`, () => {
    const payload = Buffer.from(fixture.payloadHex, 'hex')
    assert.deepEqual(encodeMessage(13597, fixture.fields), payload)
    assert.deepEqual(decodeMessage(13597, payload), fixture.fields)
    assert.equal(fixture.nativeDecodeConsumed, payload.length)
    assert.equal(fixture.nativeReencodeEqual, true)
    for (let n = 0; n < payload.length; n++) assert.throws(() => decodeEndClientTurn(payload.subarray(0, n)))
    assert.throws(() => decodeEndClientTurn(Buffer.concat([payload, Buffer.from([0])])), /trailing/)
  })
}

test('command catalog retains unresolved native types and refuses to guess their sizes', () => {
  assert.equal(commandCatalog.size, 135)
  assert.equal([...commandCatalog.values()].filter(command => command.fields !== null).length, 96)
  for (const id of [1001, -1]) {
    assert.throws(() => encodeCommand({ id }), UnverifiedCommandError)
    assert.throws(() => decodeCommand(new Writer().vint(id).toBuffer()), error => error instanceof UnverifiedCommandError && error.id === id)
  }
})

test('EndClientTurn bounds command counts, nested text and binary lengths', () => {
  for (const count of [-1, 513, 2147483647]) assert.throws(() => decodeEndClientTurn(new Writer().vint(0).vint(0).vint(count).toBuffer()), /collection/)
  assert.throws(() => encodeEndClientTurn({ commands: Array(513).fill({ id: 703 }) }), /count/)
  assert.throws(() => encodeEndClientTurn({ commands: null }), /count/)
  assert.throws(() => encodeEndClientTurn({ field_0x98: 'text' }), /bytes/)
  const invalidText = new Writer().vint(948).int(1).raw(Buffer.from([255])).toBuffer()
  assert.throws(() => decodeCommand(invalidText), /UTF-8/)
  const invalidBytes = new Writer().vint(0).vint(0).vint(0).int(-2).toBuffer()
  assert.throws(() => decodeEndClientTurn(invalidBytes), /Truncated/)
  assert.throws(() => encodeCommand({ id: 703, fields: { field_0x14: [0] } }), /high, low/)
})

test('HomeLogicStopped has no trailing byte-array and bounds its command batches', () => {
  for (const fixture of require('./fixtures/native-training.json').filter(f => f.id === 12405)) {
    const payload = Buffer.from(fixture.payload, 'hex')
    for (let n = 0; n < payload.length; n++) assert.throws(() => decodeMessage(12405, payload.subarray(0, n)))
    assert.throws(() => decodeMessage(12405, Buffer.concat([payload, Buffer.alloc(4)])), /trailing/)
  }
  for (const count of [-1, 513, 2147483647]) assert.throws(() => decodeMessage(12405, new Writer().vint(0).vint(0).vint(count).toBuffer()), /collection/)
  assert.throws(() => encodeMessage(12405, { commands: Array(513).fill({ id: 805 }) }), /count/)
  assert.throws(() => decodeMessage(12405, new Writer().vint(0).vint(0).vint(1).vint(1001).toBuffer()), UnverifiedCommandError)
})
