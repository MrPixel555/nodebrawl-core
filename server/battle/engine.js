'use strict'
const { NativeVM } = require('./vm')
const catalogue = require('./catalogue.json')
const { Reader, ProtocolError } = require('../../lib/protocol/stream')
const { encodeCommand } = require('../../lib/protocol/commands')

const BATTLE_COMMANDS = new Set([2, 18, 28, 49, 57])
const sameId = (a, b) => Array.isArray(a) && a.length === 2 && a.every((n, i) => n === b[i])

function battleDefinition ({ players, training = false, npcId = 18000007, arenaId = 54000001, modeId = null, locationId = null, seed = 2, time = Math.floor(Date.now() / 1000) }) {
  if (!Array.isArray(players) || ![1, 2, 4].includes(players.length)) throw new ProtocolError('Invalid battle roster')
  const arena = catalogue.arenas.find(row => row.id === arenaId)
  const npc = training ? catalogue.npcs.find(row => row.id === npcId && row.TrainingMatchAllowed.toLowerCase() === 'true') : null
  if (!arena || (training && !npc)) throw new ProtocolError('Invalid battle arena or trainer')
  const mode = catalogue.modes.find(row => row.id === (modeId ?? (training ? 72000008 : 72000006)))
  if (!mode || !['PvP', 'TvT'].includes(mode.Players) || mode.DeckSelection !== 'Collection') throw new ProtocolError('Unsupported battle mode')
  const roster = players.map(player => ({ ...player, id: [...player.id], deck: [...player.deck] }))
  if (training) {
    if (players.length !== 1) throw new ProtocolError('Training requires one human player')
    const deck = catalogue.decks[npc.PredefinedDeck]
    if (!deck || deck.length < 1 || deck.length > 32) throw new ProtocolError('Trainer deck is unavailable')
    roster.push({ id: [-1, npc.id], name: 'Trainer', level: Number(npc.ExpLevel), deck: deck.map(card => card.d), nativeDeck: deck, bot: true })
  }
  const count = mode.Players === 'TvT' ? 4 : 2
  if (roster.length !== count) throw new ProtocolError('Battle mode and player count do not match')
  const ids = new Set()
  for (const player of roster) {
    if (!Array.isArray(player.id) || player.id.length !== 2 || !player.id.every(n => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647) || ids.has(player.id.join(':'))) throw new ProtocolError('Invalid or duplicate battle identity')
    ids.add(player.id.join(':'))
    if (typeof player.name !== 'string' || Buffer.byteLength(player.name) > 60 || !Array.isArray(player.deck) || (player.nativeDeck ? player.deck.length < 1 || player.deck.length > 32 : player.deck.length !== 8 || new Set(player.deck).size !== 8) || player.deck.some(id => !catalogue.spells.some(spell => spell.id === id))) throw new ProtocolError('Invalid battle player')
  }
  const arenaName = mode.FixedArena || arena.Name
  const actualArena = catalogue.arenas.find(row => row.Name === arenaName) || arena
  const locationName = training ? npc.Location : roster.length === 4 ? actualArena.TeamVsTeamLocation : actualArena.PvpLocation
  const location = catalogue.locations.find(row => locationId === null ? row.name === locationName : row.id === locationId)
  if (!location) throw new ProtocolError('Battle location is unavailable')
  if (!Number.isInteger(seed) || seed < 1 || seed > 2147483647 || !Number.isInteger(time) || time < 1 || time > 2147483647) throw new ProtocolError('Invalid battle clock or seed')
  const battle = { gmt: training ? 3 : 1, plt: roster.length === 4 ? 2 : 1, gamemode: mode.id, location: location.id, arena: actualArena.id, hbd: roster.map(() => ({ em: {} })) }
  if (training) battle.NPC = npc.id
  roster.forEach((player, index) => {
    battle['avatar' + index] = { 'accountID.hi': player.id[0], 'accountID.lo': player.id[1], name: player.name, expLevel: player.level ?? 1, expPoints: 0, arena: actualArena.id }
    battle['deck' + index] = player.nativeDeck || player.deck.map(d => ({ d, l: 0, c: 1 }))
  })
  return { root: { rndSeed: seed, time, battle, cmd: [], evt: [] }, roster, arena: actualArena, location, mode, training }
}

class BattleEngine {
  static async create (options) {
    const definition = battleDefinition(options)
    const vm = await NativeVM.create()
    try { return new BattleEngine(vm, definition) } catch (error) { vm.close(); throw error }
  }

