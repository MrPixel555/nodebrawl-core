'use strict'
const { ProtocolError } = require('../lib/protocol/stream')

function createAllianceHandlers () {
  return new Map([[16592, async (session, fields) => {
    const query = fields.field_0x80
    if (typeof query !== 'string' || Buffer.byteLength(query, 'utf8') > 1024) throw new ProtocolError('Invalid alliance search query')
    // No clans can be created by this server yet. The genuine search response
    // must still contain a non-null empty list so the UI can finish searching.
    session.send(25074, { field_0x80: query, field_0x88: [] })
  }]])
}

module.exports = { createAllianceHandlers }
