'use strict'

class ProtocolError extends Error {}

function int32 (value) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new ProtocolError('Expected signed int32')
  return value
}

class Reader {
  constructor (buffer, { maxString = 900000, maxCollection = 10000 } = {}) {
    if (!Buffer.isBuffer(buffer)) throw new TypeError('Expected Buffer')
    this.buffer = buffer
    this.offset = 0
    this.bits = 0
    this.maxString = maxString
    this.maxCollection = maxCollection
  }

  get remaining () { return this.buffer.length - this.offset }
  require (size) {
    if (!Number.isInteger(size) || size < 0 || size > this.remaining) throw new ProtocolError('Truncated payload')
  }

  raw (size) { this.require(size); this.bits = 0; const value = this.buffer.subarray(this.offset, this.offset + size); this.offset += size; return value }
  byte () { return this.raw(1)[0] }
  short () { return this.raw(2).readInt16BE() }
  int () { return this.raw(4).readInt32BE() }
  long () { return [this.int(), this.int()] }
  vint () {
    let byte = this.byte()
    const negative = (byte & 64) !== 0
    let result = byte & 63
    let shift = 6
    for (let index = 1; (byte & 128) !== 0; index++) {
      if (index >= 5) throw new ProtocolError('VInt exceeds five bytes')
      byte = this.byte()
      if (index === 4 && (byte & 0xe0) !== 0) throw new ProtocolError('VInt exceeds int32')
      result |= (byte & 127) << shift
      shift += 7
    }
    if (negative && shift < 32) result |= -1 << shift
    if (negative) result |= 0x80000000
    return result | 0
  }

  bool () {
    if (this.bits === 0) { this.require(1); this.offset++ }
    const value = ((this.buffer[this.offset - 1] >> this.bits) & 1) !== 0
    this.bits = (this.bits + 1) & 7
    return value
  }

  string () {
    const size = this.int()
    if (size === -1) return null
    if (size < 0 || size > this.maxString) throw new ProtocolError('Invalid string length')
    const bytes = this.raw(size)
    const value = bytes.toString('utf8')
    if (!Buffer.from(value, 'utf8').equals(bytes)) throw new ProtocolError('Invalid UTF-8 string')
    return value
  }

  bytes () { const size = this.int(); if (size === -1) return null; if (size > this.maxString) throw new ProtocolError('Invalid byte array length'); return this.raw(size) }
  dataReference () { const type = this.vint(); return type === 0 ? [0, 0] : [type, this.vint()] }
  array (read, nullable = true) {
    const count = this.vint()
    if (nullable && count === -1) return null
    if (count < 0 || count > this.maxCollection) throw new ProtocolError('Invalid collection count')
    return Array.from({ length: count }, () => read(this))
  }

  finish () { if (this.remaining !== 0) throw new ProtocolError(`Unexpected ${this.remaining} trailing bytes`); return this }
}

class Writer {
  constructor () { this.parts = []; this.length = 0; this.bits = 0; this.bitByte = null }
  raw (buffer) { this.bits = 0; this.parts.push(buffer); this.length += buffer.length; return this }
  byte (value) { if (!Number.isInteger(value) || value < 0 || value > 255) throw new ProtocolError('Invalid byte'); return this.raw(Buffer.from([value])) }
  short (value) { if (!Number.isInteger(value) || value < -32768 || value > 32767) throw new ProtocolError('Invalid short'); const b = Buffer.alloc(2); b.writeInt16BE(value); return this.raw(b) }
  int (value) { const b = Buffer.alloc(4); b.writeInt32BE(int32(value)); return this.raw(b) }
  long (value) { if (!Array.isArray(value) || value.length !== 2) throw new ProtocolError('Expected [high, low]'); return this.int(value[0]).int(value[1]) }
  vint (value) {
    int32(value)
    const magnitude = Math.abs(value)
    const length = magnitude < 64 ? 1 : magnitude < 8192 ? 2 : magnitude < 1048576 ? 3 : magnitude < 134217728 ? 4 : 5
    const bytes = [(value & 63) | (value < 0 ? 64 : 0) | (length > 1 ? 128 : 0)]
    for (let n = 1; n < length; n++) bytes.push(((value >>> (6 + (n - 1) * 7)) & (n === 4 ? 15 : 127)) | (n < length - 1 ? 128 : 0))
    return this.raw(Buffer.from(bytes))
  }

  bool (value) {
    if (typeof value !== 'boolean') throw new ProtocolError('Expected boolean')
    if (this.bits === 0) { this.bitByte = Buffer.alloc(1); this.parts.push(this.bitByte); this.length++ }
    this.bitByte[0] |= Number(value) << this.bits
    this.bits = (this.bits + 1) & 7
    return this
  }

  string (value) {
    if (value === null) return this.int(-1)
    if (typeof value !== 'string') throw new ProtocolError('Expected string or null')
    const bytes = Buffer.from(value, 'utf8')
    if (bytes.length > 900000) throw new ProtocolError('String too large')
    return this.int(bytes.length).raw(bytes)
  }

  bytes (value) { return value === null ? this.int(-1) : this.int(value.length).raw(value) }
  dataReference (value) { this.vint(value[0]); return value[0] === 0 ? this : this.vint(value[1]) }
  array (values, write) { if (values === null) return this.vint(-1); this.vint(values.length); for (const value of values) write(this, value); return this }
  toBuffer () { return Buffer.concat(this.parts, this.length) }
}

module.exports = { Reader, Writer, ProtocolError }
