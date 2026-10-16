'use strict'
const { Reader, Writer, ProtocolError } = require('./stream')

// Nested Home/event metadata. This does not activate events or implement their
// handlers, targeting, matchmaking or battle state. Limits are server policy.
const MAX_EVENT_COUNT = 1000
const MAX_EVENT_STRING_BYTES = 64 * 1024
const MAX_EVENT_CATALOGUE_BYTES = 1024 * 1024
const HEAD = ['id', 'versionId', 'variantId']
const TIMES = ['category', 'startTime', 'endTime', 'visibleTime', 'visibleEndTime']
const TEXTS = ['startNotificationTid', 'endNotificationTid', 'eventName']
const TAIL = ['schedulingType', 'eventGroupId', 'eventTopGroupId', 'impressionId']

function checkString (value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_EVENT_STRING_BYTES) throw new ProtocolError('Invalid event string')
  return value
}

function writeEvent (writer, event) {
  if (!event || typeof event !== 'object') throw new ProtocolError('Invalid event')
  for (const field of HEAD) writer.vint(event[field])
  writer.string(checkString(event.name))
  for (const field of TIMES) writer.vint(event[field])
  for (const field of TEXTS) writer.string(checkString(event[field]))
  writer.bool(event.json !== null)
  if (event.json !== null) writer.string(checkString(event.json))
  writer.vint(event.targetingId).bool(event.personallyTargeted)
  for (const field of TAIL) writer.vint(event[field])
}

function readEvent (reader) {
  const event = {}
  for (const field of HEAD) event[field] = reader.vint()
  event.name = checkString(reader.string())
  for (const field of TIMES) event[field] = reader.vint()
  for (const field of TEXTS) event[field] = checkString(reader.string())
  event.json = reader.bool() ? checkString(reader.string()) : null
  event.targetingId = reader.vint()
  event.personallyTargeted = reader.bool()
  for (const field of TAIL) event[field] = reader.vint()
  return event
}

function encodeEventCatalogue (catalogue) {
  if (!catalogue || !Array.isArray(catalogue.events) || catalogue.events.length > MAX_EVENT_COUNT) throw new ProtocolError('Invalid event count')
  const writer = new Writer().vint(catalogue.revision).vint(catalogue.events.length)
  for (const event of catalogue.events) {
    writeEvent(writer, event)
    if (writer.length > MAX_EVENT_CATALOGUE_BYTES) throw new ProtocolError('Event catalogue exceeds payload limit')
  }
  return writer.toBuffer()
}

function decodeEventCatalogue (payload) {
  if (!Buffer.isBuffer(payload) || payload.length > MAX_EVENT_CATALOGUE_BYTES) throw new ProtocolError('Invalid event catalogue payload')
  const reader = new Reader(payload, { maxString: MAX_EVENT_STRING_BYTES, maxCollection: MAX_EVENT_COUNT })
  const revision = reader.vint()
  const events = reader.array(readEvent, false)
  reader.finish()
  return { revision, events }
}

module.exports = { encodeEventCatalogue, decodeEventCatalogue, MAX_EVENT_COUNT, MAX_EVENT_STRING_BYTES, MAX_EVENT_CATALOGUE_BYTES }
