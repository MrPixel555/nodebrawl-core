'use strict'
const { randomBytes, randomInt } = require('node:crypto')
const { BattleProcess } = require('./process')
const { playerState } = require('../starter-state')
const { ProtocolError } = require('../../lib/protocol/stream')
const { encodeSectorStateEnvelope } = require('../../lib/protocol/sector-state')
const { encodeCommand } = require('../../lib/protocol/commands')
const catalogue = require('./catalogue.json')

const key = account => account.id.join(':')
const alive = session => session && !session.socket.destroyed
const commandKey = command => encodeCommand(command).toString('hex')

class BattleCoordinator {
  constructor ({ store, homeProvider, logger = () => {}, traceNetwork = false, processFactory = options => new BattleProcess(options), maxBattles = 2, fallbackMs = 5000, disconnectMs = 60000, modeId = 72000006, arenaId = 54000001 } = {}) {
    if (!store || typeof store.recordBattle !== 'function' || typeof homeProvider !== 'function') throw new TypeError('Battle store and Home provider required')
    if (!Number.isInteger(maxBattles) || maxBattles < 1 || maxBattles > 8 || !Number.isInteger(fallbackMs) || fallbackMs < 0 || fallbackMs > 300000 || !Number.isInteger(disconnectMs) || disconnectMs < 1) throw new TypeError('Invalid battle limits')
    this.store = store; this.homeProvider = homeProvider; this.logger = logger; this.traceNetwork = traceNetwork
    this.processFactory = processFactory; this.maxBattles = maxBattles; this.fallbackMs = fallbackMs; this.disconnectMs = disconnectMs
    this.mode = catalogue.modes.find(row => row.id === modeId && ['PvP', 'TvT'].includes(row.Players) && row.DeckSelection === 'Collection')
    this.arena = catalogue.arenas.find(row => row.id === arenaId)
    if (!this.mode || !this.arena) throw new TypeError('Invalid configured battle mode or arena')
    this.queue = new Map()
    this.matches = new Map()
    this.owners = new Map()
    this.stopped = false
  }

  handlers () {
    return new Map([
      [17967, (session, fields) => this.training(session, fields.field_0x80)],
      [10953, (session, fields) => this.training(session, fields.field_0x88, fields.field_0x80)],
      [15263, session => this.acknowledge(session)],
      [16194, (session, fields) => this.input(session, fields)],
      [13006, session => this.cancel(session)],
      // These constructors are used by the native search/return dialogs and
      // battle end Home button. A fresh authoritative Home completes the return.
      ...[12526, 15965, 18533, 14062].map(id => [id, session => this.goHome(session)]),
    ])
  }

  active (session) { const match = this.owners.get(key(session.account)); return match && match.players.some(player => player.session === session) ? match : null }

  player (session) {
    const state = playerState(session.account)
    return { id: [...session.account.id], name: session.account.name, level: 1, deck: [...state.decks[state.selectedDeck]], session, identity: session.account, acknowledged: false }
  }

  async request (session, fields) {
    if (this.stopped || !alive(session)) return
    if (fields.field_0x20 !== 0 || fields.field_0x24 !== -1) throw new ProtocolError('This matchmaking request requires an event catalogue')
    if (this.active(session) || this.queue.has(key(session.account))) return
    const entry = this.player(session)
    entry.enqueued = Date.now()
    entry.timer = this.fallbackMs ? setTimeout(() => this.pair().catch(error => this.logError(error)), this.fallbackMs) : null
    this.queue.set(key(session.account), entry)
    this.logger({ event: 'matchmaking-queued', players: this.queue.size })
    await this.pair()
  }

  async training (session, reference, pve = [0, 0]) {
    if (this.stopped || !alive(session)) return
    if (!Array.isArray(reference) || reference[0] !== 18 || !Number.isInteger(reference[1])) throw new ProtocolError('Invalid trainer reference')
    // PvE controller/deck rules are separate from ordinary Training; do not
    // silently reinterpret a PvE request as the regular Training button.
    if (!Array.isArray(pve) || pve[0] !== 0) throw new ProtocolError('PvE challenge configuration is not enabled')
    if (this.active(session)) return
    const npc = catalogue.npcs.find(row => row.id === 18000000 + reference[1] && row.TrainingMatchAllowed.toLowerCase() === 'true')
    if (!npc) throw new ProtocolError('Trainer is not available for practice')
    this.dequeue(key(session.account))
    if (this.matches.size >= this.maxBattles) { this.logger({ event: 'battle-capacity-reached' }); await this.sendHome(session); return }
    await this.start([this.player(session)], { training: true, npcId: npc.id, modeId: 72000008 })
  }

  dequeue (id) {
    const entry = this.queue.get(id)
    if (entry) { clearTimeout(entry.timer); this.queue.delete(id) }
    return entry
  }

