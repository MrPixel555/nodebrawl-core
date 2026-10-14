'use strict'
const { ProtocolError } = require('./stream')
const { blake2b: hash } = require('./crypto-math')
function blake2b (input, length = 24) {
  if (!Buffer.isBuffer(input)) throw new ProtocolError('Invalid BLAKE2b input')
  return Buffer.from(hash(input, length))
}
module.exports = { blake2b }
