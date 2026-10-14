'use strict'
class ProtocolError extends Error {}
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
  if (!(input instanceof Uint8Array) || input.length > 1048576) throw new ProtocolError('Invalid BLAKE2b input')
  if (!Number.isInteger(length) || length < 1 || length > 64) throw new ProtocolError('Invalid BLAKE2b digest length')
  const hash = [...iv]
  hash[0] ^= 0x01010000n ^ BigInt(length)
  for (let offset = 0; offset < input.length || offset === 0; offset += 128) {
    const count = Math.min(input.length - offset, 128)
    const block = new Uint8Array(128)
    block.set(input.subarray(offset, offset + count))
    const view = new DataView(block.buffer)
    const words = Array.from({ length: 16 }, (_, n) => view.getBigUint64(n * 8, true))
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
  const output = new Uint8Array(64)
  const view = new DataView(output.buffer)
  hash.forEach((word, n) => view.setBigUint64(n * 8, word, true))
  return output.subarray(0, length)
}
// RFC 7748 Montgomery ladder, used by the optional Frida development adapter.
// Server key agreement continues to use Node's crypto implementation.
function x25519 (secret, publicKey) {
  if (!(secret instanceof Uint8Array) || secret.length !== 32 || !(publicKey instanceof Uint8Array) || publicKey.length !== 32) throw new ProtocolError('Invalid Curve25519 key')
  const scalar = Uint8Array.from(secret)
  scalar[0] &= 248; scalar[31] = (scalar[31] & 127) | 64
  const coordinate = Uint8Array.from(publicKey)
  coordinate[31] &= 127
  const prime = (1n << 255n) - 19n
  const mod = value => ((value % prime) + prime) % prime
  let x1 = 0n
  for (let n = 31; n >= 0; n--) x1 = (x1 << 8n) | BigInt(coordinate[n])
  x1 = mod(x1)
  let x2 = 1n; let z2 = 0n; let x3 = x1; let z3 = 1n; let swap = 0
  for (let bit = 254; bit >= 0; bit--) {
    const current = (scalar[bit >>> 3] >>> (bit & 7)) & 1
    swap ^= current
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2] }
    swap = current
    const a = mod(x2 + z2); const aa = mod(a * a)
    const b = mod(x2 - z2); const bb = mod(b * b)
    const e = mod(aa - bb); const c = mod(x3 + z3); const d = mod(x3 - z3)
    const da = mod(d * a); const cb = mod(c * b)
    x3 = mod((da + cb) ** 2n); z3 = mod(x1 * mod((da - cb) ** 2n))
    x2 = mod(aa * bb); z2 = mod(e * mod(aa + 121665n * e))
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2] }
  let inverse = 1n; let base = z2; let exponent = prime - 2n
  while (exponent > 0n) { if (exponent & 1n) inverse = mod(inverse * base); base = mod(base * base); exponent >>= 1n }
  let value = mod(x2 * inverse)
  if (value === 0n) throw new ProtocolError('Invalid Curve25519 peer key')
  const output = new Uint8Array(32)
  for (let n = 0; n < 32; n++) { output[n] = Number(value & 255n); value >>= 8n }
  scalar.fill(0)
  return output
}
module.exports = { blake2b, x25519 }
