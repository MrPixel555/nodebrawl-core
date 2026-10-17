'use strict'
const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { profile } = require('../lib/protocol/messages')
const { Writer, ProtocolError } = require('../lib/protocol/stream')
const starter = require('./data/starter-home.json')
const starterProfile = require('./data/starter-profile.json')
const unlockedHome = require('./data/unlocked-home.json')
const unlockedProfile = require('./data/unlocked-profile.json')
const { playerState } = require('./starter-state')
const { writeArenaBoostState } = require('./arena-boost')
const { writePassClaim } = require('./season-pass')
const { encodeEventCatalogue } = require('../lib/protocol/event-catalogue')
const { writeEmotes } = require('./emotes')
const { partyCatalogue } = require('./party')

// External templates bind fixed-width account IDs explicitly. The starter
// profile below uses typed bindings generated from the native nested codecs.
async function loadHomeTemplate (filename) {
  if (!filename) return null
  const template = JSON.parse(await fs.readFile(filename, 'utf8'))
  if (template.librarySha256 !== profile.library_sha256 || template.messageId !== 21217) throw new Error('Home template does not match this library')
  if (typeof template.payloadHex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(template.payloadHex)) throw new Error('Invalid Home template payload')
  const payload = Buffer.from(template.payloadHex, 'hex')
  if (payload.length > 1048576 || createHash('sha256').update(payload).digest('hex') !== template.payloadSha256) throw new Error('Home template payload checksum mismatch')
  if (!Number.isInteger(template.version) || template.version < 0 || template.version > 65535) throw new Error('Invalid Home template version')
  if (!Array.isArray(template.accountIdOffsets) || template.accountIdOffsets.length < 1) throw new Error('Home template needs explicit account ID bindings')
  const used = new Set()
  for (const offset of template.accountIdOffsets) {
    if (!Number.isInteger(offset) || offset < 0 || offset + 8 > payload.length) throw new Error('Invalid Home account binding')
    for (let n = offset; n < offset + 8; n++) { if (used.has(n)) throw new Error('Overlapping Home account bindings'); used.add(n) }
  }
  return async account => {
    const copy = Buffer.from(payload)
    for (const offset of template.accountIdOffsets) { copy.writeInt32BE(account.id[0], offset); copy.writeInt32BE(account.id[1], offset + 4) }
    return { payload: copy, version: template.version }
  }
}

function createStarterHomeProvider ({ unlocked = true, now = Date.now, party = false, emotes = true } = {}) {
  return createPlayerProvider(unlocked ? unlockedHome : starter, 21217, now, party, emotes)
}

function createStarterProfileProvider ({ unlocked = true } = {}) {
  return createPlayerProvider(unlocked ? unlockedProfile : starterProfile, 22757)
}

