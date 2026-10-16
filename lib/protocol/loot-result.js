'use strict'
const { ProtocolError } = require('./stream')
const spellWire = require('./spell-wire.json')
const library = require('./libg-profile.json')

if (spellWire.librarySha256 !== library.library_sha256 || spellWire.extendedFieldIndexes.length !== 0) throw new Error('Loot spell wire metadata does not match this library')
const integers = ['field_0x10', 'field_0x14', 'field_0x18', 'field_0x1c', 'field_0x2c', 'field_0x30']
const maxItems = 512

function readItems (reader, read) {
  const count = reader.vint()
  if (count === -1) return null
  if (count < 0 || count > maxItems) throw new ProtocolError('Invalid loot collection count')
  return Array.from({ length: count }, () => read(reader))
}

function writeItems (writer, items, write) {
  if (items !== null && (!Array.isArray(items) || items.length > maxItems)) throw new ProtocolError('Invalid loot collection count')
  writer.array(items, write)
}

function spellIndex (value) {
  if (!Number.isInteger(value) || value < 1 || value > spellWire.count) throw new ProtocolError('Invalid loot spell index')
  return value
}

function readCard (reader) {
  const card = { spellIndex: spellIndex(reader.vint()) }
  for (const field of integers) card[field] = reader.vint()
  card.field_0x28 = reader.bool()
  card.field_0x29 = reader.bool()
  return card
}

function writeCard (writer, card) {
  writer.vint(spellIndex(card.spellIndex))
  for (const field of integers) writer.vint(card[field])
  writer.bool(card.field_0x28).bool(card.field_0x29)
}

// Native factory 0x4d7594 supports ordinary result 0 and draft result 2.
// This implementation covers the complete type-zero serializer 0x3f0ad0.
// Resource fields retain their native names until gameplay rules are ported.
function readLootResult (reader) {
  if (!reader.bool()) return null
  const type = reader.vint()
  if (type !== 0) throw new ProtocolError(`Loot result type ${type} has no verified codec`)
  const result = { type, field_0x8: readItems(reader, readCard), field_0x10: readItems(reader, readCard) }
  for (const field of ['field_0x18', 'field_0x1c', 'field_0x20', 'field_0x24']) result[field] = reader.vint()
  result.field_0x28 = readItems(reader, r => ({ reference: r.dataReference(), amount: r.vint() }))
  // The native decoder retains no allocation for an empty token vector.
  if (result.field_0x28?.length === 0) result.field_0x28 = null
  return result
}

function writeLootResult (writer, result) {
  writer.bool(result !== null)
  if (result === null) return
  if (result.type !== 0) throw new ProtocolError(`Loot result type ${result.type} has no verified codec`)
  writer.vint(result.type)
  writeItems(writer, result.field_0x8, writeCard)
  writeItems(writer, result.field_0x10, writeCard)
  for (const field of ['field_0x18', 'field_0x1c', 'field_0x20', 'field_0x24']) writer.vint(result[field])
  writeItems(writer, result.field_0x28?.length === 0 ? null : result.field_0x28, (w, item) => w.dataReference(item.reference).vint(item.amount))
}

module.exports = { readLootResult, writeLootResult }
