'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { AccountStore } = require('../server/accounts')
const { createGameServer } = require('../server/core')
const { loadHomeTemplate, createStarterHomeProvider } = require('../server/home')
const { createHash } = require('node:crypto')
const { createStarterHandlers } = require('../server/starter-handlers')
const { createStartupHandlers } = require('../server/startup-handlers')
const { createAllianceHandlers } = require('../server/alliance-handlers')
const { createNameHandlers } = require('../server/name-handlers')
const { Writer } = require('../lib/protocol/stream')
const { encodeFrame, FrameDecoder } = require('../lib/protocol/frame')
const { encodeMessage, decodeMessage, profile } = require('../lib/protocol/messages')

async function client (port) {
  const socket = net.connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const decoder = new FrameDecoder()
  const frames = []
  const waiters = []
  socket.on('data', chunk => {
    for (const frame of decoder.push(chunk)) { if (waiters.length) waiters.shift()(frame); else frames.push(frame) }
  })
  return { socket, receive: () => frames.length ? Promise.resolve(frames.shift()) : new Promise(resolve => waiters.push(resolve)), send: (id, fields = {}, version = 0) => socket.write(encodeFrame(id, version, encodeMessage(id, fields))) }
}

async function setup (t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-server-'))
  const game = createGameServer({ store: new AccountStore(directory), ...options })
  game.server.listen(0, '127.0.0.1')
  await once(game.server, 'listening')
  t.after(async () => { if (game.server.listening) await game.stop(); await fs.rm(directory, { recursive: true, force: true }) })
  return { game, directory, port: game.server.address().port }
}

test('real TCP ClientHello and explicit missing-Home LoginFailed', { timeout: 5000 }, async t => {
  const { game, port } = await setup(t)
  const c = await client(port)
  const hello = encodeFrame(10100, 0, encodeMessage(10100, { field_0x7c: 1, field_0x84: 3, field_0x88: 1 }))
  c.socket.write(hello.subarray(0, 3)); c.socket.write(hello.subarray(3))
  const response = await c.receive()
  assert.equal(response.id, 20100); assert.equal(decodeMessage(20100, response.payload).nonce.length, 24)
  c.send(10101, { field_0x80: [0, 0], field_0x90: 3, field_0x94: 1 }, 4)
  const failed = await c.receive()
  assert.equal(failed.id, 20103); assert.equal(failed.version, 4)
  assert.match(decodeMessage(20103, failed.payload).field_0x98, /compatible player-state Home provider/)
  assert.equal(game.statistics.logins, 0)
})

test('login persistence, frame ordering and heartbeat with a synthetic Home provider', { timeout: 5000 }, async t => {
  const syntheticPayload = Buffer.from('TEST HOME TRANSPORT ONLY')
  const { game, port, directory } = await setup(t, { homeProvider: async () => ({ payload: syntheticPayload, version: 0 }) })
  const c = await client(port)
  c.send(10101, { field_0x80: [0, 0], field_0x90: 3, field_0x94: 1, field_0x98: 162 }, 4)
  const ok = await c.receive(); const home = await c.receive()
  const account = decodeMessage(20758, ok.payload)
  assert.equal(ok.id, 20758); assert.equal(home.id, 21217); assert.deepEqual(home.payload, syntheticPayload)
  assert.equal(account.field_0xb0, 3); assert.equal(account.field_0xb4, 162); assert.equal(account.field_0xbc, 1)
  c.socket.write(Buffer.concat([encodeFrame(10108, 0, Buffer.alloc(0)), encodeFrame(10108, 0, Buffer.alloc(0))]))
  assert.equal((await c.receive()).id, 20108); assert.equal((await c.receive()).id, 20108)
  c.socket.destroy()
  const loaded = await new AccountStore(directory).login(account.field_0x80, account.field_0x90)
  assert.deepEqual(loaded.id, account.field_0x80)
  await assert.rejects(new AccountStore(directory).login(account.field_0x80, 'incorrect'), /Invalid account/)
  assert.equal(game.statistics.logins, 1)
})

test('malformed and oversized frames close or fail only their own connection', { timeout: 5000 }, async t => {
  const { game, port } = await setup(t)
  const c = await client(port)
  c.socket.write(encodeFrame(10100, 0, Buffer.alloc(0)))
  assert.equal((await c.receive()).id, 20103)
  const next = await client(port)
  const header = Buffer.alloc(7); header.writeUIntBE(1048577, 2, 3)
  next.socket.write(header)
  await once(next.socket, 'close')
  const healthy = await client(port); healthy.send(10100)
  assert.equal((await healthy.receive()).id, 20100)
  assert.equal(game.statistics.malformed, 2)
})

test('concurrent new account creation is serialized and persists unique IDs', async t => {
  const { game, directory } = await setup(t)
  const store = new AccountStore(directory)
  const accounts = await Promise.all(Array.from({ length: 10 }, () => store.login([0, 0], null)))
  assert.equal(new Set(accounts.map(a => a.id[1])).size, 10)
  for (const account of accounts) assert.equal((await store.login(account.id, account.token)).token, account.token)
  assert.equal(game.statistics.logins, 0)
})

test('Home templates are checksum-bound, library-bound and explicitly bind account IDs', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-template-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const payload = Buffer.alloc(16)
  const template = { librarySha256: profile.library_sha256, messageId: 21217, version: 0, payloadHex: payload.toString('hex'), payloadSha256: createHash('sha256').update(payload).digest('hex'), accountIdOffsets: [0, 8] }
  const filename = path.join(directory, 'template.json')
  await fs.writeFile(filename, JSON.stringify(template))
  const provider = await loadHomeTemplate(filename)
  const home = await provider({ id: [0, 123] })
  assert.equal(home.payload.readInt32BE(4), 123); assert.equal(home.payload.readInt32BE(12), 123)
  template.librarySha256 = 'wrong'; await fs.writeFile(filename, JSON.stringify(template))
  await assert.rejects(loadHomeTemplate(filename), /does not match/)
})

