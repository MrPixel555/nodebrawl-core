'use strict'
const assert = require('node:assert/strict')
const { BattleEngine, battleDefinition } = require('../server/battle/engine')
const { NativeVM } = require('../server/battle/vm')
const { encodeCommandBatch } = require('../lib/protocol/commands')
const catalogue = require('../server/battle/catalogue.json')
const deck = require('../server/data/starter-home.json').starter.deckIds
const cards = require('../server/data/unlocked-home.json').cards

// Only Android's GameClient singleton and the desync UI callback are adapted.
// Snapshot, SectorCommand parsing, rollback, ticking, command execution,
// targeting, damage, elixir and checksums execute the original ARM64 code.
class NativeBattleClient {
  constructor (engine, slot = 0) {
    this.vm = engine.vm
    const v = this.vm, snapshot = engine.snapshot(slot), input = v.stream(snapshot)
    this.game = v.alloc(0x200)
    v.call(0x3cd494, this.game, 1)
    v.call(0x1d6044, v.qword(this.game + 0xa0), engine.identity)
    assert.equal(v.call(v.qword(v.qword(input.stream) + 0xb8), input.stream), 1)
    v.call(0x6123b8, this.game, input.stream)
    v.call(0x431508, this.game, input.stream, 1, 0)
    assert.equal(v.integer(input.stream + 0x14), snapshot.length)
    this.hashStream = v.alloc(0x20); v.call(0x631120, this.hashStream)
    this.client = v.alloc(0x200)
    v.integer(this.client + 0x40, 1); v.qword(this.client + 0x78, this.game)
    v.qword(this.client + 0x68, v.alloc(0x20))
    v.activeClient = this.client
    v.hook(0x698448, () => v.ret(v.activeClient))
    v.hook(0x24e7c4, () => { v.clientDesyncs = (v.clientDesyncs || 0) + 1; v.ret() })
    this.messageInput = v.stream()
    this.message = v.alloc(0xb0)
    v.call(0x62198c, this.message)
    assert.equal(this.checksum(), engine.checksum())
  }

  get tick () { return this.vm.integer(this.game + 0x58) }
  checksum () { return this.vm.call(0x121748, this.game, this.hashStream, 0, 0, 0) | 0 }

  receive (result, commands) {
    assert.equal(result.tick % 10, 0)
    const v = this.vm, wire = encodeCommandBatch({ field_0x80: result.tick / 10, field_0x7c: result.checksum, commands })
    // Native message decoders append into a newly constructed vector; they do
    // not clear the old command count when the next packet has zero commands.
    v.call(0x62198c, this.message)
    const s = this.messageInput.stream
    v.write(this.messageInput.buffer, wire)
    for (const [offset, value] of [[0x14, 0], [0x18, wire.length], [0x1c, 0], [0x2c, wire.length]]) v.integer(s + offset, value)
    v.write(this.message + 0x10, v.read(s, 0x68))
    v.call(0x217b98, this.message)
    assert.equal(v.integer(this.message + 0x24), wire.length)
    v.activeClient = this.client
    assert.equal(v.call(0x247f54, this.client, this.message), 1)
    for (let n = 0; this.tick < result.tick && n < 200; n++) v.call(0x737a44, this.game)
    assert.equal(this.tick, result.tick)
    assert.equal(this.checksum(), result.checksum, 'Native client simulation checksum diverged')
    assert.equal(v.clientDesyncs || 0, 0, 'Native client rejected a sector checksum')
  }
}

