'use strict'
const { ProtocolError } = require('../lib/protocol/stream')
const { profile } = require('../lib/protocol/messages')
const native = require('./data/season-pass.json')
const catalogue = require('./data/season-rewards.json')
const { decodeRewardManager, encodeRewardManager } = require('../lib/protocol/pass-state')

if (native.schema !== 1 || native.librarySha256 !== profile.library_sha256) throw new Error('Season pass data does not match this library')
if (catalogue.schema !== 1 || catalogue.librarySha256 !== profile.library_sha256) throw new Error('Season reward catalogue does not match this library')

function rewardForCrowns (crowns, passId = 106000000) {
  if (!Number.isInteger(crowns) || crowns < 0 || crowns > 2147483647) throw new ProtocolError('Invalid season pass crown selector')
  const pass = catalogue.passes.find(pass => pass.id === passId)
  if (!pass) throw new ProtocolError('Unknown season pass')
  // Native 0x2b29c8 chooses the last entry at or below the crown selector,
  // including selectors between thresholds and beyond the final threshold.
  for (let index = pass.rewards.length - 1; index >= 0; index--) {
    if (pass.rewards[index].crowns <= crowns) return pass.rewards[index]
  }
}

const first = rewardForCrowns(0)
if (first.free.kind !== 3 || first.free.data.Resource !== 'Gold' || first.free.amount !== native.gold) throw new Error('Starter pass reward disagrees with original catalogue')

function isFreePassGoldCommand ({ id, fields }) {
  return id === 836 && Number.isInteger(fields?.field_0x1c) && fields.field_0x1c >= native.tier && fields.field_0x1c < 10 && fields.field_0x20 === false && fields.field_0x21 === false
}

function claimFreePassGold (state) {
  if (state.freePassGoldClaimed) throw new ProtocolError('Free season pass reward already claimed')
  const credited = Math.max(0, Math.min(native.gold, native.goldLimit - state.gold))
  state.gold += credited
  state.freeGold = Math.min(native.goldLimit, state.freeGold + credited)
  state.freePassGoldClaimed = true
  state.passInitialized = true
}

function markPassSeen (state, crowns) {
  if (!Number.isInteger(crowns) || crowns < 0) throw new ProtocolError('Invalid season pass seen crowns')
  if (crowns > state.passCrowns) throw new ProtocolError('Season pass seen crowns exceed earned crowns')
  if (crowns < state.passSeenCrowns) throw new ProtocolError('Season pass seen crowns cannot move backwards')
  state.passSeenCrowns = crowns
  state.passInitialized = true
}

function writePassClaim (writer, boost, state) {
  const manager = decodeRewardManager(Buffer.from(native.claimedManagerHex[boost === null ? 'withoutArenaBoost' : 'withArenaBoost'], 'hex'))
  if (state !== undefined) {
    const pass = manager.slots[0].pass
    pass.crowns = state.passCrowns
    pass.seenCrowns = state.passSeenCrowns
    pass.freeClaimedCrowns = state.freePassGoldClaimed ? 0 : -1
  }
  writer.raw(encodeRewardManager(manager))
}

module.exports = { rewardForCrowns, isFreePassGoldCommand, claimFreePassGold, markPassSeen, writePassClaim }
