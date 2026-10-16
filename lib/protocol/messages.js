'use strict'
const { Reader, Writer, ProtocolError } = require('./stream')
const profile = require('./libg-profile.json')
const { encodeEndClientTurn, decodeEndClientTurn, encodeHomeLogicStopped, decodeHomeLogicStopped, encodeServerCommand, decodeServerCommand, encodeClientCommandRequest, decodeClientCommandRequest, encodeCommandBatch, decodeCommandBatch } = require('./commands')
const { encodeAllianceSearchResult, decodeAllianceSearchResult, encodeAllianceList, decodeAllianceList } = require('./alliances')

const extra = {
  22192: [{ field: 'field_0x80', type: 'serverCommand' }],
  16194: [{ field: 'field_0x88', type: 'vint' }, { field: 'field_0x8c', type: 'vint' }, { field: 'field_0x80', type: 'optionalClientCommand' }],
  26980: [{ field: 'field_0x80', type: 'vint' }, { field: 'field_0x7c', type: 'vint' }, { field: 'commands', type: 'commands' }, { field: 'field_0x98', type: 'optionalBytes' }],
  14783: [
    { field: 'field_0x80', type: 'string', maxBytes: 1024 },
    { field: 'field_0x88', type: 'dataReference', referenceType: 57 },
    ...['0x90', '0x94', '0x98', '0xa0'].map(offset => ({ field: 'field_' + offset, type: 'int' })),
    { field: 'field_0xa4', type: 'bool' },
    ...['0xa8', '0x9c'].map(offset => ({ field: 'field_' + offset, type: 'int' })),
    { field: 'field_0xa5', type: 'bool' }, { field: 'field_0xb0', type: 'string', maxBytes: 1024 },
    { field: 'field_0xb8', type: 'vlongs', nullable: false },
    ...['0xc8', '0xd0', '0xd8'].map(offset => ({ field: 'field_' + offset, type: 'strings', nullable: false, maxBytes: 1024 })),
  ],
  24184: [{ field: 'field_0x80', type: 'allianceHeaders' }],
  10953: [{ field: 'field_0x80', type: 'dataReference', referenceType: 79 }, { field: 'field_0x88', type: 'dataReference', referenceType: 18 }],
  17967: [{ field: 'field_0x80', type: 'dataReference', referenceType: 18 }],
  12405: [{ field: 'field_0x88', type: 'vint' }, { field: 'field_0x8c', type: 'vint' }, { field: 'commands', type: 'commands' }],
  10459: [{ field: 'field_0x80_0x8', type: 'string', maxBytes: 1024 }, { field: 'field_0x80_0x20_json', type: 'string', maxBytes: 900000 }],
  10453: [
    { field: 'field_0x80', type: 'string', maxBytes: 60 }, { field: 'field_0x88', type: 'string', maxBytes: 560 },
    { field: 'field_0x90', type: 'dataReference', referenceType: 16 },
    { field: 'field_0xa0', type: 'vint' }, { field: 'field_0xa4', type: 'vint' },
    { field: 'field_0x98', type: 'dataReference', referenceType: 57 },
  ],
  13882: [
    { field: 'field_0x80', type: 'string', maxBytes: 900000 }, { field: 'field_0x88', type: 'dataReference', referenceType: 16 },
    { field: 'field_0x98', type: 'vint' }, { field: 'field_0x9c', type: 'vint' },
    { field: 'field_0x90', type: 'dataReference', referenceType: 57 },
  ],
  25074: [{ field: 'field_0x80', type: 'string' }, { field: 'field_0x88', type: 'allianceHeaders' }],
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
  if (id === 28991) throw new ProtocolError('Message 28991 requires the native GameMode snapshot codec instead of a flat message schema')
  const schema = extra[id] || catalog.get(id)?.fields
  if (!schema) throw new ProtocolError(`Message ${id} has no verified codec`)
  return schema
}

function encodeMessage (id, fields = {}) {
  if (id === 22192) return encodeServerCommand(fields)
  if (id === 16194) return encodeClientCommandRequest(fields)
  if (id === 26980) return encodeCommandBatch(fields)
  if (id === 12405) return encodeHomeLogicStopped(fields)
  if (id === 13597) return encodeEndClientTurn(fields)
  if (id === 25074) return encodeAllianceSearchResult(fields)
  if (id === 24184) return encodeAllianceList(fields)
  const writer = new Writer()
  for (const field of schemaFor(id)) {
    const value = Object.hasOwn(field, 'constant') ? field.constant : Object.hasOwn(fields, field.field) ? fields[field.field] : field.nullable === false ? [] : defaultValue(field.type)
    if (field.maxBytes && typeof value === 'string' && Buffer.byteLength(value, 'utf8') > field.maxBytes) throw new ProtocolError('Message string limit exceeded')
    if (field.referenceType && (!Array.isArray(value) || (value[0] !== 0 && value[0] !== field.referenceType))) throw new ProtocolError('Message data reference type mismatch')
    if (field.nullable === false && !Array.isArray(value)) throw new ProtocolError('Expected non-null collection')
    if (field.type === 'strings') {
      if (field.maxBytes && value?.some(item => item !== null && (typeof item !== 'string' || Buffer.byteLength(item, 'utf8') > field.maxBytes))) throw new ProtocolError('Message string limit exceeded')
      writer.array(value, (w, item) => w.string(item))
    } else if (field.type === 'vlongs') {
      writer.array(value, (w, item) => {
        if (!Array.isArray(item) || item.length !== 2) throw new ProtocolError('Expected [high, low]')
        w.vint(item[0]).vint(item[1])
      })
    } else writer[field.type](value)
  }
  return writer.toBuffer()
}

function decodeMessage (id, payload) {
  if (id === 22192) return decodeServerCommand(payload)
  if (id === 16194) return decodeClientCommandRequest(payload)
  if (id === 26980) return decodeCommandBatch(payload)
  if (id === 12405) return decodeHomeLogicStopped(payload)
  if (id === 13597) return decodeEndClientTurn(payload)
  if (id === 25074) return decodeAllianceSearchResult(payload)
  if (id === 24184) return decodeAllianceList(payload)
  const reader = new Reader(payload)
  const fields = {}
  for (const field of schemaFor(id)) {
    const limit = reader.maxString
    if (field.maxBytes) reader.maxString = field.maxBytes
    const value = field.type === 'strings' ? reader.array(r => r.string(), field.nullable !== false) : field.type === 'vlongs' ? reader.array(r => [r.vint(), r.vint()], false) : reader[field.type]()
    reader.maxString = limit
    if (field.referenceType && value[0] !== 0 && value[0] !== field.referenceType) throw new ProtocolError('Message data reference type mismatch')
    if (Object.hasOwn(field, 'constant') && value !== field.constant) throw new ProtocolError('Message constant mismatch')
    if (field.field) fields[field.field] = value
  }
  reader.finish()
  return fields
}

function loginOk (account, login, now = new Date(), contentUrls = []) {
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
    field_0x128: contentUrls,
    field_0x130: contentUrls,
    field_0x148: '',
  }
}

function loginFailed (reason, code = 1) {
  return { field_0x7c: code, field_0x98: reason, field_0xb8: [] }
}

module.exports = { profile, catalog, schemaFor, encodeMessage, decodeMessage, loginOk, loginFailed }
