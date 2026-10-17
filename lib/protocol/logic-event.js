'use strict'
const { Reader, Writer, ProtocolError } = require('./stream')

function validate (event) {
  if (!event || !Number.isInteger(event.type) || event.type < 0 || event.type > 255) throw new ProtocolError('Invalid LogicEvent type')
}

function writeLogicEvent (writer, event) {
  validate(event)
  writer.byte(event.type).vint(event.field_0x0).vint(event.field_0x4)
  for (const offset of ['0x40', '0x38', '0x30']) {
    const values = event['field_' + offset]
    if (!Array.isArray(values) || values.length > 256) throw new ProtocolError('Invalid LogicEvent vector')
    writer.vint(values.length)
    values.forEach(value => writer.vint(value))
  }
  if (event.type === 7) writer.string(event.field_0x10)
  else if (event.type === 8) writer.bool(event.field_0x9)
  else if (event.type === 9) writer.dataReference(event.field_0x28)
}

function readLogicEvent (reader) {
  const event = { type: reader.byte(), field_0x0: reader.vint(), field_0x4: reader.vint() }
  validate(event)
  for (const offset of ['0x40', '0x38', '0x30']) {
    const count = reader.vint()
    if (count < 0 || count > 256) throw new ProtocolError('Invalid LogicEvent vector')
    event['field_' + offset] = Array.from({ length: count }, () => reader.vint())
  }
  if (event.type === 7) event.field_0x10 = reader.string()
  else if (event.type === 8) event.field_0x9 = reader.bool()
  else if (event.type === 9) event.field_0x28 = reader.dataReference()
  return event
}

function encodeLogicEventMessage ({ field_0x80 }) {
  const writer = new Writer()
  writeLogicEvent(writer, field_0x80)
  return writer.toBuffer()
}

function decodeLogicEventMessage (payload) {
  const reader = new Reader(payload, { maxString: 900000 })
  const fields = { field_0x80: readLogicEvent(reader) }
  reader.finish()
  return fields
}

module.exports = { encodeLogicEventMessage, decodeLogicEventMessage }
