'use strict'
const { Reader, Writer, ProtocolError } = require('./stream')
const profile = require('./command-profile.json')
const library = require('./libg-profile.json')

if (profile.librarySha256 !== library.library_sha256) throw new Error('Command profile does not match this library')
const commandCatalog = new Map(profile.commands.map(command => [command.id, command]))

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
  for (const field of fieldsFor(id)) fields[field.field] = field.type === 'vlong' ? [reader.vint(), reader.vint()] : reader[field.type]()
  return { id, fields }
}

function writeCommand (writer, { id, fields = {} }) {
  writer.vint(id)
  for (const field of fieldsFor(id)) {
    const value = Object.hasOwn(fields, field.field) ? fields[field.field] : { vint: 0, int: 0, bool: false, string: null, long: [0, 0], vlong: [0, 0] }[field.type]
    if (field.type === 'vlong') {
      if (!Array.isArray(value) || value.length !== 2) throw new ProtocolError('Expected command [high, low]')
      writer.vint(value[0]).vint(value[1])
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

module.exports = { commandCatalog, UnverifiedCommandError, encodeCommand, decodeCommand, encodeEndClientTurn, decodeEndClientTurn }
