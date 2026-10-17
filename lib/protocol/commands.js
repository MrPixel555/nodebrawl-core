'use strict'
const { Reader, Writer, ProtocolError } = require('./stream')
const profile = require('./command-profile.json')
const library = require('./libg-profile.json')
const extra = require('./command-extra.json')
const origin = require('./command-origin.json')

if (profile.librarySha256 !== library.library_sha256) throw new Error('Command profile does not match this library')
const commandCatalog = new Map(profile.commands.map(command => [command.id, command]))
if (extra.librarySha256 !== library.library_sha256) throw new Error('Extra commands do not match this library')
if (origin.librarySha256 !== library.library_sha256) throw new Error('Command origins do not match this library')
const serverCommandIds = new Set(origin.serverCommandIds)
const { writeEmote, readEmote } = require('./emotes')
const { readLootResult, writeLootResult } = require('./loot-result')
const { battleCommands, readGameDataId, writeGameDataId, readBattleCard, writeBattleCard } = require('./battle-command')
for (const command of extra.commands) commandCatalog.set(command.id, command)
for (const command of battleCommands) commandCatalog.set(command.id, command)

class UnverifiedCommandError extends ProtocolError {
  constructor (id) { super(`Command ${id} has no verified codec`); this.id = id }
}

function fieldsFor (id) {
  const fields = commandCatalog.get(id)?.fields
  if (!fields) throw new UnverifiedCommandError(id)
  return fields
}

function readCommand (reader) {
  const id = reader.vint()
  const fields = {}
  for (const field of fieldsFor(id)) {
    if (field.type === 'emote') fields[field.field] = readEmote(reader)
    else if (field.type === 'gameDataId') fields[field.field] = readGameDataId(reader)
    else if (field.type === 'battleCard') fields[field.field] = readBattleCard(reader)
    else if (field.type === 'lootResult') fields[field.field] = readLootResult(reader)
    else if (field.type === 'vlong') fields[field.field] = [reader.vint(), reader.vint()]
    else if (field.type === 'optionalLong') fields[field.field] = reader.bool() ? reader.long() : null
    else if (field.type === 'deckCards') {
      const count = reader.vint()
      if (count !== 0 && count !== 8) throw new ProtocolError('Invalid native deck card count')
      fields[field.field] = count === 0 ? null : Array.from({ length: 8 }, () => reader.vint())
    } else fields[field.field] = reader[field.type]()
  }
  return { id, fields }
}

function writeCommand (writer, { id, fields = {} }) {
  writer.vint(id)
  for (const field of fieldsFor(id)) {
    const value = Object.hasOwn(fields, field.field) ? fields[field.field] : { vint: 0, int: 0, bool: false, string: null, long: [0, 0], vlong: [0, 0], optionalLong: null, deckCards: null, lootResult: null, battleCard: null, gameDataId: 0, dataReference: [0, 0] }[field.type]
    if (field.type === 'emote') writeEmote(writer, value)
    else if (field.type === 'gameDataId') writeGameDataId(writer, value)
    else if (field.type === 'battleCard') writeBattleCard(writer, value)
    else if (field.type === 'lootResult') writeLootResult(writer, value)
    else if (field.type === 'vlong') {
      if (!Array.isArray(value) || value.length !== 2) throw new ProtocolError('Expected command [high, low]')
      writer.vint(value[0]).vint(value[1])
    } else if (field.type === 'optionalLong') {
      writer.bool(value !== null)
      if (value !== null) writer.long(value)
    } else if (field.type === 'deckCards') {
      if (value !== null && (!Array.isArray(value) || value.length !== 8)) throw new ProtocolError('Invalid native deck card count')
      writer.vint(value === null ? 0 : 8)
      if (value !== null) for (const id of value) writer.vint(id)
    } else writer[field.type](value)
  }
}

function decodeCommand (payload) {
  const reader = new Reader(payload)
  const command = readCommand(reader)
  reader.finish()
  return command
}

function encodeCommand (command) { const writer = new Writer(); writeCommand(writer, command); return writer.toBuffer() }

function checkedOrigin (command, server) {
  if (!command || !Number.isInteger(command.id) || serverCommandIds.has(command.id) !== server) throw new ProtocolError('Command origin does not match message')
  return command
}