test('separate stores sharing a directory serialize account IDs without losing accounts', async t => {
  const { directory } = await setup(t)
  const stores = [new AccountStore(directory), new AccountStore(path.join(directory, '.'))]
  const accounts = await Promise.all(Array.from({ length: 20 }, (_, n) => stores[n % 2].login([0, 0], null)))
  assert.equal(new Set(accounts.map(a => a.id[1])).size, 20)
  for (const account of accounts) assert.deepEqual((await stores[0].login(account.id, account.token)).id, account.id)
})

test('deck selection persists without changing credentials or another account', async t => {
  const { directory } = await setup(t)
  const first = new AccountStore(directory)
  const second = new AccountStore(directory)
  const account = await first.login([0, 0], null)
  const other = await second.login([0, 0], null)
  const [one, two] = await Promise.all([first.selectDeck(account, 1), second.selectDeck(account, 4)])
  assert.equal(one.starter.selectedDeck, 1)
  assert.equal(two.starter.selectedDeck, 4)
  assert.deepEqual(await new AccountStore(directory).login(account.id, account.token), { ...account, starter: { ...account.starter, selectedDeck: 4 } })
  assert.deepEqual(await first.login(other.id, other.token), other)
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  for (const deck of [-1, 5, NaN, 1.5]) await assert.rejects(first.selectDeck(account, deck), /deck selection/)
  await assert.rejects(first.selectDeck({ ...account, token: 'incorrect' }, 2), /credentials/)
  await assert.rejects(first.selectDeck(null, 2), /credentials/)
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
})

test('TCP starter turns preserve deck selection across login and reject unsupported batches atomically', { timeout: 5000 }, async t => {
  const { game, port, directory } = await setup(t, { homeProvider: createStarterHomeProvider({ emotes: false }) })
  const entries = []
  const handlers = createStarterHandlers({ store: new AccountStore(directory), logger: entry => entries.push(entry), traceNetwork: true })
  // Both servers use the same account directory; reconnect through the other
  // instance to prove it reloads persistent state rather than a session cache.
  const active = createGameServer({ store: new AccountStore(directory), homeProvider: createStarterHomeProvider({ emotes: false }), handlers })
  active.server.listen(0, '127.0.0.1')
  await once(active.server, 'listening')
  t.after(() => active.stop())
  const c = await client(active.server.address().port)
  c.send(10101, { field_0x80: [0, 0] }, 4)
  const ok = decodeMessage(20758, (await c.receive()).payload)
  await c.receive()
  const selection = deck => ({ id: 703, fields: { field_0x1c: deck } })
  c.send(13597)
  c.send(13597, { commands: [{ id: 805 }] })
  c.send(13597, { commands: [selection(1), { id: 805 }, selection(4), { id: 805 }] })
  c.send(10108)
  assert.equal((await c.receive()).id, 20108)
  assert.equal((await new AccountStore(directory).login(ok.field_0x80, ok.field_0x90)).starter.selectedDeck, 4)
  c.send(13597, { commands: [selection(2), { id: 805 }, { id: 948, fields: { field_0x20: 'must not persist' } }, { id: 595 }] })
  const unknown = new Writer().vint(0).vint(0).vint(2).raw(require('../lib/protocol/commands').encodeCommand(selection(3))).vint(1001).toBuffer()
  c.socket.write(encodeFrame(13597, 0, unknown))
  c.send(10108)
  assert.equal((await c.receive()).id, 20108)
  c.socket.destroy()
  assert.ok(entries.some(entry => entry.event === 'unsupported-turn' && entry.applied === false))
  assert.ok(entries.some(entry => entry.event === 'unsupported-turn' && entry.turnCommandIds.join(',') === '703,805,948,595' && entry.commandIds.join(',') === '595'))
  assert.ok(entries.some(entry => entry.event === 'unresolved-command-data' && entry.id === 595 && entry.gameDataReferences[0][0] === 0 && entry.applied === false))
  assert.ok(entries.some(entry => entry.event === 'client-turn' && entry.commands === 1))
  assert.ok(entries.some(entry => entry.event === 'starter-deck-selected' && entry.selectedDeck === 4 && entry.commands === 4))
  assert.ok(!entries.some(entry => entry.commandIds?.includes(805)))
  assert.ok(entries.some(entry => entry.event === 'unsupported-turn-command' && entry.id === 1001 && entry.applied === false))
  assert.ok(!JSON.stringify(entries).includes('must not persist'))
  // A fresh server instance must emit the independently native-encoded Home.
  const next = await client(port)
  next.send(10101, { field_0x80: ok.field_0x80, field_0x88: ok.field_0x90 }, 4)
  assert.equal((await next.receive()).id, 20758)
  const home = await next.receive()
  const expected = await createStarterHomeProvider({ emotes: false })(await new AccountStore(directory).login(ok.field_0x80, ok.field_0x90))
  assert.deepEqual(home.payload, expected.payload)
  assert.equal(game.statistics.logins, 1)
  next.socket.destroy()
})

