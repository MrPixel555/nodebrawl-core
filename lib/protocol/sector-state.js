'use strict'
const { deflateSync, inflateSync } = require('node:zlib')
const { ProtocolError } = require('./stream')

// Message 28991 defers parsing its embedded stream to the GameMode loader.
// These helpers verify only its compression envelope. The snapshot is opaque;
// accepting this envelope does not establish a valid world or playable battle.
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024
const MAX_ENVELOPE_BYTES = 1024 * 1024

function checkSnapshot (snapshot) {
  if (!Buffer.isBuffer(snapshot) || snapshot.length < 1 || snapshot.length > MAX_SNAPSHOT_BYTES) throw new ProtocolError('Invalid sector snapshot size')
}

function encodeSectorStateEnvelope (snapshot, { compressed = true } = {}) {
  checkSnapshot(snapshot)
  if (typeof compressed !== 'boolean') throw new ProtocolError('Invalid sector compression flag')
  let payload
  if (compressed) {
    const header = Buffer.alloc(5)
    header[0] = 1
    header.writeInt32LE(snapshot.length, 1)
    payload = Buffer.concat([header, deflateSync(snapshot)])
  } else payload = Buffer.concat([Buffer.from([0]), snapshot])
  if (payload.length > MAX_ENVELOPE_BYTES) throw new ProtocolError('Sector envelope exceeds payload limit')
  return payload
}

function decodeSectorStateEnvelope (payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 2 || payload.length > MAX_ENVELOPE_BYTES) throw new ProtocolError('Invalid sector envelope size')
  if (payload[0] === 0) return { compressed: false, snapshot: Buffer.from(payload.subarray(1)) }
  // Native code treats every byte except 1 as raw. Emit and accept only the
  // canonical 0/1 representations instead of silently normalizing other bytes.
  if (payload[0] !== 1) throw new ProtocolError('Invalid sector compression flag')
  if (payload.length < 7) throw new ProtocolError('Truncated compressed sector envelope')
  const size = payload.readInt32LE(1)
  if (size < 1 || size > MAX_SNAPSHOT_BYTES) throw new ProtocolError('Invalid sector snapshot size')
  let result
  try { result = inflateSync(payload.subarray(5), { maxOutputLength: size, info: true }) } catch (_) { throw new ProtocolError('Invalid compressed sector snapshot') }
  if (result.buffer.length !== size) throw new ProtocolError('Sector snapshot size mismatch')
  if (result.engine.bytesWritten !== payload.length - 5) throw new ProtocolError('Sector envelope has trailing compressed data')
  return { compressed: true, snapshot: result.buffer }
}

module.exports = { encodeSectorStateEnvelope, decodeSectorStateEnvelope, MAX_SNAPSHOT_BYTES, MAX_ENVELOPE_BYTES }
