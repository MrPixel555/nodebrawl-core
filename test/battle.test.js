'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { AccountStore } = require('../server/accounts')
const { BattleEngine, battleDefinition } = require('../server/battle/engine')
const { BattleProcess } = require('../server/battle/process')
const { BattleCoordinator } = require('../server/battle/coordinator')
const { NativeBattleClient } = require('../tools/verify-battle')
const { decodeSectorStateEnvelope } = require('../lib/protocol/sector-state')
const { encodeCommand, decodeCommand } = require('../lib/protocol/commands')
const deck = require('../server/data/starter-home.json').starter.deckIds

const player = (low = 123) => ({ id: [0, low], name: 'Player' + low, deck })

test('battle definitions bind source trainer/deck, arena, mode and unique owners', () => {
  const definition = battleDefinition({ players: [player()], training: true })
  assert.equal(definition.root.battle.NPC, 18000007)
  assert.equal(definition.root.battle.location, 15000001)
  assert.equal(definition.roster.length, 2)
  assert.equal(definition.roster[1].nativeDeck.length, 8)
  assert.equal(battleDefinition({ players: [player()], training: true, npcId: 18000021 }).roster[1].nativeDeck.length, 9)
  assert.equal(battleDefinition({ players: [player(), player(124)], training: false }).root.battle.location, 15000002)
  assert.throws(() => battleDefinition({ players: [player(), player()] }), /duplicate/)
  assert.throws(() => battleDefinition({ players: [player()], training: true, npcId: 18000999 }), /trainer/)
  assert.throws(() => battleDefinition({ players: [player(), player(124)], modeId: 72000014 }), /count/)
  assert.throws(() => battleDefinition({ players: [player(), player(124)], locationId: 15000999 }), /location/)
  assert.throws(() => battleDefinition({ players: [player(), player(124)], seed: 0 }), /seed/)
})

test('battle command codecs reject malformed optional descriptors and truncated coordinates', () => {
  for (const fixture of require('./fixtures/native-battle-commands.json')) {
    const wire = Buffer.from(fixture.payloadHex, 'hex')
    for (let n = 0; n < wire.length; n++) assert.throws(() => decodeCommand(wire.subarray(0, n)))
    assert.throws(() => decodeCommand(Buffer.concat([wire, Buffer.from([0])])), /trailing/)
  }
  const fixture = require('./fixtures/native-battle-commands.json')[0]
  assert.throws(() => encodeCommand({ id: 2, fields: { ...fixture.fields, field_0x38: { index: 125, level: 0, count: 1 } } }), /card index/)
  assert.throws(() => encodeCommand({ id: 2, fields: { ...fixture.fields, field_0x24: -1 } }), /data ID/)
})

test('original native snapshot, queued reconnect inputs, SectorCommand parsing and battle simulation agree', { timeout: 90000 }, async t => {
  const battle = await BattleEngine.create({ players: [player()], training: true, seed: 42, time: 1600000000 })
  t.after(() => battle.close())
  const client = new NativeBattleClient(battle)
  for (let i = 0; i < 16; i++) {
    const result = battle.step(10)
    client.receive(result, battle.drainCommands())
  }
  const command = { id: 2, fields: { ...require('./fixtures/native-battle-commands.json')[0].fields, field_0x10: 160, field_0xc: 180 } }
  const authorityPlayer = battle.vm.qword(battle.world + 0xd0)
  const reservedMana = battle.vm.integer(authorityPlayer + 0x200)
  assert.equal(battle.queue(0, command).accepted, true)
  assert.equal(battle.vm.integer(authorityPlayer + 0x200), reservedMana, 'Authority must not execute the client-prediction mana reservation branch')
  assert.equal(battle.queue(0, command).duplicate, true)
  assert.throws(() => battle.queue(0, { ...command, fields: { ...command.fields, field_0x14: [0, 124] } }), /owner/)
  assert.throws(() => battle.queue(0, { ...command, fields: { ...command.fields, field_0x10: 10000 } }), /window/)
  assert.throws(() => battle.queue(0, { id: 687, fields: command.fields }), /type/)
  assert.throws(() => battle.queue(0, { ...command, fields: { ...command.fields, field_0x34: true } }), /replace/)
  assert.throws(() => battle.queue(0, { ...command, fields: { ...command.fields, field_0x24: 26000999 } }), /owned deck/)
  assert.throws(() => battle.queue(0, { ...command, fields: { ...command.fields, field_0x28: -1 } }), /outside the map/)
  const reconnect = new NativeBattleClient(battle)
  const mana = battle.status().elixir[0]
  let executed = []
  for (let i = 0; i < 10; i++) {
    const result = battle.step(10), commands = battle.drainCommands()
    executed = executed.concat(result.executed)
    client.receive(result, commands)
    // Its original snapshot already included the pending input. Do not
    // announce the same input again to this newly reconstructed client.
    reconnect.receive(result, [])
  }
  assert.ok(executed.some(row => row.id === 2 && row.result === 0))
  assert.ok(battle.status().elixir[0] < mana)
  assert.equal(battle.vm.clientDesyncs || 0, 0)
})