test('595 diagnostics identify a rejected naming batch without network tracing or retaining its name', async () => {
  const entries = []
  const handlers = createStarterHandlers({ store: { applyStarterTurn: () => assert.fail('Rejected batch must not mutate state') }, logger: entry => entries.push(entry) })
  const commands = [{ id: 948, fields: { field_0x20: 'private-name' } }, { id: 595, fields: { field_0x1c: 3, field_0x20: 1, field_0x28: [54, 1], field_0x30: true } }]
  await handlers.get(13597)({}, null, { payload: encodeMessage(13597, { commands }) })
  assert.deepEqual(entries[0], { event: 'unsupported-turn', commandIds: [595], turnCommandIds: [948, 595], extraData: false, applied: false })
  assert.deepEqual(entries[1].selectors, [commands[1].fields])
  assert.equal(JSON.stringify(entries).includes('private-name'), false)
})

test('observed Arena1 boost persists once over TCP and sends the native remaining time and consumed marker after reconnect', { timeout: 5000 }, async t => {
  const { directory } = await setup(t)
  const fixtures = require('./fixtures/native-arena-boost-home.json').filter(row => row.accountId[1] === 1)
  let now = fixtures[0].nowMs
  const store = new AccountStore(directory, { now: () => now })
  const entries = []
  const game = createGameServer({ store, homeProvider: createStarterHomeProvider({ emotes: false, now: () => now }), handlers: createStarterHandlers({ store, logger: entry => entries.push(entry) }) })
  game.server.listen(0, '127.0.0.1')
  await once(game.server, 'listening')
  t.after(() => game.stop())
  const c = await client(game.server.address().port)
  c.send(10101, {}, 4)
  const login = decodeMessage(20758, (await c.receive()).payload)
  await c.receive()
  c.send(13597, { commands: [require('./fixtures/native-arena-boost-command.json')] })
  c.send(10108)
  assert.equal((await c.receive()).id, 20108)
  const saved = await store.login(login.field_0x80, login.field_0x90)
  assert.deepEqual(saved.starter.arena1Boost, fixtures[0].starter.arena1Boost)
  assert.deepEqual([saved.name, saved.starter.nameSet, saved.starter.gold, saved.starter.gems], ['Player', false, 100, 100])
  assert.ok(entries.some(entry => entry.event === 'arena-boost-claimed'))
  assert.ok(!entries.some(entry => entry.event === 'unsupported-turn' || entry.event === 'starter-name-set'))
  c.socket.destroy()
  for (const fixture of fixtures) {
    now = fixture.nowMs
    const nextStore = new AccountStore(directory, { now: () => now })
    const nextGame = createGameServer({ store: nextStore, homeProvider: createStarterHomeProvider({ emotes: false, now: () => now }), handlers: createStarterHandlers({ store: nextStore, logger: entry => entries.push(entry) }) })
    nextGame.server.listen(0, '127.0.0.1')
    await once(nextGame.server, 'listening')
    const connection = await client(nextGame.server.address().port)
    connection.send(10101, { field_0x80: saved.id, field_0x88: saved.token }, 4)
    assert.equal((await connection.receive()).id, 20758)
    assert.equal((await connection.receive()).payload.toString('hex'), fixture.payloadHex)
    const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
    connection.send(13597, { commands: [require('./fixtures/native-arena-boost-command.json')] })
    connection.send(10108)
    assert.equal((await connection.receive()).id, 20108)
    assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
    connection.socket.destroy()
    await nextGame.stop()
  }
  assert.equal(entries.filter(entry => entry.event === 'starter-turn-rejected' && entry.reason === 'Arena1 boost already claimed').length, fixtures.length)
})

test('Arena1 boost is atomic with naming/purchases and cannot be extended by concurrent or expired repeat claims', async t => {
  const { directory } = await setup(t)
  let now = 1700000000123
  const store = new AccountStore(directory, { now: () => now })
  const second = new AccountStore(directory, { now: () => now })
  const account = await store.login([0, 0], null)
  const other = await store.login([0, 0], null)
  const boost = require('./fixtures/native-arena-boost-command.json')
  const buy = { id: 687, fields: { field_0x20: [55, 0] } }
  const name = { id: 948, fields: { field_0x20: 'بازیکن' } }
  const target = path.join(directory, 'accounts.json')
  const before = await fs.readFile(target, 'utf8')
  await assert.rejects(store.applyStarterTurn(account, [name, buy, boost, boost]), /already claimed/)
  assert.equal(await fs.readFile(target, 'utf8'), before)
  for (const fields of [undefined, { ...boost.fields, field_0x30: true }, { ...boost.fields, field_0x28: [54, 2] }, { ...boost.fields, field_0x28: [0, 0] }]) {
    await assert.rejects(store.applyStarterTurn(account, [name, { id: 595, fields }]), /Unsupported starter/)
    assert.equal(await fs.readFile(target, 'utf8'), before)
  }
  const results = await Promise.allSettled([store.applyStarterTurn(account, [name, buy, boost]), second.applyStarterTurn(account, [name, buy, boost])])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const saved = await new AccountStore(directory).login(account.id, account.token)
  assert.deepEqual([saved.name, saved.starter.gold, saved.starter.gems], ['بازیکن', 1100, 40])
  assert.deepEqual(saved.starter.arena1Boost, { claimedAtMs: now, expiresAtMs: now + 86400000 })
  assert.deepEqual(await store.login(other.id, other.token), other)
  const after = await fs.readFile(target, 'utf8')
  now += 90000000
  await assert.rejects(second.applyStarterTurn(account, [boost]), /already claimed/)
  assert.equal(await fs.readFile(target, 'utf8'), after)
  const database = JSON.parse(after)
  for (const invalid of [{}, [], { claimedAtMs: -1, expiresAtMs: 86399999 }, { claimedAtMs: 1700000000123, expiresAtMs: 1700086400124 }, { claimedAtMs: NaN, expiresAtMs: null }]) {
    database.accounts[0].starter.arena1Boost = invalid
    await fs.writeFile(target, JSON.stringify(database))
    await assert.rejects(store.login(account.id, account.token), /Invalid Arena1 boost state/)
  }
})

