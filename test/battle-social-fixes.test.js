'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { AccountStore } = require('../server/accounts')
const { applyBattleResult } = require('../server/battle/results')
const { playerState } = require('../server/starter-state')
const { BattleCoordinator } = require('../server/battle/coordinator')
const { createAllianceHandlers } = require('../server/alliance-handlers')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')

const result = { id: 'a'.repeat(32), kind: 'ladder', slot: 0, winner: 0, crowns: 3, arena: 54000001 }
const account = () => ({ id: [0, 1], name: 'Player', starter: playerState({}) })

test('ranked results credit matched 36–42 trophies, floor losses at zero and retain crowns/profile stats exactly once', () => {
  const winner = applyBattleResult(account(), result, 0)
  const gain = winner.starter.trophies
  assert.ok(gain >= 36 && gain <= 42)
  assert.equal(winner.starter.bestTrophies, gain)
  assert.equal(winner.starter.passCrowns, 3)
  assert.equal(winner.starter.passInitialized, true)
  assert.deepEqual([winner.starter.battles, winner.starter.wins, winner.starter.losses, winner.starter.threeCrownWins], [1, 1, 0, 1])
  assert.equal(applyBattleResult(winner, result, 1), winner)
  const loser = account(); loser.starter.trophies = 100; loser.starter.bestTrophies = 100
  assert.equal(applyBattleResult(loser, { ...result, slot: 1, crowns: 1 }, 0).starter.trophies, 100 - gain)
  const empty = applyBattleResult(account(), { ...result, slot: 1, crowns: 1 }, 0)
  assert.equal(empty.starter.trophies, 0)
  assert.equal(empty.starter.passCrowns, 1)
  assert.equal(empty.starter.losses, 1)
  for (const kind of ['friendly', 'training']) {
    const state = applyBattleResult(account(), { ...result, kind }, 0).starter
    assert.deepEqual([state.trophies, state.passCrowns, state.battles], [0, 0, 0])
  }
  const party = applyBattleResult(account(), { ...result, kind: 'friendly', party: true }, 0).starter
  assert.deepEqual([party.trophies, party.passCrowns, party.battles], [0, 3, 0])
  const draw = applyBattleResult(account(), { ...result, winner: -1 }, 0).starter
  assert.deepEqual([draw.trophies, draw.battles, draw.wins, draw.losses], [0, 1, 0, 0])
})

for (const fixture of require('./fixtures/native-social-stream.json')) { test('native nonempty social wire ' + fixture.id, () => {
  const wire = Buffer.from(fixture.payloadHex, 'hex')
  assert.deepEqual(encodeMessage(fixture.id, fixture), wire)
  assert.deepEqual(encodeMessage(fixture.id, decodeMessage(fixture.id, wire)), wire)
  for (let i = 0; i < wire.length; i++) { assert.throws(() => decodeMessage(fixture.id, wire.subarray(0, i))) }
}) }