function encodeServerCommand ({ field_0x80 } = {}) {
  return encodeCommand(checkedOrigin(field_0x80, true))
}

function decodeServerCommand (payload) {
  return { field_0x80: checkedOrigin(decodeCommand(payload), true) }
}

function encodeClientCommandRequest ({ field_0x88 = 0, field_0x8c = 0, field_0x80 = null } = {}) {
  const writer = new Writer().vint(field_0x88).vint(field_0x8c).bool(field_0x80 !== null)
  if (field_0x80 !== null) writeCommand(writer, checkedOrigin(field_0x80, false))
  return writer.toBuffer()
}

function decodeClientCommandRequest (payload) {
  const reader = new Reader(payload)
  const fields = { field_0x88: reader.vint(), field_0x8c: reader.vint() }
  fields.field_0x80 = reader.bool() ? checkedOrigin(readCommand(reader), false) : null
  reader.finish()
  return fields
}

function encodeCommandBatch ({ field_0x80 = 0, field_0x7c = 0, commands = [], field_0x98 = null } = {}) {
  if (!Array.isArray(commands) || commands.length > 1000) throw new ProtocolError('Invalid command count')
  if (field_0x98 !== null && (!Buffer.isBuffer(field_0x98) || field_0x98.length > 900000)) throw new ProtocolError('Invalid command batch bytes')
  const present = field_0x98 !== null && field_0x98.length > 0
  const writer = new Writer().vint(field_0x80).vint(field_0x7c).array(commands, writeCommand).bool(present)
  if (present) writer.bytes(field_0x98)
  return writer.toBuffer()
}

function decodeCommandBatch (payload) {
  const reader = new Reader(payload, { maxCollection: 1000 })
  const fields = { field_0x80: reader.vint(), field_0x7c: reader.vint(), commands: reader.array(readCommand, false) }
  fields.field_0x98 = reader.bool() ? reader.bytes() : null
  if (fields.field_0x98 !== null && fields.field_0x98.length === 0) fields.field_0x98 = null
  reader.finish()
  return fields
}

// Native EndClientTurn is message 13597 in this build, not the usual 14102.
// Nested commands have no length prefixes; an unknown codec cannot be skipped.
function decodeEndClientTurn (payload) {
  const reader = new Reader(payload, { maxCollection: 512 })
  const fields = { field_0x88: reader.vint(), field_0x8c: reader.vint() }
  fields.commands = reader.array(readCommand, false)
  fields.field_0x98 = reader.bytes()
  reader.finish()
  return fields
}

function encodeEndClientTurn ({ field_0x88 = 0, field_0x8c = 0, commands = [], field_0x98 = null } = {}) {
  if (!Array.isArray(commands) || commands.length > 512) throw new ProtocolError('Invalid command count')
  if (field_0x98 !== null && !Buffer.isBuffer(field_0x98)) throw new ProtocolError('Expected turn bytes or null')
  const writer = new Writer().vint(field_0x88).vint(field_0x8c)
  writer.array(commands, writeCommand).bytes(field_0x98)
  return writer.toBuffer()
}

function decodeHomeLogicStopped (payload) {
  const reader = new Reader(payload, { maxCollection: 512 })
  const fields = { field_0x88: reader.vint(), field_0x8c: reader.vint(), commands: reader.array(readCommand, false) }
  reader.finish()
  return fields
}

function encodeHomeLogicStopped ({ field_0x88 = 0, field_0x8c = 0, commands = [] } = {}) {
  if (!Array.isArray(commands) || commands.length > 512) throw new ProtocolError('Invalid command count')
  return new Writer().vint(field_0x88).vint(field_0x8c).array(commands, writeCommand).toBuffer()
}

module.exports = { commandCatalog, UnverifiedCommandError, encodeCommand, decodeCommand, encodeEndClientTurn, decodeEndClientTurn, encodeHomeLogicStopped, decodeHomeLogicStopped, encodeServerCommand, decodeServerCommand, encodeClientCommandRequest, decodeClientCommandRequest, encodeCommandBatch, decodeCommandBatch }