test('self AvatarStream roundtrips the native empty response repeatedly without resetting state or exposing another account', { timeout: 5000 }, async t => {
  const { directory } = await setup(t)
  const store = new AccountStore(directory)
  const account = await store.login([0, 0], null)
  const other = await store.login([0, 0], null)
  const entries = []
  const game = createGameServer({ store, homeProvider: createStarterHomeProvider({ emotes: false }), handlers: createStarterHandlers({ store, traceNetwork: true, logger: entry => entries.push(entry) }) })
  game.server.listen(0, '127.0.0.1')
  await once(game.server, 'listening')
  t.after(() => game.stop())
  const c = await client(game.server.address().port)
  c.send(10101, { field_0x80: account.id, field_0x88: account.token }, 4)
  await c.receive(); await c.receive()
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  for (let n = 0; n < 2; n++) {
    c.send(11712, { field_0x80: account.id })
    const response = await c.receive()
    assert.equal(response.id, 28299)
    assert.equal(response.version, 0)
    assert.deepEqual(response.payload, Buffer.from(require('./fixtures/native-avatar-stream.json').emptyReply.payload, 'hex'))
  }
  c.send(10108)
  assert.equal((await c.receive()).id, 20108)
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
  assert.equal(entries.filter(entry => entry.event === 'avatar-stream-sent').length, 2)
  assert.equal(game.statistics.unsupported, 0)
  const closed = once(c.socket, 'close')
  c.send(11712, { field_0x80: other.id })
  await closed
  assert.equal(entries.filter(entry => entry.event === 'avatar-stream-sent').length, 2)
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
})

test('new-player naming and deck contents persist through a new server and store without resetting resources', { timeout: 5000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-player-state-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new AccountStore(directory)
  const account = await store.login([0, 0], null)
  assert.equal(account.starter.nameSet, false)
  assert.equal(account.starter.nameChangeCount, -1)
  const database = JSON.parse(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'))
  Object.assign(database.accounts[0].starter, { gold: 8192, gems: 37, freeGems: 21 })
  await fs.writeFile(path.join(directory, 'accounts.json'), JSON.stringify(database))
  const entries = []
  async function start () {
    const store = new AccountStore(directory)
    const handlers = createStarterHandlers({ store, logger: entry => entries.push(entry) })
    for (const [id, handler] of createNameHandlers({ logger: entry => entries.push(entry) })) handlers.set(id, handler)
    const game = createGameServer({ store, homeProvider: createStarterHomeProvider({ emotes: false }), handlers })
    game.server.listen(0, '127.0.0.1')
    await once(game.server, 'listening')
    t.after(() => game.server.listening ? game.stop() : undefined)
    return game
  }
  const first = await start()
  const c = await client(first.server.address().port)
  c.send(10101, { field_0x80: account.id, field_0x88: account.token }, 4)
  await c.receive(); await c.receive()
  const beforeCheck = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  c.send(16592, { field_0x80: 'بازیکن' })
  const check = await c.receive()
  assert.equal(check.id, 20821)
  assert.deepEqual(decodeMessage(20821, check.payload), { field_0x7c: false, field_0x80: 0, field_0x88: null })
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), beforeCheck)
  const cards = [...account.starter.decks[0]].reverse()
  c.send(13597, { commands: [{ id: 948, fields: { field_0x20: 'بازیکن' } }, { id: 563, fields: { field_0x1c: 3, field_0x20: cards } }] })
  c.send(10108)
  assert.equal((await c.receive()).id, 20108)
  const saved = await store.login(account.id, account.token)
  assert.equal(saved.name, 'بازیکن')
  assert.equal(saved.starter.nameSet, true)
  assert.equal(saved.starter.nameChangeCount, 0)
  assert.equal(saved.starter.selectedDeck, 3)
  assert.deepEqual(saved.starter.decks[3], cards)
  assert.deepEqual([saved.starter.gold, saved.starter.gems, saved.starter.freeGems], [8192, 37, 21])
  const { createStarterProfileProvider } = require('../server/home')
  c.send(12373, { field_0x80: account.id })
  const profile = await c.receive()
  assert.equal(profile.id, 22757)
  const publicPlayer = await store.findPlayer(account.id)
  assert.equal(Object.hasOwn(publicPlayer, 'token'), false)
  assert.equal(Object.hasOwn(publicPlayer, 'createdAt'), false)
  assert.deepEqual([publicPlayer.starter.gold, publicPlayer.starter.gems, publicPlayer.starter.freeGems], [0, 0, 0])
  assert.deepEqual(profile.payload, (await createStarterProfileProvider()(publicPlayer)).payload)
  c.send(12373, { field_0x80: [0, 999] })
  const missing = await c.receive()
  assert.equal(missing.id, 26360)
  assert.equal(decodeMessage(26360, missing.payload).field_0x7c, 2)
  assert.deepEqual(decodeMessage(26360, missing.payload).field_0x80, [0, 999])
  c.socket.destroy()
  await first.stop()
  const second = await start()
  const next = await client(second.server.address().port)
  next.send(10101, { field_0x80: account.id, field_0x88: account.token }, 4)
  const ok = decodeMessage(20758, (await next.receive()).payload)
  assert.deepEqual(ok.field_0x80, account.id)
  assert.deepEqual((await next.receive()).payload, (await createStarterHomeProvider({ emotes: false })(saved)).payload)
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  const badDeck = [...cards]; badDeck[1] = badDeck[0]
  next.send(13597, { commands: [{ id: 703, fields: { field_0x1c: 1 } }, { id: 563, fields: { field_0x1c: 2, field_0x20: badDeck } }] })
  next.send(13597, { commands: [{ id: 948, fields: { field_0x20: 'secret name must not be logged' } }] })
  next.send(10108)
  assert.equal((await next.receive()).id, 20108)
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
  assert.equal(entries.filter(entry => entry.event === 'starter-turn-rejected').length, 2)
  assert.ok(!JSON.stringify(entries).includes('secret name'))
  next.socket.destroy()
})

