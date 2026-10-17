'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { partyCatalogue, partyMode } = require('../server/party')
const { BattleCoordinator } = require('../server/battle/coordinator')
const { BattleEngine } = require('../server/battle/engine')
const { NativeBattleClient } = require('../tools/verify-battle')
const deck = require('../server/data/starter-home.json').starter.deckIds

test('Party maps explicit source events to eligible 2v2 and Double Elixir modes', () => {
  const events = partyCatalogue().events
  assert.deepEqual(events.map(event => JSON.parse(event.json).GameMode), ['TeamVsTeamLadder', 'DoubleElixir'])
  for (const event of events) {
    assert.equal(event.category, 20)
    assert.equal(event.personallyTargeted, false)
    assert.ok(event.startTime < Date.now() / 1000 && event.endTime > Date.now() / 1000)
  }
  assert.equal(partyMode({ field_0x20: 2, field_0x24: 1002 }).id, 72000023)
  assert.equal(partyMode({ field_0x20: 0, field_0x24: 1001 }).id, 72000001)
  assert.equal(partyMode({ field_0x20: 1, field_0x24: 1002 }), null)
  assert.equal(partyMode({ field_0x20: 2, field_0x24: 999 }), null)
  assert.deepEqual(partyCatalogue(false), { revision: -1, events: [] })
})

test('matchmaking isolates Party modes from ladder and only starts complete rosters', async t => {
  const created = [], packets = []
  const coordinator = new BattleCoordinator({
    store: { recordBattle () {} },
    homeProvider: async () => {},
    fallbackMs: 0,
    processFactory: options => {
      created.push(options)
      return { ready: Promise.resolve({ status: { tick: 0, checksum: 1 }, location: 15000002, snapshots: options.players.map(() => Buffer.from([1])) }), close: async () => {} }
    },
  })
  t.after(() => coordinator.stop())
  const session = low => ({ account: { id: [0, low], name: 'Player' }, socket: { destroyed: false }, sendRaw () {}, send: id => packets.push(id) })
  const normal = session(1), duo = session(2)
  await coordinator.request(normal, { field_0x20: 0, field_0x24: -1 })
  await coordinator.request(duo, { field_0x20: 2, field_0x24: 1002 })
  await coordinator.request(session(3), { field_0x20: 0, field_0x24: 1001 })
  assert.equal(created.length, 0)
  for (const low of [4, 5, 6]) await coordinator.request(session(low), { field_0x20: 2, field_0x24: 1002 })
  assert.equal(created.length, 1)
  assert.equal(created[0].modeId, 72000023)
  assert.equal(created[0].players.length, 4)
  assert.equal(created[0].party, true)
  assert.equal(coordinator.queue.size, 2)
  await coordinator.cancel(normal)
  assert.deepEqual(packets, [25382])
  assert.equal(coordinator.queue.size, 1)
  await coordinator.request(session(7), { field_0x20: 2, field_0x24: 1001 })
  assert.equal(created.length, 2)
  assert.equal(created[1].modeId, 72000001)
  assert.equal(created[1].players.length, 2)
})

test('Party bot fallback fills a source 2v2 roster after waiting', async t => {
  let options
  const coordinator = new BattleCoordinator({
    store: { recordBattle () {} },
    homeProvider: async () => {},
    fallbackMs: 300000,
    processFactory: request => {
      options = request
      return { ready: Promise.resolve({ status: { tick: 0, checksum: 1 }, location: 15000002, snapshots: request.players.map(() => Buffer.from([1])) }), close: async () => {} }
    },
  })
  t.after(() => coordinator.stop())
  const session = { account: { id: [0, 1], name: 'Player' }, socket: { destroyed: false }, sendRaw () {} }
  await coordinator.request(session, { field_0x20: 2, field_0x24: 1002 })
  coordinator.queue.get('0:1').enqueued -= 300001
  await coordinator.pair()
  assert.equal(options.modeId, 72000023)
  assert.equal(options.players.filter(player => player.bot).length, 3)
  assert.equal(new Set(options.players.map(player => player.id.join(':'))).size, 4)
})

test('advertised native Party modes initialize and synchronize their real sector simulation', { timeout: 60000 }, async () => {
  for (const modeId of [72000001, 72000023]) {
    const count = modeId === 72000023 ? 4 : 2
    const engine = await BattleEngine.create({ modeId, players: Array.from({ length: count }, (_, index) => ({ id: [0, index + 1], name: 'Player', deck })), seed: 42, time: 1600000000 })
    try {
      const client = new NativeBattleClient(engine, count - 1)
      for (let n = 0; n < 4; n++) client.receive(engine.step(10), engine.drainCommands())
      assert.equal(engine.status().crowns.length, count)
      assert.equal(client.tick, 40)
    } finally { engine.close() }
  }
})
