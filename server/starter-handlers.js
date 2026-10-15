'use strict'
const { decodeEndClientTurn, UnverifiedCommandError } = require('../lib/protocol/commands')
const { ProtocolError } = require('../lib/protocol/stream')

function createStarterHandlers ({ store, logger = () => {}, traceNetwork = false }) {
  return new Map([[13597, async (session, fields, frame) => {
    let turn
    try { turn = decodeEndClientTurn(frame.payload) } catch (error) {
      if (!(error instanceof UnverifiedCommandError)) throw error
      logger({ event: 'unsupported-turn-command', id: error.id, applied: false })
      return
    }
    // Validate the complete batch before making a persistent change. Known wire
    // formats alone do not implement their gameplay, prices or preconditions.
    // Native 805 synchronizes Home's applied level with Avatar. Both are fixed
    // at 1 in this starter profile, so its native executor returns 0 unchanged.
    const unsupported = [...new Set(turn.commands.filter(command => ![703, 805].includes(command.id)).map(command => command.id))]
    if (unsupported.length || turn.field_0x98 !== null) {
      logger({ event: 'unsupported-turn', commandIds: unsupported, extraData: turn.field_0x98 !== null, applied: false })
      return
    }
    const selections = turn.commands.filter(command => command.id === 703)
    for (const command of selections) {
      const deck = command.fields.field_0x1c
      if (!Number.isInteger(deck) || deck < 0 || deck > 4) throw new ProtocolError('Invalid starter deck selection')
    }
    if (selections.length) {
      const deck = selections.at(-1).fields.field_0x1c
      session.account = await store.selectDeck(session.account, deck)
      logger({ event: 'starter-deck-selected', selectedDeck: deck, commands: turn.commands.length })
    } else if (traceNetwork) logger({ event: 'client-turn', commands: turn.commands.length })
  }]])
}

module.exports = { createStarterHandlers }
