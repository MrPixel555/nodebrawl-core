'use strict'
const { decodeMessage } = require('../lib/protocol/messages')
const { ProtocolError } = require('../lib/protocol/stream')

function createStartupHandlers ({ logger = () => {}, traceNetwork = false } = {}) {
  return new Map([
    [10459, async (session, fields, frame) => {
      const data = decodeMessage(10459, frame.payload)
      if (typeof data.field_0x80_0x8 !== 'string' || typeof data.field_0x80_0x20_json !== 'string') throw new ProtocolError('Invalid client metadata')
      try { JSON.parse(data.field_0x80_0x20_json) } catch (_) { throw new ProtocolError('Invalid client metadata JSON') }
      if (traceNetwork) logger({ event: 'client-metadata-accepted', payloadBytes: frame.payload.length })
    }],
    [11485, async (session, fields, frame) => {
      decodeMessage(11485, frame.payload)
      if (traceNetwork) logger({ event: 'client-ui-startup-notice' })
    }],
  ])
}

module.exports = { createStartupHandlers }
