'use strict'

function isValidPlayerName (name) {
  return typeof name === 'string' && !!name.trim() && Buffer.byteLength(name, 'utf8') <= 200 && ![...name].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)
}

function createNameHandlers ({ logger = () => {} } = {}) {
  return new Map([[16592, async (session, fields) => {
    const accepted = isValidPlayerName(fields.field_0x80)
    // Native dispatcher 0x71fcec advances the naming dialog when this flag
    // is FALSE. True/reason 1 displays TID_INVALID_NAME. Checking a candidate
    // does not commit it; the final confirmation queues command 948.
    session.send(20821, { field_0x7c: !accepted, field_0x80: accepted ? 0 : 1, field_0x88: null })
    logger({ event: 'name-check-result', accepted })
  }]])
}

module.exports = { createNameHandlers, isValidPlayerName }
