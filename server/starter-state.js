'use strict'
const { ProtocolError } = require('../lib/protocol/stream')
const { starter } = require('./data/starter-home.json')
const { cards } = require('./data/unlocked-home.json')
const ownedCards = new Set(cards.map(card => card.id))
const { packs } = require('./data/resource-packs.json')
const { isArena1BoostCommand, validateArena1Boost, claimArena1Boost } = require('./arena-boost')
const { isValidPlayerName } = require('./name-handlers')
const { inventoryFor, validateInventory, activateDeck, swapCard } = require('./decks')
const { isFreePassGoldCommand, claimFreePassGold, markPassSeen } = require('./season-pass')

function playerState (account) {
  const state = account.starter === undefined ? { selectedDeck: 0 } : account.starter
  selectedDeck(account)
  const read = (key, fallback) => Object.hasOwn(state, key) ? state[key] : fallback
  const value = {
    selectedDeck: state.selectedDeck,
    decks: read('decks', Array.from({ length: 5 }, () => [...starter.deckIds])),
    gold: read('gold', 100),
    freeGold: read('freeGold', 0),
    gems: read('gems', 100),
    freeGems: read('freeGems', read('gems', 100)),
    // Existing accounts were previously advertised as named. Keep that state
    // during migration; newly allocated accounts explicitly start unnamed.
    nameSet: read('nameSet', true),
    nameChangeCount: read('nameChangeCount', 0),
    arena1Boost: validateArena1Boost(read('arena1Boost', null)),
    freePassGoldClaimed: read('freePassGoldClaimed', false),
    passCrowns: read('passCrowns', 0),
    passSeenCrowns: read('passSeenCrowns', -1),
    passInitialized: read('passInitialized', state.freePassGoldClaimed === true || state.passCrowns > 0 || state.passSeenCrowns >= 0),
    homeFlags: read('homeFlags', 0),
  }
  if (!Array.isArray(value.decks) || value.decks.length !== 5) throw new ProtocolError('Invalid starter decks')
  for (const deck of value.decks) validateDeck(deck)
  value.inventory = read('inventory', inventoryFor(value.decks[value.selectedDeck]))
  validateInventory(value.inventory, value.decks[value.selectedDeck])
  for (const key of ['gold', 'freeGold', 'gems', 'freeGems']) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 2147483647) throw new ProtocolError('Invalid starter resources')
  }
  if (value.freeGems > value.gems) throw new ProtocolError('Invalid starter resources')
  if (typeof value.freePassGoldClaimed !== 'boolean') throw new ProtocolError('Invalid season pass claim state')
  if (!Number.isInteger(value.passCrowns) || value.passCrowns < 0 || value.passCrowns > 2147483647 || !Number.isInteger(value.passSeenCrowns) || value.passSeenCrowns < -1 || value.passSeenCrowns > value.passCrowns) throw new ProtocolError('Invalid season pass progress')
  if (typeof value.passInitialized !== 'boolean') throw new ProtocolError('Invalid season pass initialization state')
  if (!Number.isInteger(value.homeFlags) || value.homeFlags < 0 || value.homeFlags > 30 || (value.homeFlags & ~30) !== 0) throw new ProtocolError('Invalid Home flags')
  if (typeof value.nameSet !== 'boolean' || !Number.isInteger(value.nameChangeCount) || value.nameChangeCount < -1 || value.nameChangeCount > 2147483646 || (!value.nameSet && value.nameChangeCount !== -1)) throw new ProtocolError('Invalid starter name state')
  return { ...value, decks: value.decks.map(deck => [...deck]), inventory: [...value.inventory] }
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
      const target = id === 563 ? fields.field_0x20 : next.starter.decks[deck]
      if (id === 563) {
        if (fields.field_0x38 !== null) throw new ProtocolError('Foreign deck changes are not implemented')
        validateDeck(fields.field_0x20)
      }
      activateDeck(next.starter, target)
      if (id === 563) next.starter.decks[deck] = [...target]
      next.starter.selectedDeck = deck
    } else if (id === 693) {
      swapCard(next.starter, fields)
    } else if (id === 869) {
      if (!Number.isInteger(fields.field_0x1c) || fields.field_0x1c < 1 || fields.field_0x1c > 4) throw new ProtocolError('Invalid Home flag selector')
      next.starter.homeFlags |= 1 << fields.field_0x1c
    } else if (isArena1BoostCommand({ id, fields })) {
      claimArena1Boost(next.starter, now)
    } else if (isFreePassGoldCommand({ id, fields })) {
      claimFreePassGold(next.starter)
    } else if (id === 762) {
      markPassSeen(next.starter, fields.field_0x1c)
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
      if (!isValidPlayerName(name)) throw new ProtocolError('Invalid player name')
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
