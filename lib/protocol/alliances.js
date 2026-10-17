'use strict'
const { Reader, Writer, ProtocolError } = require('./stream')

// Exact order in native AllianceHeader encoder 0x32ea04/decoder 0x4b5a14.
const headerSchema = [
  ['field_0x0', 'long'], ['field_0x8', 'string'], ['field_0x10', 'dataReference', 16],
  ...['0x18', '0x1c', '0x20', '0x24', '0x28', '0x2c', '0x30', '0x40', '0x44', '0x48'].map(offset => ['field_' + offset, 'vint']),
  ['field_0x58', 'dataReference', 1], ['field_0x50', 'dataReference', 57], ['field_0x60', 'bool'],
  ...['0x34', '0x38', '0x3c'].map(offset => ['field_' + offset, 'vint']),
  ...['0x61', '0x62', '0x63', '0x64'].map(offset => ['field_' + offset, 'bool']),
]
const defaults = { long: [0, 0], string: null, dataReference: [0, 0], vint: 0, int: 0, bool: false }

function checkReference (value, kind) {
  if (!Array.isArray(value) || value.length !== 2 || (value[0] !== 0 && value[0] !== kind)) throw new ProtocolError('Alliance data reference type mismatch')
}

function writeHeader (writer, fields) {
  for (const [name, type, kind] of headerSchema) {
    const value = Object.hasOwn(fields, name) ? fields[name] : defaults[type]
    if (kind) checkReference(value, kind)
    writer[type](value)
  }
}

function readHeader (reader) {
  const fields = {}
  for (const [name, type, kind] of headerSchema) {
    const value = reader[type]()
    if (kind) checkReference(value, kind)
    fields[name] = value
  }
  return fields
}

function encodeAllianceSearchResult ({ field_0x80 = null, field_0x88 = [] } = {}) {
  if (field_0x88 !== null && (!Array.isArray(field_0x88) || field_0x88.length > 10000)) throw new ProtocolError('Invalid alliance count')
  const writer = new Writer().string(field_0x80)
  writer.array(field_0x88, writeHeader)
  return writer.toBuffer()
}

function decodeAllianceSearchResult (payload) {
  const reader = new Reader(payload)
  const fields = { field_0x80: reader.string(), field_0x88: reader.array(readHeader) }
  reader.finish()
  return fields
}

function encodeAllianceList ({ field_0x80 = [] } = {}) {
  if (field_0x80 !== null && (!Array.isArray(field_0x80) || field_0x80.length > 10000)) throw new ProtocolError('Invalid alliance count')
  return new Writer().array(field_0x80, writeHeader).toBuffer()
}

function decodeAllianceList (payload) {
  const reader = new Reader(payload)
  const fields = { field_0x80: reader.array(readHeader) }
  reader.finish()
  return fields
}

// Native member 0x56fb6c/0x18e060 and full clan 0x406960/0x3276dc.
const memberSchema = [
  ['field_0x10', 'long'], ['field_0x20', 'string'], ['field_0x48', 'dataReference', 54],
  ...['0x28', '0x2c', '0x30', '0x34', '0x38', '0x3c', '0x40', '0x50', '0x5c'].map(offset => ['field_' + offset, 'vint']),
  ['field_0x54', 'bool'], ['field_0x55', 'bool'], ['field_0x58', 'int'],
]
function writeMember (writer, fields) {
  for (const [name, type, kind] of memberSchema) {
    const value = fields[name] ?? defaults[type]
    if (kind) checkReference(value, kind)
    writer[type](value)
  }
  writer.bool(fields.field_0x18 != null)
  if (fields.field_0x18 != null) writer.long(fields.field_0x18)
  writer.long(fields.field_0x8 || [0, 0])
}
function readMember (reader) {
  const fields = {}
  for (const [name, type, kind] of memberSchema) {
    fields[name] = reader[type]()
    if (kind) checkReference(fields[name], kind)
  }
  fields.field_0x18 = reader.bool() ? reader.long() : null
  fields.field_0x8 = reader.long()
  return fields
}
function encodeAllianceData ({ field_0x80 } = {}) {
  if (!field_0x80 || !Array.isArray(field_0x80.members) || field_0x80.members.length > 50) throw new ProtocolError('Invalid clan data')
  const writer = new Writer()
  writeHeader(writer, field_0x80.header)
  writer.string(field_0x80.description ?? null).array(field_0x80.members, writeMember).vint(field_0x80.field_0x28 ?? 0).bool(field_0x80.field_0x30 != null)
  if (field_0x80.field_0x30 != null) writer.long(field_0x80.field_0x30)
  return writer.toBuffer()
}
function decodeAllianceData (payload) {
  const reader = new Reader(payload, { maxCollection: 50 })
  const fields = { field_0x80: { header: readHeader(reader), description: reader.string(), members: reader.array(readMember, false), field_0x28: reader.vint(), field_0x30: reader.bool() ? reader.long() : null } }
  reader.finish()
  return fields
}

module.exports = { headerSchema, memberSchema, encodeAllianceSearchResult, decodeAllianceSearchResult, encodeAllianceList, decodeAllianceList, encodeAllianceData, decodeAllianceData }
