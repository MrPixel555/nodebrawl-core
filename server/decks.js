'use strict'
const { ProtocolError } = require('../lib/protocol/stream')
const { cards } = require('./data/unlocked-home.json')
const owned = new Set(cards.map(card => card.id))

function inventoryFor (deck) {
  const active = new Set(deck)
  return cards.filter(card => !active.has(card.id)).map(card => card.id)
}

function validateInventory (inventory, deck) {
  const collection = [...deck, ...(Array.isArray(inventory) ? inventory : [])]
  if (!Array.isArray(inventory) || collection.length !== cards.length || new Set(collection).size !== cards.length || collection.some(id => !owned.has(id))) throw new ProtocolError('Invalid starter card inventory')
}

function activateDeck (state, target) {
  const active = [...state.decks[state.selectedDeck]]
  // Native 0x48f950 visits slots in order, swapping an existing active card
  // or replacing the matching inventory slot with the displaced active card.
  for (let slot = 0; slot < 8; slot++) {
    const wanted = target[slot]
    const other = active.indexOf(wanted)
    if (other !== -1) [active[slot], active[other]] = [active[other], active[slot]]
    else {
      const index = state.inventory.indexOf(wanted)
      if (index === -1) throw new ProtocolError('Deck card is not owned')
      ;[active[slot], state.inventory[index]] = [state.inventory[index], active[slot]]
    }
  }
}

function swapCard (state, fields) {
  const index = fields.field_0x1c
  const first = fields.field_0x20
  const second = fields.field_0x24
  const slot = value => Number.isInteger(value) && value >= 0 && value < 8
  if (!slot(first) || !Number.isInteger(index) || !Number.isInteger(second)) throw new ProtocolError('Invalid card swap selectors')
  const deck = state.decks[state.selectedDeck]
  if (index === -1) {
    if (!slot(second) || first === second) throw new ProtocolError('Invalid active card swap')
    ;[deck[first], deck[second]] = [deck[second], deck[first]]
  } else {
    if (index < 0 || index >= state.inventory.length || second !== -1) throw new ProtocolError('Invalid inventory card selectors')
    ;[deck[first], state.inventory[index]] = [state.inventory[index], deck[first]]
  }
}

module.exports = { inventoryFor, validateInventory, activateDeck, swapCard }