test('gold pack and newly unlocked deck cards survive a TCP reconnect and store restart', async t => {
  const handlers = new Map()
  const entries = []
  const { game, port, directory } = await setup(t, { handlers, homeProvider: createStarterHomeProvider({ emotes: false }), traceNetwork: true, logger: entry => entries.push(entry) })
  const store = new AccountStore(directory)
  for (const [id, handler] of createStarterHandlers({ store })) handlers.set(id, handler)
  const c = await client(port)
  c.send(10101, { field_0x80: [0, 0] }, 4)
  const ok = decodeMessage(20758, (await c.receive()).payload)
  await c.receive()
  const cards = [26000004, 26000015, 26000023, 26000026, 27000000, 27000012, 28000010, 28000011]
  c.send(13597, {
    commands: [
      { id: 687, fields: { field_0x20: [55, 0] } },
      { id: 563, fields: { field_0x1c: 2, field_0x20: cards } },
    ],
  })
  c.send(10108)
  assert.equal((await c.receive()).id, 20108)
  c.socket.destroy()
  const saved = await new AccountStore(directory).login(ok.field_0x80, ok.field_0x90)
  assert.deepEqual([saved.starter.gold, saved.starter.gems, saved.starter.freeGems], [1100, 40, 40])
  assert.deepEqual(saved.starter.decks[2], cards)
  const next = await client(port)
  next.send(10101, { field_0x80: ok.field_0x80, field_0x88: ok.field_0x90 }, 4)
  assert.deepEqual(decodeMessage(20758, (await next.receive()).payload).field_0x80, saved.id)
  assert.deepEqual((await next.receive()).payload, (await createStarterHomeProvider({ emotes: false })(saved)).payload)
  assert.deepEqual(entries.filter(entry => entry.event === 'account-login').map(entry => entry.kind), ['created', 'resumed'])
  assert.ok(!JSON.stringify(entries).includes(saved.token))
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  for (const reference of [[55, 0], [55, 3], [26, 0], [0, 0]]) {
    await assert.rejects(store.applyStarterTurn(saved, [{ id: 703, fields: { field_0x1c: 4 } }, { id: 687, fields: { field_0x20: reference } }]), /gems|pack/)
  }
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
  next.socket.destroy()
  assert.equal(game.statistics.logins, 2)
})

test('manual card swaps and free pass gold survive reconnect and store restart without repeat rewards', { timeout: 5000 }, async t => {
  const handlers = new Map()
  const entries = []
  const { game, port, directory } = await setup(t, { handlers, homeProvider: createStarterHomeProvider({ emotes: false }) })
  const store = new AccountStore(directory)
  for (const [id, handler] of createStarterHandlers({ store, logger: entry => entries.push(entry) })) handlers.set(id, handler)
  const c = await client(port)
  c.send(10101, {}, 4)
  const login = decodeMessage(20758, (await c.receive()).payload)
  await c.receive()
  const account = await store.login(login.field_0x80, login.field_0x90)
  const replaced = account.starter.inventory[0]
  c.send(13597, { commands: [{ id: 693, fields: { field_0x1c: 0, field_0x20: 2, field_0x24: -1 } }, { id: 693, fields: { field_0x1c: -1, field_0x20: 0, field_0x24: 7 } }, { id: 869, fields: { field_0x1c: 3 } }, { id: 762, fields: { field_0x1c: 0 } }, require('../docs/native-lobby-actions.json').reward] })
  c.send(10108)
  assert.equal((await c.receive()).id, 20108)
  const saved = await store.login(login.field_0x80, login.field_0x90)
  assert.equal(saved.starter.decks[0][2], replaced)
  assert.equal(saved.starter.decks[0][0], account.starter.decks[0][7])
  assert.equal(saved.starter.inventory[0], account.starter.decks[0][2])
  assert.deepEqual([saved.starter.gold, saved.starter.freeGold, saved.starter.gems], [600, 500, 100])
  assert.equal(saved.starter.homeFlags, 8)
  assert.equal(saved.starter.passSeenCrowns, 0)
  assert.equal(saved.starter.passCrowns, 0)
  c.socket.destroy()
  await game.stop()
  const restartedStore = new AccountStore(directory)
  const restarted = createGameServer({ store: restartedStore, homeProvider: createStarterHomeProvider({ emotes: false }), handlers: createStarterHandlers({ store: restartedStore, logger: entry => entries.push(entry) }) })
  restarted.server.listen(0, '127.0.0.1')
  await once(restarted.server, 'listening')
  t.after(() => restarted.stop())
  const next = await client(restarted.server.address().port)
  next.send(10101, { field_0x80: saved.id, field_0x88: saved.token }, 4)
  await next.receive()
  assert.deepEqual((await next.receive()).payload, (await createStarterHomeProvider({ emotes: false })(saved)).payload)
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  next.send(13597, { commands: [require('../docs/native-lobby-actions.json').reward] })
  next.send(10108)
  assert.equal((await next.receive()).id, 20108)
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
  assert.equal(entries.filter(entry => entry.event === 'free-pass-reward-claimed').length, 1)
  assert.ok(entries.some(entry => entry.event === 'starter-turn-rejected' && /already claimed/.test(entry.reason)))
  next.socket.destroy()
})

