'use strict'
const { ProtocolError } = require('../lib/protocol/stream')
const { starter } = require('./data/starter-home.json')
const { cards } = require('./data/unlocked-home.json')
const ownedCards = new Set(cards.map(card => card.id))
const { packs } = require('./data/resource-packs.json')
const { isArena1BoostCommand, validateArena1Boost, claimArena1Boost } = require('./arena-boost')

function playerState (account) {
  const state = account.starter === undefined ? { selectedDeck: 0 } : account.starter
  selectedDeck(account)
  const read = (key, fallback) => Object.hasOwn(state, key) ? state[key] : fallback
  const value = {
    selectedDeck: state.selectedDeck,
    decks: read('decks', Array.from({ length: 5 }, () => [...starter.deckIds])),
    gold: read('gold', 100),
    gems: read('gems', 100),
    freeGems: read('freeGems', read('gems', 100)),
    // Existing accounts were previously advertised as named. Keep that state
    // during migration; newly allocated accounts explicitly start unnamed.
    nameSet: read('nameSet', true),
    nameChangeCount: read('nameChangeCount', 0),
    arena1Boost: validateArena1Boost(read('arena1Boost', null)),
  }
  if (!Array.isArray(value.decks) || value.decks.length !== 5) throw new ProtocolError('Invalid starter decks')
  for (const deck of value.decks) validateDeck(deck)
  for (const key of ['gold', 'gems', 'freeGems']) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 2147483647) throw new ProtocolError('Invalid starter resources')
  }
  if (value.freeGems > value.gems) throw new ProtocolError('Invalid starter resources')
  if (typeof value.nameSet !== 'boolean' || !Number.isInteger(value.nameChangeCount) || value.nameChangeCount < -1 || value.nameChangeCount > 2147483646 || (!value.nameSet && value.nameChangeCount !== -1)) throw new ProtocolError('Invalid starter name state')
  return { ...value, decks: value.decks.map(deck => [...deck]) }
}

function validateDeck (deck) {
  if (!Array.isArray(deck) || deck.length !== 8 || new Set(deck).size !== 8 || deck.some(id => !ownedCards.has(id))) throw new ProtocolError('Invalid starter deck cards')
}

function applyCommands (account, commands, { now = Date.now } = {}) {
  const next = { ...account, starter: { ...account.starter, ...playerState(account) } }
  for (const { id, fields } of commands) {
    if (id === 805) continue // Both applied Home level and Avatar level are 1.
    if (id === 703 || id === 563) {
      const deck = fields.field_0x1c
      selectedDeck({ starter: { selectedDeck: deck } })
      if (id === 563) {
        if (fields.field_0x38 !== null) throw new ProtocolError('Foreign deck changes are not implemented')
        validateDeck(fields.field_0x20)
        next.starter.decks[deck] = [...fields.field_0x20]
      }
      next.starter.selectedDeck = deck
    } else if (isArena1BoostCommand({ id, fields })) {
      claimArena1Boost(next.starter, now)
    } else if (id === 687) {
      const reference = fields.field_0x20
      const pack = packs.find(pack => Array.isArray(reference) && reference.length === 2 && pack.reference.every((value, index) => value === reference[index]))
      if (!pack) throw new ProtocolError('Invalid gold pack')
      if (next.starter.gems < pack.gems) throw new ProtocolError('Insufficient gems')
      if (next.starter.gold + pack.gold > pack.goldLimit) throw new ProtocolError('Gold limit exceeded')
      next.starter.gems -= pack.gems
      next.starter.freeGems = Math.min(next.starter.freeGems, next.starter.gems)
      next.starter.gold += pack.gold
    } else if (id === 948) {
      // Native 0x2160d4/0x67956c permit the initial -1 -> 0 name change
      // without a level, gem or cooldown requirement. Later renames need
      // progression/price rules outside this level-1 starter implementation.
      if (next.starter.nameSet || next.starter.nameChangeCount !== -1) throw new ProtocolError('Name changes after initial naming are not implemented')
      const name = fields.field_0x20
      if (typeof name !== 'string' || !name.trim() || Buffer.byteLength(name, 'utf8') > 200 || [...name].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)) throw new ProtocolError('Invalid player name')
      next.name = name
      next.starter.nameSet = true
      next.starter.nameChangeCount = 0
    } else throw new ProtocolError('Unsupported starter command')
  }
  return next
}

function selectedDeck (account) {
  if (account.starter === undefined) return 0
  const value = account.starter?.selectedDeck
  if (typeof account.starter !== 'object' || Array.isArray(account.starter) || !Number.isInteger(value) || value < 0 || value > 4) throw new ProtocolError('Invalid starter deck selection')
  return value
}

module.exports = { selectedDeck, playerState, validateDeck, applyCommands }
