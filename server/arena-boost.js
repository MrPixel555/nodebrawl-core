'use strict'
const { ProtocolError } = require('../lib/protocol/stream')
const { profile } = require('../lib/protocol/messages')
const native = require('./data/arena-boost.json')

if (native.schema !== 1 || native.librarySha256 !== profile.library_sha256) throw new Error('Arena boost data does not match this library')
const durationMs = native.seconds * 1000

function isArena1BoostCommand ({ id, fields }) {
  return id === 595 && fields?.field_0x30 === false && Array.isArray(fields.field_0x28) && fields.field_0x28.length === 2 && native.reference.every((part, index) => part === fields.field_0x28[index])
}

function validateArena1Boost (boost) {
  if (boost === null) return null
  if (!boost || Array.isArray(boost) || !Number.isSafeInteger(boost.claimedAtMs) || boost.claimedAtMs < 0 || boost.claimedAtMs > 2147483647000 || !Number.isSafeInteger(boost.expiresAtMs) || boost.expiresAtMs !== boost.claimedAtMs + durationMs) throw new ProtocolError('Invalid Arena1 boost state')
  return { claimedAtMs: boost.claimedAtMs, expiresAtMs: boost.expiresAtMs }
}

function claimArena1Boost (state, now) {
  if (state.arena1Boost !== null) throw new ProtocolError('Arena1 boost already claimed')
  // The starter's current arena is fixed to Arena1. The observed reference
  // branch grants ChestSpeedUp and marks its threshold consumed, once only.
  const claimedAtMs = now()
  state.arena1Boost = validateArena1Boost({ claimedAtMs, expiresAtMs: claimedAtMs + durationMs })
}

function writeArenaBoostState (writer, field, boost, nowMs) {
  const fragment = native[field]
  if (boost === null) { writer.raw(Buffer.from(fragment.emptyHex, 'hex')); return }
  if (field === 'arenaBoostClaim') { writer.raw(Buffer.from(fragment.claimedHex, 'hex')); return }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new ProtocolError('Invalid arena boost clock')
  // Native temporary boosts store 20 remaining ticks per second. Reconnects
  // consume elapsed wall time; a clock rollback cannot extend the initial TTL.
  const remainingTicks = Math.min(native.seconds * native.ticksPerSecond, Math.max(0, Math.ceil((boost.expiresAtMs - nowMs) * native.ticksPerSecond / 1000)))
  for (const part of fragment.parts) {
    if (part.hex !== undefined) writer.raw(Buffer.from(part.hex, 'hex'))
    else if (part.field === 'claimedAtSeconds' && part.type === 'int') writer.int(Math.floor(boost.claimedAtMs / 1000))
    else if (part.field === 'remainingTicks' && part.type === 'int') writer.int(remainingTicks)
    else throw new Error('Invalid native arena boost binding')
  }
}

module.exports = { isArena1BoostCommand, validateArena1Boost, claimArena1Boost, writeArenaBoostState }