test('chat, settings and clan mail persist, fan out only to members, enforce rank/cooldown and roll back failed turns', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-social-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  let now = 1000000
  const store = new AccountStore(directory, { now: () => now })
  const leader = await store.login([0, 0], null), member = await store.login([0, 0], null), outsider = await store.login([0, 0], null)
  leader.starter.gold = 5000
  const db = await store.load(); db.accounts[0] = leader; await store.save(db)
  const created = await store.createAlliance(leader, { field_0x80: 'Clan', field_0x88: '', field_0x90: [16, 0], field_0x98: [0, 0], field_0xa0: 1, field_0xa4: 0 })
  const membership = await store.load(); membership.accounts[1].alliance = { ...created.account.alliance, role: 1 }; await store.save(membership)
  const social = createAllianceHandlers({ store })
  const sessions = []
  for (const id of [leader, member, outsider]) {
    const packets = []
    const session = { account: await store.login(id.id, id.token), socket: { destroyed: false }, send: (id, fields) => packets.push({ id, fields }) }
    sessions.push({ session, packets }); await social.login(session)
  }
  await social.get(11632)(sessions[0].session, { field_0x80: 'سلام' })
  assert.deepEqual(sessions.map(s => s.packets.filter(p => p.id === 21749).length), [1, 1, 0])
  assert.equal((await new AccountStore(directory).clanChat(leader))[0].text, 'سلام')
  const edited = { field_0x80: 'New description', field_0x88: [16, 1], field_0x90: [0, 0], field_0x98: 2, field_0x9c: 300 }
  await social.get(13882)(sessions[0].session, edited)
  assert.equal((await store.findAlliance(created.account.alliance.id)).description, edited.field_0x80)
  assert.deepEqual((await store.login(member.id, member.token)).alliance.badge, [16, 1])
  await assert.rejects(store.socialAction(member, 'settings', edited), /leader/)
  const command = { id: 715, fields: { field_0x20: 'Subject', field_0x28: 'Body' } }
  const sent = await store.applyStarterTurn(leader, [command]); sessions[0].session.account = sent
  await social.broadcastMail(sessions[0].session)
  assert.deepEqual(sessions.map(s => s.packets.filter(p => p.id === 28299).length), [1, 1, 0])
  assert.equal((await new AccountStore(directory).login(member.id, member.token)).mail[0].subject, 'Subject')
  assert.equal((await store.login(outsider.id, outsider.token)).mail, undefined)
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  await assert.rejects(store.applyStarterTurn(leader, [{ id: 869, fields: { field_0x1c: 1 } }, command]), /cooldown/)
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
  await assert.rejects(store.applyStarterTurn(member, [command]), /leader/)
  now += 43200000
  await store.applyStarterTurn(leader, [command])
  assert.equal((await store.login(member.id, member.token)).mail.length, 2)
})

test('18100 returns an ended match Home and reattaches a live online match instead of escaping to Home', async t => {
  const session = { account: account(), socket: { destroyed: false }, packets: [], sendRaw (id) { this.packets.push(id) } }
  const store = { recordBattle () {}, login: async () => session.account }
  const battles = new BattleCoordinator({ store, homeProvider: async () => ({ payload: Buffer.from([0]), version: 0 }) })
  t.after(() => battles.stop())
  const player = { id: session.account.id, identity: session.account, session }
  let closes = 0
  const match = { id: 'match', players: [player], options: { training: false }, phase: 'running', process: { call: async () => ({ pendingCommands: [], snapshot: Buffer.from([1]) }), close: async () => { closes++ } } }
  battles.matches.set(match.id, match); battles.owners.set('0:1', match)
  await battles.handlers().get(18100)(session)
  assert.deepEqual(session.packets, [28991]); assert.equal(match.phase, 'running')
  battles.disconnect(session)
  assert.equal(match.awayTimer, undefined)
  const resumed = { ...session, packets: [], socket: { destroyed: false }, state: 'hello' }
  const response = await battles.initialResponse(resumed)
  assert.equal(response.id, 28991)
  assert.deepEqual(resumed.packets, [])
  assert.equal(battles.active(resumed), match)
  match.phase = 'finished'; match.finished = Promise.resolve()
  await battles.handlers().get(18100)(resumed)
  assert.deepEqual(resumed.packets, [21217]); assert.equal(battles.owners.size, 0); assert.equal(closes, 1)
})