  constructor (vm, definition) {
    this.vm = vm
    this.definition = definition
    const v = vm
    this.game = v.alloc(0x200)
    v.call(0x3cd494, this.game, 1)
    this.world = v.qword(this.game + 0xa0)
    this.identity = v.alloc(8)
    this.setOwner(0)
    // The original high-level JSON initializer supplies level, towers, native
    // avatars, decks and appearance objects. Its replay container starts empty.
    // World 0 is the online command path (6c2fe8); 1/2/3 are local modes.
    v.call(0x2211f0, this.game, v.json(definition.root), 0, 0)
    v.call(0x5e10e8, this.world, 0)
    v.integer(this.game + 0x1c4, 0)
    v.call(0x2da9e8, this.game, 1)
    if (v.integer(this.world + 0x50) !== definition.roster.length) throw Error('Native battle roster mismatch')
    this.output = v.stream()
    this.input = v.stream()
    this.hashStream = v.alloc(0x20)
    v.call(0x631120, this.hashStream)
    this.pending = []
    this.accepted = []
    this.inputsSeen = new Map()
    this.botRandom = definition.root.rndSeed
    this.closed = false
  }

  setOwner (slot) {
    const id = this.definition.roster[slot]?.id
    if (!id) throw new ProtocolError('Invalid battle owner')
    this.vm.integer(this.identity, id[0]); this.vm.integer(this.identity + 4, id[1])
    this.vm.call(0x1d6044, this.world, this.identity)
  }

  get tick () { return this.vm.integer(this.game + 0x58) }
  get ended () { return this.vm.read(this.world + 0x188, 1)[0] !== 0 }

  resetOutput () {
    for (const offset of [0xc, 0x10, 0x14, 0x1c]) this.vm.integer(this.output.stream + offset, 0)
  }

  snapshot (slot = 0, includeInitialization = true) {
    this.setOwner(slot)
    this.resetOutput()
    const v = this.vm, s = this.output.stream
    const manager = v.qword(this.game + 0x30), temporary = []
    if (v.integer(manager + 0xc) !== 0) throw Error('Unexpected native battle command queue')
    try {
      // Reconnecting clients must receive inputs already announced to the old
      // socket but still waiting for their native twenty-tick execution delay.
      for (const input of this.pending) {
        const object = this.nativeCommand(input.command)
        temporary.push(object); v.call(0x335d08, manager, object)
      }
      v.call(0x487e90, s, Number(includeInitialization))
      if (includeInitialization) v.call(0x15a920, this.game, s, 1, 0, 1)
      v.call(0x121748, this.game, s, 1, 0, 0)
      return v.read(v.qword(s + 0x20), v.integer(s + 0x14))
    } finally {
      v.integer(manager + 0xc, 0)
      for (const object of temporary) this.destroyCommand(object)
    }
  }

  checksum () { return this.vm.call(0x121748, this.game, this.hashStream, 0, 0, 0) | 0 }

  nativeCommand (command) {
    const wire = encodeCommand(command), reader = new Reader(wire)
    reader.vint()
    const payload = wire.subarray(reader.offset), v = this.vm, s = this.input.stream
    v.write(this.input.buffer, payload)
    v.integer(s + 0x14, 0); v.integer(s + 0x18, payload.length); v.integer(s + 0x1c, 0); v.integer(s + 0x2c, payload.length)
    const object = v.call(0x41a1dc, command.id)
    if (!object) throw new ProtocolError('Unknown native battle command')
    try {
      v.call(v.qword(v.qword(object) + 0x30), object, s)
      if (v.integer(s + 0x14) !== payload.length) throw Error('Native battle command boundary mismatch')
      return object
    } catch (error) { this.destroyCommand(object); throw error }
  }

  destroyCommand (object) {
    const v = this.vm
    v.call(v.qword(v.qword(object)), object)
    v.call(v.qword(v.qword(object) + 0x10), object)
  }