function createPlayerProvider (data, messageId, now = Date.now, party = false, emotes = true) {
  if (typeof now !== 'function') throw new Error('Invalid Home clock')
  if (data.schema !== 1 || data.librarySha256 !== profile.library_sha256 || data.messageId !== messageId) throw new Error('Starter player data does not match this library')
  const parts = data.parts.map(part => part.hex === undefined ? part : { buffer: Buffer.from(part.hex, 'hex') })
  return async account => {
    if (!Array.isArray(account.id) || account.id.length !== 2 || typeof account.name !== 'string' || !account.name || Buffer.byteLength(account.name, 'utf8') > 200) throw new ProtocolError('Invalid starter player identity')
    const writer = new Writer()
    const state = playerState(account)
    const nowMs = now()
    for (const part of parts) {
      if (part.buffer) writer.raw(part.buffer)
      else if (part.field === 'eventCatalogue' && part.type === 'nativeEvents') writer.raw(encodeEventCatalogue(partyCatalogue(party)))
      else if (part.field === 'accountId' && part.type === 'long') writer.long(account.id)
      else if (part.field === 'accountId' && part.type === 'vlong') { writer.vint(account.id[0]); writer.vint(account.id[1]) }
      else if (part.field === 'name' && part.type === 'string') writer.string(account.name)
      else if (part.field === 'deckCard' && part.type === 'vint') writer.vint(state.decks[part.deck][part.slot])
      else if (part.field === 'activeCard' && part.type === 'vint') writer.vint(unlockedHome.cards.find(card => card.id === state.decks[state.selectedDeck][part.slot]).ordinal)
      else if (part.field === 'inventory' && part.type === 'nativeCards') {
        const inventory = state.inventory.map(id => unlockedHome.cards.find(card => card.id === id))
        writer.vint(inventory.length)
        for (const card of inventory) writer.raw(Buffer.from(card.payloadHex, 'hex'))
      }
      else if (part.field === 'arenaBoostClaim' && part.type === 'nativeArenaBoost' && (state.passInitialized || state.freePassGoldClaimed || state.passCrowns !== 0 || state.passSeenCrowns !== -1)) writePassClaim(writer, state.arena1Boost, state)
      else if (['arenaBoostTimers', 'arenaBoostClaim'].includes(part.field) && part.type === 'nativeArenaBoost') writeArenaBoostState(writer, part.field, state.arena1Boost, nowMs)
      else if (part.field === 'avatarMembership' && part.type === 'nativeMembership') {
        const flags = (part.base & ~part.mask) | (state.nameSet ? part.mask : 0)
        if (!account.alliance) writer.byte(flags)
        else {
          const clan = account.alliance
          // Native Avatar 0x71e290: presence shares the first flag byte.
          // Badge has an implicit table 16, hence ordinal+1, not a full ref.
          writer.byte(flags | 8).vint(clan.id[0]).vint(clan.id[1]).string(clan.name)
            .vint(clan.badge[1] + 1).vint(clan.role).vint(clan.level).bool(false).bool(false)
        }
      }
      else if (part.field === 'emotes' && part.type === 'nativeEmotes') { if (emotes) writeEmotes(writer, state.emoteDeck); else writer.raw(Buffer.alloc(72)) }
      else if (part.field === 'profileStatistics' && part.type === 'nativeStatistics') {
        writer.vint(state.threeCrownWins ? 4 : 3).dataReference([5, 6]).vint(state.bestTrophies)
          .dataReference([5, 27]).vint(1).dataReference([5, 8]).vint(data === unlockedHome || data === unlockedProfile ? unlockedHome.cards.length : 8)
        if (state.threeCrownWins) writer.dataReference([5, 7]).vint(state.threeCrownWins)
      }
      else if (part.field === 'resourceBalances' && part.type === 'nativeResources') {
        const freeGoldPresent = state.freeGold > 0
        writer.vint(freeGoldPresent ? 2 : 1).dataReference([5, 1]).vint(state.gold)
        if (freeGoldPresent) writer.dataReference([5, 5]).vint(state.freeGold)
      }
      else if (['selectedDeck', 'gold', 'gems', 'freeGems', 'nameChangeCount', 'homeFlags', 'trophies', 'battles', 'wins', 'losses'].includes(part.field) && part.type === 'vint') writer.vint(state[part.field])
      else throw new Error('Invalid starter Home binding')
    }
    return { payload: writer.toBuffer(), version: data.version }
  }
}

async function loadHomeProvider ({ mode, templatePath, party = false } = {}) {
  mode = mode || (templatePath ? 'template' : 'disabled')
  if (!['disabled', 'starter', 'template'].includes(mode)) throw new Error('Invalid HOME_MODE; use disabled, starter or template')
  if (mode !== 'template' && templatePath) throw new Error('HOME_TEMPLATE_PATH requires HOME_MODE=template')
  if (mode === 'template' && !templatePath) throw new Error('HOME_MODE=template requires HOME_TEMPLATE_PATH')
  if (mode === 'starter') return createStarterHomeProvider({ party })
  return mode === 'template' ? loadHomeTemplate(templatePath) : null
}

module.exports = { loadHomeTemplate, createStarterHomeProvider, createStarterProfileProvider, loadHomeProvider }
