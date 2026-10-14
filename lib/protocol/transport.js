'use strict'
const { ProtocolError } = require('./stream')
const { blake2b } = require('./blake2b')
const { seal, open } = require('./salsa17')

function fixed (value, size, name) {
  if (!Buffer.isBuffer(value) || value.length !== size) throw new ProtocolError(`Invalid ${name}`)
}

function replyNonce (clientNonce, clientPublicKey, serverPublicKey) {
  fixed(clientNonce, 24, 'client nonce')
  fixed(clientPublicKey, 32, 'client public key')
  fixed(serverPublicKey, 32, 'server public key')
  return blake2b(Buffer.concat([clientNonce, clientPublicKey, serverPublicKey]), 24)
}

function sealLoginReply ({ payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey, serverNonce, sessionKey }) {
  if (!Buffer.isBuffer(payload) || payload.length > 1048504) throw new ProtocolError('Invalid Login reply payload')
  fixed(serverNonce, 24, 'server nonce')
  fixed(sessionKey, 32, 'session key')
  return seal(Buffer.concat([serverNonce, sessionKey, payload]), replyNonce(clientNonce, clientPublicKey, serverPublicKey), sharedKey)
}

function openLoginReply ({ box, sharedKey, clientNonce, clientPublicKey, serverPublicKey }) {
  const plain = open(box, replyNonce(clientNonce, clientPublicKey, serverPublicKey), sharedKey)
  if (plain.length < 56) throw new ProtocolError('Truncated Login reply envelope')
  return { serverNonce: Buffer.from(plain.subarray(0, 24)), sessionKey: Buffer.from(plain.subarray(24, 56)), payload: Buffer.from(plain.subarray(56)) }
}

function incrementNonce (nonce) {
  fixed(nonce, 24, 'session nonce')
  const next = Buffer.from(nonce)
  let carry = 2
  for (let n = 0; n < next.length && carry; n++) {
    const value = next[n] + carry
    next[n] = value & 255
    carry = value >>> 8
  }
  if (carry) throw new ProtocolError('Session nonce exhausted')
  return next
}

const cipherStates = new WeakMap()

class SessionCipher {
  constructor (key, nonce) {
    fixed(key, 32, 'session key')
    fixed(nonce, 24, 'session nonce')
    cipherStates.set(this, { key: Buffer.from(key), nonce: Buffer.from(nonce), closed: false })
  }

  crypt (input, decrypt) {
    const state = cipherStates.get(this)
    if (state.closed) throw new ProtocolError('Session cipher is closed')
    if (!Buffer.isBuffer(input) || input.length > (decrypt ? 1048592 : 1048576) || (decrypt && input.length < 16)) throw new ProtocolError('Invalid session payload')
    try {
      state.nonce = incrementNonce(state.nonce)
      return decrypt ? open(input, state.nonce, state.key) : seal(input, state.nonce, state.key)
    } catch (error) { this.close(); throw error }
  }

  encrypt (payload) { return this.crypt(payload, false) }
  decrypt (box) { return this.crypt(box, true) }
  close () { const state = cipherStates.get(this); state.closed = true; state.key.fill(0); state.nonce.fill(0) }
}
module.exports = { replyNonce, sealLoginReply, openLoginReply, incrementNonce, SessionCipher }