  async pair () {
    if (this.stopped || this.pairing) return
    this.pairing = true
    try {
      const size = this.mode.Players === 'TvT' ? 4 : 2
      while (this.matches.size < this.maxBattles && this.queue.size) {
        const entries = [...this.queue.values()].filter(entry => alive(entry.session))
        for (const [id, entry] of this.queue) if (!alive(entry.session)) this.dequeue(id)
        if (!entries.length) break
        const expired = this.fallbackMs > 0 && Date.now() - entries[0].enqueued >= this.fallbackMs
        if (entries.length < size && !expired) break
        const players = entries.slice(0, size).map(entry => this.dequeue(entry.id.join(':')))
        for (let slot = players.length; slot < size; slot++) players.push({ id: [-2, slot + 1], name: 'Practice Bot', level: 1, deck: [...players[0].deck], bot: true })
        await this.start(players, { training: false, modeId: this.mode.id })
      }
    } finally { this.pairing = false }
  }

  async start (players, options) {
    const id = randomBytes(16).toString('hex')
    const match = { id, players, options, phase: 'loading', hashes: new Map(), busy: false, finished: null, cleanup: null, stopped: false }
    this.matches.set(id, match)
    for (const player of players) if (!player.bot) this.owners.set(player.id.join(':'), match)
    const roster = players.map(({ id, name, level, deck, bot }) => ({ id, name, level, deck, bot: Boolean(bot) }))
    try {
      match.process = this.processFactory({ players: roster, arenaId: this.arena.id, seed: randomInt(1, 2147483647), time: Math.floor(Date.now() / 1000), ...options })
      const ready = await match.process.ready
      if (match.stopped || this.stopped) return
      match.status = ready.status
      match.hashes.set(ready.status.tick, ready.status.checksum)
      this.logger({ event: 'battle-created', kind: options.training ? 'training' : 'ladder', players: options.training ? 2 : players.length, bots: options.training ? 1 : players.filter(p => p.bot).length, location: ready.location })
      players.forEach((player, slot) => { if (!player.bot && alive(player.session)) player.session.sendRaw(28991, encodeSectorStateEnvelope(Buffer.from(ready.snapshots[slot]))) })
      match.loadTimer = setTimeout(() => this.abort(match, 'battle-load-timeout').catch(error => this.logError(error)), 30000)
    } catch (error) { await this.abort(match, 'battle-start-failed', error) }
  }

  async acknowledge (session) {
    const match = this.active(session)
    if (!match || match.stopped || match.phase !== 'loading') return
    match.players.find(player => player.session === session).acknowledged = true
    if (match.players.some(player => !player.bot && !player.acknowledged)) return
    clearTimeout(match.loadTimer)
    match.phase = 'running'
    this.logger({ event: 'battle-snapshot-acknowledged' })
    match.interval = setInterval(() => this.advance(match).catch(error => this.abort(match, 'battle-engine-failed', error).catch(error => this.logError(error))), 500)
  }

  async advance (match) {
    if (match.busy || match.stopped || match.phase !== 'running') return
    match.busy = true
    try {
      const result = await match.process.call('advance', { ticks: 10 })
      if (match.stopped) return
      match.status = result
      match.hashes.set(result.tick, result.checksum)
      if (match.hashes.size > 120) match.hashes.delete(match.hashes.keys().next().value)
      for (const player of match.players) { if (!player.bot && alive(player.session)) {
        // A reconnect snapshot includes inputs not yet executed. Some may also
        // still await their first broadcast; announcing them again would queue
        // the same native command twice in the reconstructed client.
        const commands = result.commands.filter(command => !player.snapshotInputs?.delete(commandKey(command)))
        player.session.send(26980, { field_0x80: Math.floor(result.tick / 10), field_0x7c: result.checksum, commands })
      } }
      if (this.traceNetwork && result.executed.length) this.logger({ event: 'battle-commands-executed', tick: result.tick, results: result.executed.map(({ id, result }) => ({ id, result })) })
      if (result.ended) await this.finish(match, result)
    } finally { match.busy = false }
  }

  async input (session, fields) {
    const match = this.active(session)
    if (!match || match.phase !== 'running' || match.stopped) return
    const slot = match.players.findIndex(player => player.session === session)
    const tick = fields.field_0x8c
    if (!Number.isInteger(tick) || tick < 0 || tick > match.status.tick + 80) throw new ProtocolError('Invalid battle input clock')
    if (fields.field_0x80) {
      try {
        const result = await match.process.call('input', { slot, command: fields.field_0x80 })
        this.logger({ event: result.accepted ? 'battle-input-accepted' : 'battle-input-rejected', id: fields.field_0x80.id, result: result.result ?? 0 })
      } catch (error) {
        if (match.process.closed) await this.abort(match, 'battle-engine-failed', error)
        else this.logger({ event: 'battle-input-rejected', id: fields.field_0x80.id, reason: error.message })
      }
    } else if (match.hashes.has(tick) && match.hashes.get(tick) !== fields.field_0x88) {
      this.logger({ event: 'battle-checksum-mismatch', tick })
      // Preserve the match and authority; resend an actual current snapshot,
      // rather than accepting a client-reported outcome or checksum as state.
      if (Date.now() - (match.lastResync || 0) > 5000) { match.lastResync = Date.now(); await this.resend(match, session, slot) }
    }
  }

