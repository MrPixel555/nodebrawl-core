'use strict'
const { ProtocolError } = require('./stream')
const mask = (1n << 64n) - 1n
const iv = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'].map(hex => BigInt('0x' + hex))
const permutations = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
]
function rotate (value, bits) { return ((value >> bits) | (value << (64n - bits))) & mask }

// BLAKE2b's digest length is part of its parameters; truncating BLAKE2b-512 differs.
function blake2b (input, length = 24) {
  if (!Buffer.isBuffer(input) || input.length > 1048576) throw new ProtocolError('Invalid BLAKE2b input')
  if (!Number.isInteger(length) || length < 1 || length > 64) throw new ProtocolError('Invalid BLAKE2b digest length')
  const hash = [...iv]
  hash[0] ^= 0x01010000n ^ BigInt(length)
  for (let offset = 0; offset < input.length || offset === 0; offset += 128) {
    const count = Math.min(input.length - offset, 128)
    const block = Buffer.alloc(128)
    input.copy(block, 0, offset, offset + count)
    const words = Array.from({ length: 16 }, (_, n) => block.readBigUInt64LE(n * 8))
    const state = [...hash, ...iv]
    state[12] ^= BigInt(offset + count)
    if (offset + count === input.length) state[14] ^= mask
    const mix = (a, b, c, d, x, y) => {
      state[a] = (state[a] + state[b] + x) & mask
      state[d] = rotate(state[d] ^ state[a], 32n)
      state[c] = (state[c] + state[d]) & mask
      state[b] = rotate(state[b] ^ state[c], 24n)
      state[a] = (state[a] + state[b] + y) & mask
      state[d] = rotate(state[d] ^ state[a], 16n)
      state[c] = (state[c] + state[d]) & mask
      state[b] = rotate(state[b] ^ state[c], 63n)
    }
    for (let round = 0; round < 12; round++) {
      const s = permutations[round % 10]
      for (let n = 0; n < 4; n++) mix(n, n + 4, n + 8, n + 12, words[s[n * 2]], words[s[n * 2 + 1]])
      for (let n = 0; n < 4; n++) mix(n, (n + 1) % 4 + 4, (n + 2) % 4 + 8, (n + 3) % 4 + 12, words[s[8 + n * 2]], words[s[9 + n * 2]])
    }
    for (let n = 0; n < 8; n++) hash[n] ^= state[n] ^ state[n + 8]
  }
  const output = Buffer.alloc(64)
  hash.forEach((word, n) => output.writeBigUInt64LE(word, n * 8))
  return output.subarray(0, length)
}
module.exports = { blake2b }
