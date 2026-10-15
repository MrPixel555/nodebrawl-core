'use strict'
const { ProtocolError } = require('../lib/protocol/stream')

function selectedDeck (account) {
  if (account.starter === undefined) return 0
  const value = account.starter?.selectedDeck
  if (typeof account.starter !== 'object' || Array.isArray(account.starter) || !Number.isInteger(value) || value < 0 || value > 4) throw new ProtocolError('Invalid starter deck selection')
  return value
}

module.exports = { selectedDeck }