  async resend (match, session, slot) {
    const result = await match.process.call('snapshot', { slot })
    if (alive(session) && !match.stopped && match.players[slot].session === session) {
      match.players[slot].snapshotInputs = new Set(result.pendingCommands.map(commandKey))
      session.sendRaw(28991, encodeSectorStateEnvelope(Buffer.from(result.snapshot)))
    }
  }

  async finish (match, result) {
    if (match.finished) return match.finished
    clearInterval(match.interval)
    match.phase = 'finished'
    match.finished = (async () => {
      if (![-1, 0, 1].includes(result.winner)) throw Error('Unexpected native battle winner')
      for (const [slot, player] of match.players.entries()) {
        if (player.bot) continue
        const account = await this.store.recordBattle(player.identity, { id: match.id, kind: match.options.training ? 'training' : 'ladder', slot, winner: result.winner, crowns: result.crowns[slot], arena: this.arena.id })
        player.identity = account
        if (alive(player.session)) player.session.account = account
      }
      this.logger({ event: 'battle-finished', tick: result.tick, winner: result.winner, crowns: result.crowns })
      match.cleanup = setTimeout(() => this.dispose(match).catch(error => this.logError(error)), 120000)
    })()
    return match.finished
  }

  async cancel (session) {
    if (this.dequeue(key(session.account))) {
      this.logger({ event: 'matchmaking-cancelled' })
      await this.sendHome(session)
      return
    }
    const match = this.active(session)
    if (match?.phase === 'loading') await this.abort(match, 'battle-cancelled')
    else if (!match) await this.sendHome(session)
  }

  async goHome (session) {
    this.dequeue(key(session.account))
    const match = this.active(session)
    if (match && !match.stopped) {
      if (match.phase === 'loading') await this.abort(match, 'battle-left-before-loading')
      else if (match.phase === 'running') {
        const slot = match.players.findIndex(player => player.session === session)
        const result = await match.process.call('forfeit', { slot })
        match.status = result
        await this.finish(match, result)
        for (const [other, player] of match.players.entries()) if (!player.bot && player.session !== session && alive(player.session)) await this.resend(match, player.session, other)
      }
      if (match.finished) await match.finished
      const player = match.players.find(player => player.session === session)
      if (player) player.session = null
      if (this.owners.get(key(session.account)) === match) this.owners.delete(key(session.account))
      if (match.players.every(player => player.bot || !player.session)) await this.dispose(match)
    }
    await this.sendHome(session)
  }

  async sendHome (session) {
    if (!alive(session)) return
    session.account = await this.store.login(session.account.id, session.account.token)
    const home = await this.homeProvider(session.account)
    if (alive(session)) session.sendRaw(21217, home.payload, home.version)
  }

  async login (session) {
    const match = this.owners.get(key(session.account))
    if (!match || match.stopped) return
    clearTimeout(match.awayTimer)
    const slot = match.players.findIndex(player => player.id.every((n, i) => n === session.account.id[i]))
    if (slot < 0) return
    const player = match.players[slot], previous = player.session
    player.session = session; player.identity = session.account
    if (previous && previous !== session && alive(previous)) previous.socket.destroy()
    if (match.finished) { await match.finished; await this.goHome(session); return }
    if (match.phase === 'loading') player.acknowledged = false
    await match.process.ready
    if (!match.stopped) { await this.resend(match, session, slot); this.logger({ event: 'battle-resumed' }) }
  }

  disconnect (session) {
    this.dequeue(key(session.account))
    const match = this.active(session)
    if (!match) return
    const player = match.players.find(player => player.session === session)
    player.session = null
    if (match.players.every(player => player.bot || !alive(player.session))) {
      clearTimeout(match.awayTimer)
      match.awayTimer = setTimeout(() => this.dispose(match).catch(error => this.logError(error)), this.disconnectMs)
    }
  }

  async abort (match, reason, error = null) {
    if (match.stopped) return
    this.logger({ event: reason, ...(error ? { reason: error.message } : {}) })
    const sessions = match.players.filter(player => !player.bot && alive(player.session)).map(player => player.session)
    await this.dispose(match)
    for (const session of sessions) await this.sendHome(session)
  }

  async dispose (match) {
    if (match.stopped) return
    match.stopped = true
    clearInterval(match.interval); clearTimeout(match.loadTimer); clearTimeout(match.awayTimer); clearTimeout(match.cleanup)
    this.matches.delete(match.id)
    for (const player of match.players) if (this.owners.get(player.id.join(':')) === match) this.owners.delete(player.id.join(':'))
    await match.process?.close()
    if (!this.stopped) await this.pair()
  }

  logError (error) { this.logger({ event: 'battle-service-error', reason: error.message }) }

  async stop () {
    this.stopped = true
    for (const id of this.queue.keys()) this.dequeue(id)
    await Promise.all([...this.matches.values()].map(match => this.dispose(match)))
  }
}

module.exports = { BattleCoordinator }