  queue (slot, command, { bot = false } = {}) {
    if (this.ended) throw new ProtocolError('Battle has ended')
    const player = this.definition.roster[slot]
    if (!player || !BATTLE_COMMANDS.has(command?.id) || !sameId(command.fields?.field_0x14, player.id)) throw new ProtocolError('Invalid battle command owner or type')
    if (this.pending.length >= 128) throw new ProtocolError('Battle input queue limit exceeded')
    // Online native prediction executes a command twenty ticks after creation.
    // Preserve this delay, and bound client timestamps instead of fast-forwarding.
    const requested = command.fields.field_0x10
    if (!Number.isInteger(requested) || requested < this.tick - 40 || requested > this.tick + 40) throw new ProtocolError('Battle command tick is outside the accepted window')
    if (command.id === 2 && (command.fields.field_0x38 !== null || command.fields.field_0x34)) throw new ProtocolError('Client cannot supply or replace a battle card')
    const fingerprint = slot + ':' + encodeCommand(command).toString('hex')
    if (this.inputsSeen.has(fingerprint)) return { accepted: false, duplicate: true }
    this.inputsSeen.set(fingerprint, this.tick)
    for (const [seen, at] of this.inputsSeen) if (at < this.tick - 80) this.inputsSeen.delete(seen)
    if (this.inputsSeen.size > 1024) throw new ProtocolError('Battle input rate limit exceeded')
    const scheduled = Math.max(this.tick + 1, requested + 20)
    const normalized = { id: command.id, fields: { ...command.fields, field_0x10: scheduled - 20, field_0xc: scheduled, field_0x14: [...player.id] } }
    const object = this.nativeCommand(normalized), v = this.vm
    const result = v.call(v.qword(v.qword(object) + 0x18), object, this.game, 1, 0) | 0
    this.destroyCommand(object)
    // Code 22 is the original pre-battle countdown: revalidate at execution.
    if (result !== 0 && !(command.id === 2 && result === 22)) return { accepted: false, result }
    this.pending.push({ slot, command: normalized, tick: scheduled, bot })
    this.accepted.push(normalized)
    return { accepted: true, tick: scheduled }
  }

  step (count = 10) {
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new ProtocolError('Invalid battle step count')
    const v = this.vm, executed = []
    for (let n = 0; n < count; n++) {
      // SectorCommand reports tick / 10. Finish on that boundary so the final
      // checksum describes the exact tick advertised to native clients.
      if (this.ended && this.tick % 10 === 0) break
      const due = this.pending.filter(input => input.tick <= this.tick)
      this.pending = this.pending.filter(input => input.tick > this.tick)
      for (const input of due) {
        const object = this.nativeCommand(input.command)
        const result = v.call(v.qword(v.qword(object) + 0x18), object, this.game, 3, 0) | 0
        this.destroyCommand(object)
        executed.push({ slot: input.slot, id: input.command.id, result })
      }
      v.call(0x24b7fc, this.game)
    }
    return { ...this.status(), executed }
  }

  botInput (slot) {
    const v = this.vm, player = v.qword(this.world + 0xd0 + slot * 8)
    if (!player || this.ended || this.pending.some(input => input.slot === slot)) return null
    this.botRandom = (Math.imul(this.botRandom, 1664525) + 1013904223) >>> 0
    const first = this.botRandom % 4
    for (let n = 0; n < 4; n++) {
      const hand = (first + n) % 4, spell = v.call(0x13d174, player, hand)
      if (!spell) continue
      const data = v.call(0x704010, spell)
      const command = {
        id: 2,
        fields: {
          field_0x10: this.tick,
          field_0xc: this.tick + 20,
          field_0x14: [...this.definition.roster[slot].id],
          field_0x1c: v.integer(player + 0x190 + hand * 4),
          field_0x20: 0,
          field_0x24: v.integer(data + 0x20),
          field_0x30: 1,
          field_0x34: false,
          field_0x38: null,
          field_0x28: this.botRandom & 8 ? 3500 : 14500,
          field_0x2c: slot % 2 === 0 ? 21000 : 11000,
        },
      }
      const result = this.queue(slot, command, { bot: true })
      if (result.accepted) return command
    }
    return null
  }

  drainCommands () { const commands = this.accepted; this.accepted = []; return commands }

  status () {
    const v = this.vm
    const players = this.definition.roster.map((_, i) => v.qword(this.world + 0xd0 + i * 8))
    const crowns = players.map((player, i) => Math.max(0, Math.min(3, v.call(0x1f8b84, player, players[i ^ 1]))))
    return { tick: this.tick, ended: this.ended, winner: this.ended ? v.integer(this.world + 0x160) : null, crowns, elixir: players.map(p => v.call(0x11126c, p)), checksum: this.checksum() }
  }

  close () { if (!this.closed) { this.closed = true; this.vm.close() } }
}

module.exports = { BattleEngine, battleDefinition, BATTLE_COMMANDS }