test('battle scheduler repays a slow batch without dropping ticks or adding another fixed interval', async t => {
  let now = 0, tick = 0
  t.mock.method(performance, 'now', () => now)
  const timers = []
  t.mock.method(global, 'setTimeout', (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer })
  const coordinator = new BattleCoordinator({ store: { recordBattle () {} }, homeProvider: async () => {}, traceNetwork: true })
  const match = {
    clockStart: 0,
    status: { tick: 0 },
    phase: 'running',
    hashes: new Map(),
    players: [],
    process: {
      call: async (action, fields) => {
        assert.equal(action, 'advance'); assert.equal(fields.ticks, 10)
        now += tick === 0 ? 650 : 100
        tick += 10
        return { tick, checksum: tick, commands: [], executed: [], ended: false }
      },
    },
  }
  coordinator.schedule(match)
  assert.equal(timers[0].delay, 500)
  now = 500
  await timers[0].callback()
  assert.equal(match.status.tick, 10)
  assert.equal(timers[1].delay, 0)
  await timers[1].callback()
  assert.equal(match.status.tick, 20)
  assert.equal(timers[2].delay, 250)
  match.stopped = true
})

test('worker isolation constructs a four-player native arena and rejects a forged input without losing the engine', { timeout: 30000 }, async t => {
  const engine = new BattleProcess({ players: [player(1), player(2), player(3), player(4)], modeId: 72000014, seed: 42, time: 1600000000 })
  t.after(() => engine.close())
  const ready = await engine.ready
  assert.equal(ready.snapshots.length, 4)
  assert.equal(ready.status.crowns.length, 4)
  assert.ok(ready.snapshots.every(snapshot => snapshot.length > 100))
  await assert.rejects(engine.call('input', { slot: 0, command: { id: 687, fields: {} } }), /owner or type/)
  assert.equal(engine.closed, false)
  const snapshot = await engine.call('snapshot', { slot: 3 })
  assert.equal(snapshot.status.tick, 0)
  const end = await engine.call('forfeit', { slot: 0 })
  assert.equal(end.ended, true)
  assert.equal(end.winner, 1)
})

test('authoritative battle rewards are atomic, bounded, persisted, authenticated and idempotent across restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-battle-results-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new AccountStore(directory), account = await store.login([0, 0], null)
  const result = { id: 'a'.repeat(32), kind: 'ladder', slot: 0, winner: 0, crowns: 3, arena: 54000001 }
  const [first, repeated] = await Promise.all([store.recordBattle(account, result), store.recordBattle(account, result)])
  assert.equal(first.starter.gold, 105); assert.equal(first.starter.passCrowns, 3)
  assert.deepEqual(first, repeated)
  const restarted = new AccountStore(directory)
  assert.deepEqual(await restarted.recordBattle(account, result), first)
  assert.equal(first.token, account.token); assert.equal(first.starter.gems, 100)
  const training = await restarted.recordBattle(account, { ...result, id: 'b'.repeat(32), kind: 'training' })
  assert.equal(training.starter.gold, 105); assert.equal(training.starter.passCrowns, 3)
  assert.equal(training.battleHistory.length, 2)
  assert.equal(training.battleHistory[1].outcome, 'win')
  await assert.rejects(store.recordBattle({ ...account, token: 'invalid' }, { ...result, id: 'c'.repeat(32) }), /credentials/)
  await assert.rejects(store.recordBattle(account, { ...result, id: 'c'.repeat(32), crowns: 4 }), /result/)
  assert.deepEqual(await restarted.login(account.id, account.token), training)
})

