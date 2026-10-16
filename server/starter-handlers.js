'use strict'
const { decodeEndClientTurn, encodeEndClientTurn, UnverifiedCommandError } = require('../lib/protocol/commands')
const { ProtocolError } = require('../lib/protocol/stream')
const { createStarterProfileProvider } = require('./home')
const { isArena1BoostCommand } = require('./arena-boost')
const { isFreePassGoldCommand } = require('./season-pass')

function createStarterHandlers ({ store, logger = () => {}, traceNetwork = false, battles = null }) {
  const profileProvider = createStarterProfileProvider()
  const handlers = new Map([[11712, async (session, fields) => {
    // AvatarStream is private to the authenticated player. Its native consumer
    // requires an allocated empty vector (00), and dereferences a null one (7f).
    if (!fields.field_0x80.every((part, index) => part === session.account.id[index])) throw new ProtocolError('Avatar stream identity does not match session')
    session.sendRaw(28299, Buffer.from([0]))
    if (traceNetwork) logger({ event: 'avatar-stream-sent', count: 0 })
  }], [12373, async (session, fields) => {
    const account = await store.findPlayer(fields.field_0x80)
    if (!account) {
      // Native profile UI 0x1b1788 handles reason 2 as an absent/deleted player.
      session.send(26360, { field_0x7c: 2, field_0x80: fields.field_0x80 })
      if (traceNetwork) logger({ event: 'player-profile-missing' })
      return
    }
    const profile = await profileProvider(account)
    session.sendRaw(22757, profile.payload, profile.version)
    if (traceNetwork) logger({ event: 'player-profile-sent' })
  }], [13597, async (session, fields, frame) => {
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
    const unsupported = [...new Set(turn.commands.filter(command => !(battles && command.id === 527) && ![563, 687, 693, 703, 762, 805, 869, 948].includes(command.id) && !isArena1BoostCommand(command) && !isFreePassGoldCommand(command)).map(command => command.id))]
    if (unsupported.length || turn.field_0x98 !== null) {
      logger({ event: 'unsupported-turn', commandIds: unsupported, turnCommandIds: turn.commands.map(command => command.id), extraData: turn.field_0x98 !== null, applied: false })
      // Keep up to eight public selectors for unresolved 595 branches even
      // without TRACE_NETWORK. Omit names, base identity fields and payloads.
      const selectors = turn.commands.filter(command => command.id === 595 && !isArena1BoostCommand(command)).slice(0, 8).map(command => ({
        field_0x1c: command.fields.field_0x1c,
        field_0x20: command.fields.field_0x20,
        field_0x28: command.fields.field_0x28,
        field_0x30: command.fields.field_0x30,
      }))
      if (selectors.length) logger({ event: 'unresolved-command-data', id: 595, gameDataReferences: selectors.map(fields => fields.field_0x28), selectors, applied: false })
      if (traceNetwork) {
        for (const command of turn.commands.filter(command => [527, 836].includes(command.id)).slice(0, 8)) {
          // Only these already-recovered public mode/reward selector fields;
          // omit base fields, account references and the complete turn bytes.
          const names = command.id === 527 ? ['field_0x1c', 'field_0x20', 'field_0x24'] : ['field_0x1c', 'field_0x20', 'field_0x21']
          logger({ event: 'unresolved-command-data', id: command.id, fields: Object.fromEntries(names.map(name => [name, command.fields[name]])), applied: false })
        }
      }
      return
    }
    const requests = turn.commands.filter(command => command.id === 527)
    if (requests.length > 1) throw new ProtocolError('Multiple matchmaking requests in one turn')
    if (requests.some(command => command.fields.field_0x20 !== 0 || command.fields.field_0x24 !== -1)) {
      logger({ event: 'matchmaking-request-rejected', reason: 'Event matchmaking requires a configured catalogue', applied: false })
      return
    }
    if (battles?.active(session) && turn.commands.length) { logger({ event: 'home-turn-during-battle', applied: false }); return }
    const homeCommands = turn.commands.filter(command => command.id !== 527)
    const mutations = homeCommands.filter(command => command.id !== 805)
    if (mutations.length) {
      try { session.account = await store.applyStarterTurn(session.account, homeCommands) } catch (error) {
        if (!(error instanceof ProtocolError)) throw error
        logger({ event: 'starter-turn-rejected', commandIds: mutations.map(command => command.id), reason: error.message, applied: false })
        return
      }
      if (mutations.some(command => command.id === 703 || command.id === 563)) logger({ event: 'starter-deck-selected', selectedDeck: session.account.starter.selectedDeck, commands: turn.commands.length })
      if (mutations.some(command => command.id === 563 || command.id === 693)) logger({ event: 'starter-deck-updated', selectedDeck: session.account.starter.selectedDeck })
      if (mutations.some(command => command.id === 948)) logger({ event: 'starter-name-set' })
      if (mutations.some(command => command.id === 687)) logger({ event: 'gold-pack-purchased' })
      if (mutations.some(isArena1BoostCommand)) logger({ event: 'arena-boost-claimed', arena: 'Arena1', seconds: 86400 })
      if (mutations.some(isFreePassGoldCommand)) logger({ event: 'free-pass-reward-claimed', tier: 0 })
      if (mutations.some(command => command.id === 869)) logger({ event: 'home-flags-updated' })
      if (traceNetwork && mutations.some(command => command.id === 762)) logger({ event: 'season-pass-seen', crowns: session.account.starter.passSeenCrowns })
    } else if (traceNetwork) logger({ event: 'client-turn', commands: turn.commands.length })
    if (requests.length) await battles.request(session, requests[0].fields)
  }]])
  if (battles) { handlers.set(12405, async (session, fields) => {
    // HomeLogicStopped carries final Home commands, with the same command
    // format as EndClientTurn and no trailing byte-array field.
    if (fields.commands.length && !battles.active(session)) await handlers.get(13597)(session, null, { payload: encodeEndClientTurn({ ...fields, field_0x98: null }) })
    if (traceNetwork) logger({ event: 'home-logic-stopped', commands: fields.commands.length })
  }) }
  return handlers
}

module.exports = { createStarterHandlers }