test('emote selection uses the native descriptor codec and persists only a known owned ID', async t => {
  const fixture = require('./fixtures/native-emote-command.json')
  const { definitions, battleEmotes } = require('../server/emotes')
  const { encodeCommand, decodeCommand } = require('../lib/protocol/commands')
  const wire = Buffer.from(fixture.payloadHex, 'hex')
  assert.deepEqual(encodeCommand(fixture), wire)
  assert.deepEqual(encodeCommand(decodeCommand(wire)), wire)
  for (let i = 0; i < wire.length; i++) assert.throws(() => decodeCommand(wire.subarray(0, i)))
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-emote-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new AccountStore(directory), identity = await store.login([0, 0], null)
  const changed = await store.applyStarterTurn(identity, [fixture])
  assert.deepEqual(changed.starter.emoteDeck[3], definitions[0].id)
  assert.deepEqual((await new AccountStore(directory).login(identity.id, identity.token)).starter.emoteDeck[3], definitions[0].id)
  const tampered = { ...fixture, fields: { ...fixture.fields, field_0x20: { ...fixture.fields.field_0x20, id: [999999, 0] } } }
  await assert.rejects(store.applyStarterTurn(identity, [tampered]), /emote selection/)
  const snapshot = battleEmotes(changed.starter.emoteDeck)
  assert.deepEqual(snapshot.de[3], { p: definitions[0].id[0], e: 0 })
  assert.equal(snapshot.abe.length, 2)
  assert.ok(snapshot.oe.every(Number.isSafeInteger))
})

test('retained legacy ladder history supplies missing profile counters without replacing saved counters', () => {
  const old = { ...account(), battleHistory: [{ ...result, outcome: 'win', gold: 6, at: new Date(0).toISOString() }] }
  for (const field of ['trophies', 'bestTrophies', 'battles', 'wins', 'losses', 'threeCrownWins']) delete old.starter[field]
  const state = playerState(old)
  assert.ok(state.trophies >= 36 && state.trophies <= 42)
  assert.deepEqual([state.battles, state.wins, state.losses, state.threeCrownWins], [1, 1, 0, 1])
  old.starter.trophies = 100
  assert.equal(playerState(old).trophies, 100)
  assert.equal(playerState(old).bestTrophies, 100)
})

test('settlement validates both identities before saving either account and persists exactly once', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-result-atomic-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new AccountStore(directory)
  const identities = [await store.login([0, 0], null), await store.login([0, 0], null)]
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  const entries = identities.map((identity, slot) => ({ identity, result: { ...result, slot } }))
  await assert.rejects(store.recordBattles([entries[0], { ...entries[1], identity: { ...identities[1], token: 'invalid' } }]), /credentials/)
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
  const settled = await store.recordBattles(entries)
  assert.deepEqual(settled.map(row => row.battleHistory.length), [1, 1])
  assert.deepEqual(settled.map(row => row.starter.battles), [1, 1])
  assert.deepEqual(await store.recordBattles(entries), settled)
})

test('disconnecting before snapshot acknowledgement cannot cancel ownership at the loading deadline', async t => {
  let deadline
  t.mock.method(global, 'setTimeout', (callback, ms) => { if (ms === 30000) deadline = callback; return { unref () {} } })
  const session = { account: account(), socket: { destroyed: false }, packets: [], sendRaw (id) { this.packets.push(id) } }
  const battles = new BattleCoordinator({ store: { recordBattle () {} }, homeProvider: async () => ({ payload: Buffer.from([0]) }), processFactory: () => ({ ready: Promise.resolve({ status: { tick: 0, checksum: 1 }, snapshots: [Buffer.from([1])], location: 15000001 }), call: async () => ({ snapshot: Buffer.from([1]), pendingCommands: [] }), close: async () => {} }) })
  t.after(() => battles.stop())
  t.mock.method(battles, 'schedule', () => {})
  await battles.start([battles.player(session)], { training: true, npcId: 18000007, modeId: 72000008 })
  const match = [...battles.matches.values()][0]
  battles.disconnect(session)
  deadline()
  assert.equal(match.phase, 'running')
  assert.equal(battles.owners.get('0:1'), match)
  const resumed = { ...session, socket: { destroyed: false }, state: 'hello' }
  assert.equal((await battles.initialResponse(resumed)).id, 28991)
  assert.equal(match.players[0].needsSnapshotOnAck, false)
  const before = resumed.packets.length
  await battles.acknowledge(resumed)
  assert.equal(resumed.packets.length, before)
  assert.equal(match.players[0].acknowledged, true)
})