test('gold pack cap and concurrent spending reject a whole batch without losing resources', async t => {
  const { directory } = await setup(t)
  const store = new AccountStore(directory)
  const account = await store.login([0, 0], null)
  const buy = [{ id: 687, fields: { field_0x20: [55, 0] } }]
  const purchases = await Promise.allSettled([store.applyStarterTurn(account, buy), new AccountStore(directory).applyStarterTurn(account, buy)])
  assert.equal(purchases.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(purchases.filter(result => result.status === 'rejected').length, 1)
  const database = await store.load()
  Object.assign(database.accounts[0].starter, { gold: 4999001, gems: 100, freeGems: 21 })
  await store.save(database)
  await assert.rejects(store.applyStarterTurn(account, buy), /Gold limit/)
  const saved = await store.login(account.id, account.token)
  assert.deepEqual([saved.starter.gold, saved.starter.gems, saved.starter.freeGems], [4999001, 100, 21])
  database.accounts[0].starter.gold = 4999000
  await store.save(database)
  const atLimit = await store.applyStarterTurn(account, buy)
  assert.deepEqual([atLimit.starter.gold, atLimit.starter.gems, atLimit.starter.freeGems], [5000000, 40, 21])
})

test('legacy accounts retain identity and name status while invalid stored player state is rejected', async t => {
  const { directory } = await setup(t)
  const store = new AccountStore(directory)
  const fresh = await store.login([0, 0], null)
  const { starter, ...legacy } = fresh
  const target = path.join(directory, 'accounts.json')
  const database = { schema: 1, nextId: 2, accounts: [legacy] }
  await fs.writeFile(target, JSON.stringify(database))
  const migrated = await store.selectDeck(legacy, 2)
  assert.deepEqual(migrated.id, legacy.id)
  assert.equal(migrated.token, legacy.token)
  assert.equal(migrated.starter.nameSet, true)
  assert.equal(migrated.starter.nameChangeCount, 0)
  for (const patch of [{ gold: -1 }, { gold: null }, { gems: 1.5 }, { freeGems: 101 }, { decks: null }, { decks: [[26000000]] }, { nameSet: null }, { nameSet: false, nameChangeCount: 0 }]) {
    database.accounts = [{ ...migrated, starter: { ...migrated.starter, ...patch } }]
    await fs.writeFile(target, JSON.stringify(database))
    await assert.rejects(store.login(legacy.id, legacy.token), /Invalid starter/)
  }
})

test('malformed account databases and IDs cannot allocate duplicate or invalid identities', async t => {
  const { directory } = await setup(t)
  const store = new AccountStore(directory)
  for (const nextId of [-1, 0, 1.5, 2147483649]) {
    const source = JSON.stringify({ schema: 1, nextId, accounts: [] })
    await fs.writeFile(path.join(directory, 'accounts.json'), source)
    await assert.rejects(store.login([0, 0], null), /Invalid account database/)
    assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), source)
  }
  await assert.rejects(store.login([0], null), /Invalid account credentials/)
  await assert.rejects(store.login([0, NaN], null), /Invalid account credentials/)
})

test('a rejected Home batch never sends LoginOk before LoginFailed', { timeout: 5000 }, async t => {
  const { game, port } = await setup(t, { homeProvider: async () => ({ payload: Buffer.alloc(1048577) }) })
  const c = await client(port)
  c.send(10101, {}, 4)
  const failed = await c.receive()
  assert.equal(failed.id, 20103)
  assert.equal(game.statistics.logins, 0)
})

