'use strict'
const { timingSafeEqual, createPrivateKey, createPublicKey, diffieHellman } = require('node:crypto')
const { ProtocolError } = require('./stream')

const sigma = Buffer.from('expand 32-byte k')
const polynomial = (1n << 130n) - 5n
const wordMask = (1n << 128n) - 1n

function fixed (value, length, name) {
  if (!Buffer.isBuffer(value) || value.length !== length) throw new ProtocolError(`${name} must be a ${length}-byte Buffer`)
}

function rotate (value, bits) { return ((value << bits) | (value >>> (32 - bits))) >>> 0 }

// This library's native core executes 17 rounds, not standard Salsa20's 20.
function core (input, key, hsalsa = false) {
  fixed(input, 16, 'Core input')
  fixed(key, 32, 'Key')
  let state = Array(16).fill(0)
  for (let n = 0; n < 4; n++) {
    state[5 * n] = sigma.readUInt32LE(n * 4)
    state[1 + n] = key.readUInt32LE(n * 4)
    state[6 + n] = input.readUInt32LE(n * 4)
    state[11 + n] = key.readUInt32LE(16 + n * 4)
  }
  const initial = [...state]
  for (let round = 0; round < 17; round++) {
    const next = Array(16).fill(0)
    for (let n = 0; n < 4; n++) {
      const t = Array.from({ length: 4 }, (_, m) => state[(5 * n + 4 * m) % 16])
      t[1] = (t[1] ^ rotate((t[0] + t[3]) >>> 0, 7)) >>> 0
      t[2] = (t[2] ^ rotate((t[1] + t[0]) >>> 0, 9)) >>> 0
      t[3] = (t[3] ^ rotate((t[2] + t[1]) >>> 0, 13)) >>> 0
      t[0] = (t[0] ^ rotate((t[3] + t[2]) >>> 0, 18)) >>> 0
      for (let m = 0; m < 4; m++) next[4 * n + ((n + m) % 4)] = t[m]
    }
    state = next
  }
  const words = hsalsa ? [0, 5, 10, 15, 6, 7, 8, 9].map(n => state[n]) : state.map((value, n) => (value + initial[n]) >>> 0)
  const output = Buffer.alloc(words.length * 4)
  words.forEach((value, n) => output.writeUInt32LE(value, n * 4))
  return output
}

function stream (size, nonce, key) {
  fixed(nonce, 24, 'Nonce')
  fixed(key, 32, 'Key')
  if (!Number.isSafeInteger(size) || size < 0 || size > 1048608) throw new ProtocolError('Cipher payload exceeds limit')
  const subkey = core(nonce.subarray(0, 16), key, true)
  const input = Buffer.alloc(16)
  nonce.copy(input, 0, 16)
  const output = Buffer.alloc(size)
  for (let offset = 0; offset < size; offset += 64) {
    input.writeBigUInt64LE(BigInt(offset / 64), 8)
    core(input, subkey).copy(output, offset, 0, Math.min(64, size - offset))
  }
  return output
}

function readLittle (bytes) {
  let result = 0n
  for (let n = bytes.length - 1; n >= 0; n--) result = (result << 8n) | BigInt(bytes[n])
  return result
}

function poly1305 (message, key) {
  fixed(key, 32, 'MAC key')
  const r = readLittle(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn
  const s = readLittle(key.subarray(16))
  let accumulator = 0n
  for (let offset = 0; offset < message.length; offset += 16) {
    const chunk = message.subarray(offset, offset + 16)
    const number = readLittle(chunk) | (1n << BigInt(chunk.length * 8))
    accumulator = ((accumulator + number) * r) % polynomial
  }
  let value = (accumulator + s) & wordMask
  const tag = Buffer.alloc(16)
  for (let n = 0; n < 16; n++) { tag[n] = Number(value & 255n); value >>= 8n }
  return tag
}

// Returns the compact NaCl representation: 16-byte MAC followed by ciphertext.
function seal (plaintext, nonce, key) {
  if (!Buffer.isBuffer(plaintext)) throw new ProtocolError('Plaintext must be a Buffer')
  const keystream = stream(plaintext.length + 32, nonce, key)
  const ciphertext = Buffer.alloc(plaintext.length)
  for (let n = 0; n < plaintext.length; n++) ciphertext[n] = plaintext[n] ^ keystream[n + 32]
  return Buffer.concat([poly1305(ciphertext, keystream.subarray(0, 32)), ciphertext])
}

function open (box, nonce, key) {
  if (!Buffer.isBuffer(box) || box.length < 16) throw new ProtocolError('Truncated authenticated ciphertext')
  const ciphertext = box.subarray(16)
  const keystream = stream(ciphertext.length + 32, nonce, key)
  const expected = poly1305(ciphertext, keystream.subarray(0, 32))
  if (!timingSafeEqual(expected, box.subarray(0, 16))) throw new ProtocolError('Ciphertext authentication failed')
  const plaintext = Buffer.alloc(ciphertext.length)
  for (let n = 0; n < ciphertext.length; n++) plaintext[n] = ciphertext[n] ^ keystream[n + 32]
  return plaintext
}

function keyPair (secret) {
  fixed(secret, 32, 'Private key')
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), secret]), format: 'der', type: 'pkcs8' })
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32)
  return { privateKey, publicKey: Buffer.from(publicKey) }
}

function boxKey (peerPublicKey, secret) {
  fixed(peerPublicKey, 32, 'Peer public key')
  const privateKey = keyPair(secret).privateKey
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), peerPublicKey]), format: 'der', type: 'spki' })
  let shared
  try { shared = diffieHellman({ privateKey, publicKey }) } catch (_) { throw new ProtocolError('Invalid Curve25519 peer key') }
  const result = core(Buffer.alloc(16), shared, true)
  shared.fill(0)
  return result
}

module.exports = { core, stream, poly1305, seal, open, keyPair, boxKey }
