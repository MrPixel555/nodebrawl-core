'use strict'
const { ProtocolError } = require('./stream')
const spells = require('../../server/battle/catalogue.json').spells

function readGameDataId (reader) {
  const type = reader.vint()
  if (!type) return 0
  const index = reader.vint()
  if (type < 1 || type > 107 || index < 0 || index >= 1000000) throw new ProtocolError('Invalid battle data reference')
  return type * 1000000 + index
}

function writeGameDataId (writer, id) {
  if (!Number.isInteger(id) || id < 0 || (id > 0 && id < 1000000) || id >= 108000000) throw new ProtocolError('Invalid battle data ID')
  writer.vint(Math.floor(id / 1000000))
  if (id) writer.vint(id % 1000000)
}

function readBattleCard (reader) {
  if (!reader.bool()) return null
  const index = reader.vint(), spell = spells[index - 1]
  if (!spell) throw new ProtocolError('Invalid battle card index')
  const card = { index, level: reader.vint(), count: reader.vint() }
  if (spell.hasExtraFields) { card.field_0x34 = reader.vint(); card.field_0x38 = reader.vint() }
  return card
}

function writeBattleCard (writer, card) {
  writer.bool(card !== null)
  if (card === null) return
  const spell = spells[card.index - 1]
  if (!spell || !Number.isInteger(card.index)) throw new ProtocolError('Invalid battle card index')
  writer.vint(card.index).vint(card.level).vint(card.count)
  if (spell.hasExtraFields) writer.vint(card.field_0x34).vint(card.field_0x38)
}

const prefix = [{ field: 'field_0x10', type: 'vint' }, { field: 'field_0xc', type: 'vint' }, { field: 'field_0x14', type: 'vlong' }]
const battleCommands = [
  {
    id: 2,
    vtable: '0xa6ad10',
    encode: '0x74639c',
    decode: '0x2fbda0',
    execute: '0x5deac4',
    fields: [...prefix,
      { field: 'field_0x1c', type: 'vint' }, { field: 'field_0x20', type: 'vint' }, { field: 'field_0x24', type: 'gameDataId' },
      { field: 'field_0x30', type: 'vint' }, { field: 'field_0x34', type: 'bool' }, { field: 'field_0x38', type: 'battleCard' },
      { field: 'field_0x28', type: 'vint' }, { field: 'field_0x2c', type: 'vint' },
    ],
    codecScope: 'Original spell command, including optional native card descriptor',
  },
  { id: 49, vtable: '0xa4c2c8', encode: '0x193804', decode: '0x5d82b8', execute: '0x137614', fields: [{ field: 'field_0x1c', type: 'gameDataId' }, ...prefix] },
]

module.exports = { battleCommands, readGameDataId, writeGameDataId, readBattleCard, writeBattleCard }