test('disconnecting while the Home provider runs does not authenticate or increment logins', { timeout: 5000 }, async t => {
  let started
  const providerStarted = new Promise(resolve => { started = resolve })
  let complete
  const pendingHome = new Promise(resolve => { complete = resolve })
  const { game, port } = await setup(t, { homeProvider: async () => { started(); return pendingHome } })
  const disconnected = once(game.events, 'disconnect')
  const c = await client(port)
  c.send(10101, {}, 4)
  await providerStarted
  c.socket.destroy()
  await disconnected
  complete({ payload: Buffer.alloc(0) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(game.statistics.logins, 0)
})

test('invalid server configuration is rejected before connections arrive', () => {
  const store = { login: async () => {} }
  for (const config of [{ maxPayload: Infinity }, { maxConnections: -1 }, { idleTimeout: -1 }, { handlers: [] }, { homeProvider: 3 }, { traceNetwork: 'yes' }]) {
    assert.throws(() => createGameServer({ store, ...config }), /Invalid/)
  }
})

for (const starterHome of [false, true]) {
  test(`encrypted TCP hello, ${starterHome ? 'native starter' : 'synthetic'} Home and heartbeat work in both directions`, { timeout: 5000 }, async t => {
    const { NativeTransport } = require('../server/transport')
    const { keyPair, boxKey } = require('../lib/protocol/salsa17')
    const { sealLogin, openLoginReply, SessionCipher } = require('../lib/protocol/transport')
    const secret = Buffer.alloc(32, 13); const peer = keyPair(secret).publicKey
    const clientSecret = Buffer.alloc(32, 7); const clientPublicKey = keyPair(clientSecret).publicKey
    const clientNonce = Buffer.alloc(24, 5); const sharedKey = boxKey(peer, clientSecret)
    const entries = []
    const handlers = createStartupHandlers({ logger: entry => entries.push(entry), traceNetwork: true })
    for (const [id, handler] of createAllianceHandlers()) handlers.set(id, handler)
    for (const [id, handler] of createNameHandlers({ logger: entry => entries.push(entry) })) handlers.set(id, handler)
    const contentUrls = ['http://127.0.0.1:9338']
    const { game, port, directory } = await setup(t, { handlers, contentUrls, transportFactory: () => new NativeTransport(secret), homeProvider: starterHome ? createStarterHomeProvider({ emotes: false }) : async () => ({ payload: Buffer.from('SYNTHETIC HOME FOR TCP TEST ONLY') }) })
    if (starterHome) for (const [id, handler] of createStarterHandlers({ store: new AccountStore(directory) })) handlers.set(id, handler)
    const c = await client(port)
    c.send(10100)
    const hello = decodeMessage(20100, (await c.receive()).payload)
    const box = sealLogin({ payload: encodeMessage(10101), sharedKey, clientNonce, clientPublicKey, serverPublicKey: peer, serverHelloNonce: hello.nonce })
    c.socket.write(encodeFrame(10101, 4, box))
    const reply = await c.receive()
    assert.equal(reply.id, 20758)
    const opened = openLoginReply({ box: reply.payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey: peer })
    const account = decodeMessage(20758, opened.payload)
    assert.equal(account.field_0x80[1], 1)
    assert.deepEqual(account.field_0x128, contentUrls)
    assert.deepEqual(account.field_0x130, contentUrls)
    const receive = new SessionCipher(opened.sessionKey, opened.serverNonce)
    const send = new SessionCipher(opened.sessionKey, clientNonce)
    const home = await c.receive()
    assert.equal(home.id, 21217)
    const expected = starterHome ? Buffer.from(require('./fixtures/native-unlocked-home.json').find(f => f.starter?.nameSet === false).payloadHex, 'hex') : Buffer.from('SYNTHETIC HOME FOR TCP TEST ONLY')
    assert.deepEqual(receive.decrypt(home.payload), expected)
    const metadata = { field_0x80_0x8: 'private-event-name', field_0x80_0x20_json: '{"details":"private-event-value"}' }
    c.socket.write(encodeFrame(10459, 0, send.encrypt(encodeMessage(10459, metadata))))
    c.socket.write(encodeFrame(11485, 0, send.encrypt(Buffer.alloc(0))))
    c.socket.write(encodeFrame(13752, 0, send.encrypt(encodeMessage(13752, { field_0x7c: 1234, field_0x80: 'private-network-address' }))))
    for (const [name, accepted] of [['Player name', true], ['بازیکن', true], ['', false], ['bad\nname', false], ['a'.repeat(201), false]]) {
      c.socket.write(encodeFrame(16592, 0, send.encrypt(encodeMessage(16592, { field_0x80: name }))))
      const check = await c.receive()
      assert.equal(check.id, 20821)
      assert.deepEqual(decodeMessage(20821, receive.decrypt(check.payload)), { field_0x7c: !accepted, field_0x80: accepted ? 0 : 1, field_0x88: null })
    }
    const unchanged = await new AccountStore(directory).login(account.field_0x80, account.field_0x90)
    assert.equal(unchanged.name, 'Player')
    assert.equal(unchanged.starter.nameSet, false)
    c.socket.write(encodeFrame(14783, 0, send.encrypt(encodeMessage(14783, { field_0x80: 'قبیله', field_0x94: 50 }))))
    const advanced = await c.receive()
    assert.equal(advanced.id, 24184)
    assert.deepEqual(decodeMessage(24184, receive.decrypt(advanced.payload)), { field_0x80: [] })
    c.socket.write(encodeFrame(16442, 0, send.encrypt(encodeMessage(16442))))
    const friends = await c.receive()
    assert.equal(friends.id, 21047)
    assert.deepEqual(receive.decrypt(friends.payload), Buffer.from(require('./fixtures/native-empty-friends.json')[0].payload, 'hex'))
    if (starterHome) {
      c.socket.write(encodeFrame(11712, 0, send.encrypt(encodeMessage(11712, { field_0x80: account.field_0x80 }))))
      const stream = await c.receive()
      assert.equal(stream.id, 28299)
      assert.deepEqual(receive.decrypt(stream.payload), Buffer.from(require('./fixtures/native-avatar-stream.json').emptyReply.payload, 'hex'))
      c.socket.write(encodeFrame(13597, 0, send.encrypt(encodeMessage(13597))))
      c.socket.write(encodeFrame(13597, 0, send.encrypt(encodeMessage(13597, { commands: [{ id: 703, fields: { field_0x1c: 4 } }, { id: 805 }] }))))
      c.socket.write(encodeFrame(13597, 0, send.encrypt(encodeMessage(13597, { commands: [require('./fixtures/native-arena-boost-command.json'), { id: 948, fields: { field_0x20: 'بازیکن' } }] }))))
      c.socket.write(encodeFrame(13597, 0, send.encrypt(encodeMessage(13597, { commands: [{ id: 693, fields: { field_0x1c: 0, field_0x20: 1, field_0x24: -1 } }, { id: 762, fields: { field_0x1c: 0 } }, require('../docs/native-lobby-actions.json').reward] }))))
    }
    for (let n = 0; n < 2; n++) {
      c.socket.write(encodeFrame(10108, 0, send.encrypt(Buffer.alloc(0))))
      const response = await c.receive()
      assert.equal(response.id, 20108); assert.equal(receive.decrypt(response.payload).length, 0)
    }
    assert.equal(game.statistics.logins, 1)
    assert.equal(game.statistics.unsupported, 0)
    assert.deepEqual(entries.map(entry => entry.event), ['client-metadata-accepted', 'client-ui-startup-notice', 'client-network-report', ...Array(5).fill('name-check-result'), 'server-friends-sent'])
    assert.deepEqual(entries.filter(entry => entry.event === 'name-check-result').map(entry => entry.accepted), [true, true, false, false, false])
    assert(!JSON.stringify(entries).includes('بازیکن'))
    assert(!JSON.stringify(entries).includes('private-event'))
    assert(!JSON.stringify(entries).includes('private-network-address'))
    if (starterHome) {
      const saved = await new AccountStore(directory).login(account.field_0x80, account.field_0x90)
      assert.equal(saved.starter.selectedDeck, 4)
      assert.equal(saved.name, 'بازیکن')
      assert.equal(saved.starter.gold, 600)
      assert.equal(saved.starter.freeGold, 500)
      assert.equal(saved.starter.freePassGoldClaimed, true)
      assert.equal(saved.starter.passSeenCrowns, 0)
      assert.equal(saved.starter.decks[4][1], 26000002)
      assert.equal(saved.starter.arena1Boost.expiresAtMs - saved.starter.arena1Boost.claimedAtMs, 86400000)
    }
    receive.close(); send.close()
  })
}

test('client startup metadata is validated without retaining or logging its values', async () => {
  const entries = []
  const handlers = createStartupHandlers({ traceNetwork: true, logger: entry => entries.push(entry) })
  for (const value of [null, 'not JSON']) {
    const payload = encodeMessage(10459, { field_0x80_0x8: 'event', field_0x80_0x20_json: value })
    await assert.rejects(handlers.get(10459)({}, null, { payload }), /Invalid client metadata/)
  }
  await assert.rejects(handlers.get(11485)({}, null, { payload: Buffer.from([1]) }), /trailing/)
  assert.equal(entries.length, 0)
})

test('missing Home returns encrypted LoginFailed after encrypted Login', { timeout: 5000 }, async t => {
  const { NativeTransport } = require('../server/transport')
  const { keyPair, boxKey } = require('../lib/protocol/salsa17')
  const { sealLogin, openLoginReply } = require('../lib/protocol/transport')
  const secret = Buffer.alloc(32, 19); const peer = keyPair(secret).publicKey
  const clientSecret = Buffer.alloc(32, 21); const clientPublicKey = keyPair(clientSecret).publicKey
  const clientNonce = Buffer.alloc(24, 17); const sharedKey = boxKey(peer, clientSecret)
  const entries = []
  const { game, port } = await setup(t, { transportFactory: () => new NativeTransport(secret), traceNetwork: true, logger: entry => entries.push(entry) })
  const c = await client(port); c.send(10100)
  const hello = decodeMessage(20100, (await c.receive()).payload)
  const packet = sealLogin({ payload: encodeMessage(10101), sharedKey, clientNonce, clientPublicKey, serverPublicKey: peer, serverHelloNonce: hello.nonce })
  c.socket.write(encodeFrame(10101, 4, packet))
  const reply = await c.receive()
  assert.equal(reply.id, 20103); assert.equal(reply.version, 4)
  const opened = openLoginReply({ box: reply.payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey: peer })
  assert.match(decodeMessage(20103, opened.payload).field_0x98, /compatible player-state Home provider/)
  assert.equal(game.statistics.logins, 0)
  assert.deepEqual(entries.filter(entry => entry.event === 'message-received').map(entry => entry.id), [10100, 10101])
  assert.deepEqual(entries.filter(entry => entry.event === 'message-sent').map(entry => entry.id), [20100, 20103])
  assert.equal(entries[0].event, 'connection-open')
  assert(entries.every(entry => entry.connectionId === 1))
  const serialized = JSON.stringify(entries)
  for (const value of [secret, clientSecret, sharedKey]) assert(!serialized.includes(value.toString('hex')))
  assert(!serialized.includes('compatible player-state Home provider'))
})

test('network tracing distinguishes a silent connected client from a protocol login', { timeout: 5000 }, async t => {
  const entries = []
  const { game, port } = await setup(t, { idleTimeout: 100, traceNetwork: true, logger: entry => entries.push(entry) })
  const disconnected = once(game.events, 'disconnect')
  const c = await client(port)
  await disconnected
  c.socket.destroy()
  assert.deepEqual(entries.map(entry => entry.event), ['connection-open', 'connection-close'])
  const close = entries[1]
  assert.equal(close.reason, 'idle-timeout')
  assert.equal(close.receivedBytes, 0)
  assert.equal(close.receivedFrames, 0)
  assert.equal(close.state, 'connected')
})

test('server key creation is persistent, private and safe under concurrent startup', async t => {
  const { directory } = await setup(t)
  const { loadServerKey } = require('../server/key')
  const filename = path.join(directory, 'server-key.json')
  const secrets = await Promise.all(Array.from({ length: 5 }, () => loadServerKey(filename)))
  for (const secret of secrets) assert.deepEqual(secret, secrets[0])
  assert.equal((await fs.stat(filename)).mode & 0o077, 0)
  assert.deepEqual(await loadServerKey(filename), secrets[0])
  await fs.writeFile(filename, '{"schema":1,"secret":"bad"}')
  await assert.rejects(loadServerKey(filename), /Invalid server key/)
})