test('a reconnect snapshot suppresses duplicate pending inputs only for its recipient', async t => {
  const command = { id: 2, fields: require('./fixtures/native-battle-commands.json')[0].fields }
  const status = { tick: 160, checksum: 42, ended: false, executed: [] }
  let announced = [command]
  const process = {
    ready: Promise.resolve({ status, snapshots: [Buffer.from([1]), Buffer.from([1])], location: 15000002 }),
    call: async action => action === 'snapshot'
      ? { snapshot: Buffer.from([1]), pendingCommands: [command], status }
      : { ...status, tick: 170, commands: announced },
    close: async () => {},
  }
  const coordinator = new BattleCoordinator({ store: { recordBattle () {} }, homeProvider: async () => {}, processFactory: () => process })
  t.after(() => coordinator.stop())
  const players = [1, 2].map(low => {
    const packets = []
    return { ...player(low), packets, session: { socket: { destroyed: false }, send: (id, fields) => packets.push({ id, fields }), sendRaw () {} } }
  })
  await coordinator.start(players, { training: false, modeId: 72000006 })
  const match = [...coordinator.matches.values()][0]
  match.phase = 'running'
  await coordinator.resend(match, players[0].session, 0)
  await coordinator.advance(match)
  assert.deepEqual(players.map(p => p.packets[0].fields.commands.length), [0, 1])
  announced = [{ ...command, fields: { ...command.fields, field_0x10: 170, field_0xc: 190 } }]
  await coordinator.advance(match)
  assert.deepEqual(players.map(p => p.packets[1].fields.commands.length), [1, 1])
})

test('natural Party completion sends one native result per player and a crossing cancel keeps the found match', async t => {
  const records = []
  const coordinator = new BattleCoordinator({
    store: { recordBattle: async (account, result) => { records.push(result); return account } },
    homeProvider: async () => {},
    processFactory: options => ({ ready: Promise.resolve({ status: { tick: 0, checksum: 1 }, location: 15000002, snapshots: options.players.map(() => Buffer.from([1])) }), call: async () => ({ snapshot: Buffer.from([1, 2, 3]) }), close: async () => {} }),
  })
  t.after(() => coordinator.stop())
  const players = Array.from({ length: 4 }, (_, slot) => {
    const account = { id: [0, slot + 1], name: 'Player' }, packets = []
    const session = { account, socket: { destroyed: false }, send: (id, fields) => packets.push({ id, fields }), sendRaw () {} }
    return { ...player(slot + 1), session, identity: account, packets }
  })
  await coordinator.start(players, { training: false, party: true, modeId: 72000023 })
  const match = [...coordinator.matches.values()][0]
  await coordinator.cancel(players[0].session)
  assert.equal(match.stopped, false)
  assert.equal(match.phase, 'loading')
  assert.deepEqual(players[0].packets.map(packet => packet.id), [25382])
  const result = { tick: 3410, winner: 1, crowns: [0, 3, 0, 3] }
  await coordinator.finish(match, result)
  await coordinator.finish(match, result)
  assert.equal(records.length, 4)
  assert.ok(records.every(record => record.kind === 'friendly'))
  for (const [slot, player] of players.entries()) {
    const packets = player.packets.filter(packet => packet.id === 22871)
    assert.equal(packets.length, 1)
    assert.equal(packets[0].fields.field_0x7c, slot % 2 === 1 ? 1 : 2)
    assert.equal(packets[0].fields.field_0xa0, result.crowns[slot ^ 1])
    assert.deepEqual(decodeSectorStateEnvelope(packets[0].fields.field_0xb0).snapshot, Buffer.from([1, 2, 3]))
  }
})
