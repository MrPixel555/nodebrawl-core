'use strict'
const { Reader, Writer, ProtocolError } = require('./stream')
const profile = require('./libg-profile.json')
const { encodeEndClientTurn, decodeEndClientTurn } = require('./commands')

const extra = {
  10459: [{ field: 'field_0x80_0x8', type: 'string', maxBytes: 1024 }, { field: 'field_0x80_0x20_json', type: 'string', maxBytes: 900000 }],
  13597: [{ field: 'field_0x88', type: 'vint' }, { field: 'field_0x8c', type: 'vint' }, { field: 'commands', type: 'commands' }, { field: 'field_0x98', type: 'bytes' }],
  20100: [{ field: 'nonce', type: 'bytes' }],
  10101: [
    ['field_0x80', 'long'], ['field_0x88', 'string'], ['field_0x90', 'vint'], ['field_0x94', 'vint'], ['field_0x98', 'vint'],
    ...['0xa0', '0xa8', '0xb0', '0xb8', '0xc0', '0xe8', '0xf0'].map(x => ['field_' + x, 'string']),
    ['field_0xf8', 'bool'], ['field_0x118', 'string'], ['field_0x100', 'string'], ['field_0xc8', 'string'], ['field_0xe0', 'dataReference'],
    ['field_0x130', 'string'], ['field_0xf9', 'bool'], ['field_0xfa', 'bool'], ['field_0x148', 'string'], ['field_0x150', 'vint'],
    ...['0x158', '0x170', '0x188', '0x1a0'].map(x => ['field_' + x, 'string']), ['field_0x1b8', 'vint'], ['field_0x1bc', 'vint'], ['field_0x1c0', 'bytes'],
  ].map(([field, type]) => ({ field, type })),
  20758: [
    ['field_0x80', 'long'], ['field_0x88', 'long'], ['field_0x90', 'string'], ['field_0x98', 'string'], ['field_0xa0', 'string'],
    ...['0xb0', '0xb4', '0xb8', '0xbc'].map(x => ['field_' + x, 'vint']), ['field_0xc0', 'string'],
    ...['0xc8', '0xcc', '0xd0'].map(x => ['field_' + x, 'vint']), ...['0xa8', '0xd8', '0xe0'].map(x => ['field_' + x, 'string']),
    ['field_0x120', 'vint'], ...['0xe8', '0xf0', '0xf8', '0x100', '0x108', '0x110'].map(x => ['field_' + x, 'string']),
    ...['0x124', '0x118', '0x11c'].map(x => ['field_' + x, 'vint']), ['field_0x128', 'strings'], ['field_0x130', 'strings'],
    ['field_0x138', 'bytes'], ['field_0x140', 'bool'], ['field_0x141', 'bool'], ['field_0x142', 'bool'], ['field_0x144', 'vint'], ['field_0x148', 'string'],
  ].map(([field, type]) => ({ field, type })),
  20103: [
    ['field_0x7c', 'vint'], ...['0x80', '0x88', '0x90', '0x98'].map(x => ['field_' + x, 'string']),
    ['field_0xb0', 'vint'], ['field_0xa0', 'bool'], ['field_0xa8', 'string'], ['field_0xb8', 'strings'],
  ].map(([field, type]) => ({ field, type })),
}

const defaultValue = type => ({ int: 0, vint: 0, bool: false, long: [0, 0], string: null, bytes: null, strings: null, dataReference: [0, 0] })[type]
const catalog = new Map(profile.messages.map(message => [message.id, message]))

function schemaFor (id) {
  const schema = extra[id] || catalog.get(id)?.fields
  if (!schema) throw new ProtocolError(`Message ${id} has no verified codec`)
  return schema
}

function encodeMessage (id, fields = {}) {
  if (id === 13597) return encodeEndClientTurn(fields)
  const writer = new Writer()
  for (const field of schemaFor(id)) {
    const value = Object.hasOwn(field, 'constant') ? field.constant : Object.hasOwn(fields, field.field) ? fields[field.field] : defaultValue(field.type)
    if (field.maxBytes && typeof value === 'string' && Buffer.byteLength(value, 'utf8') > field.maxBytes) throw new ProtocolError('Message string limit exceeded')
    if (field.type === 'strings') writer.array(value, (w, item) => w.string(item))
    else writer[field.type](value)
  }
  return writer.toBuffer()
}

function decodeMessage (id, payload) {
  if (id === 13597) return decodeEndClientTurn(payload)
  const reader = new Reader(payload)
  const fields = {}
  for (const field of schemaFor(id)) {
    const limit = reader.maxString
    if (field.maxBytes) reader.maxString = field.maxBytes
    const value = field.type === 'strings' ? reader.array(r => r.string()) : reader[field.type]()
    reader.maxString = limit
    if (Object.hasOwn(field, 'constant') && value !== field.constant) throw new ProtocolError('Message constant mismatch')
    if (field.field) fields[field.field] = value
  }
  reader.finish()
  return fields
}

function loginOk (account, login, now = new Date()) {
  return {
    field_0x80: account.id,
    field_0x88: account.id,
    field_0x90: account.token,
    field_0xb0: login.field_0x90,
    field_0xb4: login.field_0x98,
    field_0xb8: login.field_0x98,
    field_0xbc: login.field_0x94,
    field_0xc0: 'dev',
    field_0xe0: now.toISOString(),
    field_0x120: 0,
    field_0xe8: account.createdAt,
    field_0xf0: 'ZZ',
    field_0xf8: '',
    field_0x128: [],
    field_0x130: [],
    field_0x148: '',
  }
}

function loginFailed (reason, code = 1) {
  return { field_0x7c: code, field_0x98: reason, field_0xb8: [] }
}

module.exports = { profile, catalog, schemaFor, encodeMessage, decodeMessage, loginOk, loginFailed }
