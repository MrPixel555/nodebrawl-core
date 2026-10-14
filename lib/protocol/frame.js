'use strict'
const { ProtocolError } = require('./stream')

function encodeFrame (id, version, payload) {
  if (!Number.isInteger(id) || id < 0 || id > 65535 || !Number.isInteger(version) || version < 0 || version > 65535) throw new ProtocolError('Invalid frame header')
  if (!Buffer.isBuffer(payload) || payload.length > 0xffffff) throw new ProtocolError('Invalid frame payload')
  const header = Buffer.alloc(7)
  header.writeUInt16BE(id, 0)
  header.writeUIntBE(payload.length, 2, 3)
  header.writeUInt16BE(version, 5)
  return Buffer.concat([header, payload])
}

class FrameDecoder {
  constructor ({ maxPayload = 1048576, maxFrames = 256 } = {}) {
    if (!Number.isInteger(maxPayload) || maxPayload < 0 || maxPayload > 0xffffff) throw new ProtocolError('Invalid payload limit')
    if (!Number.isInteger(maxFrames) || maxFrames < 1) throw new ProtocolError('Invalid frame batch limit')
    this.maxPayload = maxPayload
    this.maxFrames = maxFrames
    this.header = Buffer.alloc(7)
    this.headerSize = 0
    this.payload = null
    this.payloadSize = 0
    this.failed = false
  }

  push (chunk) {
    if (this.failed) throw new ProtocolError('Frame decoder is closed after a protocol error')
    if (!Buffer.isBuffer(chunk)) throw new TypeError('Expected Buffer')
    const frames = []
    let offset = 0
    try {
      while (offset < chunk.length) {
        if (this.headerSize < 7) {
          const size = Math.min(7 - this.headerSize, chunk.length - offset)
          chunk.copy(this.header, this.headerSize, offset, offset + size)
          this.headerSize += size
          offset += size
          if (this.headerSize < 7) break
          const length = this.header.readUIntBE(2, 3)
          if (length > this.maxPayload) throw new ProtocolError('Frame exceeds payload limit')
          if (frames.length >= this.maxFrames) throw new ProtocolError('Frame batch limit exceeded')
          this.payload = Buffer.alloc(length)
        }
        const size = Math.min(this.payload.length - this.payloadSize, chunk.length - offset)
        chunk.copy(this.payload, this.payloadSize, offset, offset + size)
        this.payloadSize += size
        offset += size
        if (this.payloadSize < this.payload.length) break
        frames.push({ id: this.header.readUInt16BE(0), version: this.header.readUInt16BE(5), payload: this.payload })
        this.headerSize = 0
        this.payload = null
        this.payloadSize = 0
      }
      return frames
    } catch (error) {
      this.failed = true
      this.payload = null
      throw error
    }
  }
}

module.exports = { FrameDecoder, encodeFrame }
