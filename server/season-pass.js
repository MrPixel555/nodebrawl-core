'use strict'
const { ProtocolError } = require('../lib/protocol/stream')
const { profile } = require('../lib/protocol/messages')
const native = require('./data/season-pass.json')

if (native.schema !== 1 || native.librarySha256 !== profile.library_sha256) throw new Error('Season pass data does not match this library')

function isFreePassGoldCommand ({ id, fields }) {
  return id === 836 && fields?.field_0x1c === native.tier && fields.field_0x20 === false && fields.field_0x21 === false
}

function claimFreePassGold (state) {
  if (state.freePassGoldClaimed) throw new ProtocolError('Free season pass reward already claimed')
  const credited = Math.max(0, Math.min(native.gold, native.goldLimit - state.gold))
  state.gold += credited
  state.freeGold = Math.min(native.goldLimit, state.freeGold + credited)
  state.freePassGoldClaimed = true
}

function writePassClaim (writer, boost) {
  writer.raw(Buffer.from(native.claimedManagerHex[boost === null ? 'withoutArenaBoost' : 'withArenaBoost'], 'hex'))
}

module.exports = { isFreePassGoldCommand, claimFreePassGold, writePassClaim }