async function verifyBattle ({ fullMatch = false, allLocations = false, allTrainers = false, allCards = false, log = console.log } = {}) {
  const report = { librarySha256: catalogue.librarySha256, runtime: 'Node.js + Unicorn WebAssembly; no Python or child process', androidUIVerified: false }
  const options = { players: [{ id: [0, 123], name: 'Player', deck }], training: true, seed: 42, time: 1600000000 }
  const engine = await BattleEngine.create(options)
  try {
    const client = new NativeBattleClient(engine)
    let commands = 0
    for (let n = 0; n < 40; n++) {
      if (engine.tick >= 160 && engine.tick % 40 === 0) engine.botInput(1)
      const result = engine.step(10), announced = engine.drainCommands()
      commands += announced.length
      client.receive(result, announced)
    }
    assert.ok(commands > 0)
    report.nativeClient = { ticks: engine.tick, announcedCommands: commands, sectorChecksumsMatched: true, desyncCallbacks: engine.vm.clientDesyncs || 0 }
    log('Native online snapshot, original SectorCommand consumer and 400 simulation ticks: PASS')
  } finally { engine.close() }

  if (allLocations) {
    const vm = await NativeVM.create()
    try {
      let total = 0
      for (const location of catalogue.locations) {
        const team = location.tilemap.includes('2v2') || location.tilemap.includes('3v3')
        const definition = battleDefinition({ players: Array.from({ length: team ? 4 : 2 }, (_, i) => ({ id: [0, i + 1], name: 'Probe' + i, deck })), locationId: location.id, modeId: team ? 72000014 : 72000006, seed: 42, time: 1600000000 })
        const battle = new BattleEngine(vm, definition)
        const snapshot = battle.snapshot(), input = vm.stream(snapshot), fresh = vm.alloc(0x200)
        vm.call(0x3cd494, fresh, 1)
        vm.call(0x1d6044, vm.qword(fresh + 0xa0), battle.identity)
        vm.call(vm.qword(vm.qword(input.stream) + 0xb8), input.stream)
        vm.call(0x6123b8, fresh, input.stream)
        vm.call(0x431508, fresh, input.stream, 1, 0)
        assert.equal(vm.integer(input.stream + 0x14), snapshot.length)
        const checksum = vm.alloc(0x20); vm.call(0x631120, checksum)
        assert.equal(vm.call(0x121748, fresh, checksum, 0, 0, 0) | 0, battle.checksum())
        total++
      }
      report.locations = { loaded: total, nativeWorldSnapshotsDecoded: total, scope: 'Geometry and snapshot codecs; four-player probe for team maps, including the unused 3v3 geometry. Not Android mode/UI validation.' }
      log('Original level geometry and native snapshot decode for ' + total + ' locations: PASS')
    } finally { vm.close() }
  }

  if (fullMatch) {
    const battle = await BattleEngine.create({ ...options, training: false, players: [{ id: [0, 123], name: 'First', deck }, { id: [0, 124], name: 'Second', deck }] })
    try {
      const start = performance.now()
      while (!battle.ended && battle.tick < 10000) {
        if (battle.tick % 40 === 0) { battle.botInput(0); battle.botInput(1) }
        battle.step(10); battle.drainCommands()
      }
      const result = battle.status()
      assert.equal(result.ended, true)
      assert.equal(result.tick % 10, 0)
      assert.ok(result.crowns.some(value => value > 0))
      assert.ok([-1, 0, 1].includes(result.winner))
      report.fullMatch = { ...result, elapsedMs: Math.round(performance.now() - start), scope: 'Original native combat, bot commands, towers, damage, match end and checksum. Android battle UI remains unverified.' }
      log('Full native battle: PASS; tick ' + result.tick + ', crowns ' + result.crowns.join('-'))
    } finally { battle.close() }
  }
  if (allTrainers) {
    const vm = await NativeVM.create()
    try {
      const trainers = catalogue.npcs.filter(row => row.TrainingMatchAllowed.toLowerCase() === 'true')
      let total = 0
      for (const npc of trainers) {
        const battle = new BattleEngine(vm, battleDefinition({ ...options, npcId: npc.id }))
        const snapshot = battle.snapshot()
        assert.ok(snapshot.length > 100)
        assert.equal(battle.status().crowns.length, 2)
        total++
      }
      report.trainers = { constructed: total, scope: 'All source NPC rows with TrainingMatchAllowed; original decks, levels, location, towers and snapshot encoder. Does not assert Android UI or identical official-server AI policy.' }
      log('Original Training world and snapshot construction for ' + total + ' trainers: PASS')
    } finally { vm.close() }
  }
  if (allCards) {
    const vm = await NativeVM.create()
    try {
      let total = 0
      for (const card of cards) {
        const chosen = [card.id, ...deck.filter(id => id !== card.id).slice(0, 7)]
        const battle = new BattleEngine(vm, battleDefinition({ ...options, training: false, players: [{ id: [0, 123], name: 'Probe', deck: chosen }, { id: [0, 124], name: 'Other', deck }] }))
        const player = vm.qword(battle.world + 0xd0)
        // Explicit fixture inputs make every owned card affordable and in hand;
        // no validators, spell executors or game instructions are replaced.
        vm.integer(battle.game + 0x58, 160); vm.integer(player + 0x1e0, 10); vm.integer(player + 0x190, 0)
        const object = battle.nativeCommand({
          id: 2,
          fields: {
            field_0x10: 160,
            field_0xc: 180,
            field_0x14: [0, 123],
            field_0x1c: 0,
            field_0x20: 0,
            field_0x24: card.id,
            field_0x30: 1,
            field_0x34: false,
            field_0x38: null,
            field_0x28: 9000,
            field_0x2c: 23000,
          },
        })
        assert.equal(vm.call(0x5deac4, object, battle.game, 3, 0), 0, 'Native cast rejected card ' + card.id)
        battle.destroyCommand(object)
        total++
      }
      report.cards = { acceptedByOriginalExecutor: total, syntheticInputs: { tick: 160, elixir: 10, handSlot: 0 }, scope: 'Isolated cast validation/execution for all unlocked cards, not full combat coverage for every interaction.' }
      log('Original spell executor accepted all ' + total + ' unlocked cards: PASS')
    } finally { vm.close() }
  }
  return report
}

if (require.main === module) verifyBattle({ fullMatch: process.argv.includes('--full-match'), allLocations: process.argv.includes('--all-locations'), allTrainers: process.argv.includes('--all-trainers'), allCards: process.argv.includes('--all-cards') }).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { NativeBattleClient, verifyBattle }
