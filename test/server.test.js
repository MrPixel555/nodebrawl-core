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
  t.after(async () => { await game.stop(); await fs.rm(directory, { recursive: true, force: true }) })
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
  assert.deepEqual(await new AccountStore(directory).login(account.id, account.token), { ...account, starter: { selectedDeck: 4 } })
  assert.deepEqual(await first.login(other.id, other.token), other)
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  for (const deck of [-1, 5, NaN, 1.5]) await assert.rejects(first.selectDeck(account, deck), /deck selection/)
  await assert.rejects(first.selectDeck({ ...account, token: 'incorrect' }, 2), /credentials/)
  await assert.rejects(first.selectDeck(null, 2), /credentials/)
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
})

test('TCP starter turns preserve deck selection across login and reject unsupported batches atomically', { timeout: 5000 }, async t => {
  const { game, port, directory } = await setup(t, { homeProvider: createStarterHomeProvider() })
  const entries = []
  const handlers = createStarterHandlers({ store: new AccountStore(directory), logger: entry => entries.push(entry), traceNetwork: true })
  // Both servers use the same account directory; reconnect through the other
  // instance to prove it reloads persistent state rather than a session cache.
  const active = createGameServer({ store: new AccountStore(directory), homeProvider: createStarterHomeProvider(), handlers })
  active.server.listen(0, '127.0.0.1')
  await once(active.server, 'listening')
  t.after(() => active.stop())
  const c = await client(active.server.address().port)
  c.send(10101, { field_0x80: [0, 0] }, 4)
  const ok = decodeMessage(20758, (await c.receive()).payload)
  await c.receive()
  const selection = deck => ({ id: 703, fields: { field_0x1c: deck } })
  c.send(13597)
  c.send(13597, { commands: [selection(1), selection(4)] })
  c.send(10108)
  assert.equal((await c.receive()).id, 20108)
  assert.equal((await new AccountStore(directory).login(ok.field_0x80, ok.field_0x90)).starter.selectedDeck, 4)
  c.send(13597, { commands: [selection(2), { id: 948, fields: { field_0x20: 'must not persist' } }] })
  const unknown = new Writer().vint(0).vint(0).vint(2).raw(require('../lib/protocol/commands').encodeCommand(selection(3))).vint(563).toBuffer()
  c.socket.write(encodeFrame(13597, 0, unknown))
  c.send(10108)
  assert.equal((await c.receive()).id, 20108)
  c.socket.destroy()
  assert.ok(entries.some(entry => entry.event === 'unsupported-turn' && entry.applied === false))
  assert.ok(entries.some(entry => entry.event === 'unsupported-turn-command' && entry.id === 563 && entry.applied === false))
  assert.ok(!JSON.stringify(entries).includes('must not persist'))
  // A fresh server instance must emit the independently native-encoded Home.
  const next = await client(port)
  next.send(10101, { field_0x80: ok.field_0x80, field_0x88: ok.field_0x90 }, 4)
  assert.equal((await next.receive()).id, 20758)
  const home = await next.receive()
  const expected = require('./fixtures/native-starter-home.json').find(fixture => fixture.accountId[1] === 1 && fixture.selectedDeck === 4)
  assert.equal(home.payload.toString('hex'), expected.payloadHex)
  assert.equal(game.statistics.logins, 1)
  next.socket.destroy()
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
    const handlers = new Map()
    const { game, port, directory } = await setup(t, { handlers, transportFactory: () => new NativeTransport(secret), homeProvider: starterHome ? createStarterHomeProvider() : async () => ({ payload: Buffer.from('SYNTHETIC HOME FOR TCP TEST ONLY') }) })
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
    const receive = new SessionCipher(opened.sessionKey, opened.serverNonce)
    const send = new SessionCipher(opened.sessionKey, clientNonce)
    const home = await c.receive()
    assert.equal(home.id, 21217)
    const expected = starterHome ? Buffer.from(require('./fixtures/native-starter-home.json').find(f => f.accountId[1] === 1).payloadHex, 'hex') : Buffer.from('SYNTHETIC HOME FOR TCP TEST ONLY')
    assert.deepEqual(receive.decrypt(home.payload), expected)
    if (starterHome) {
      c.socket.write(encodeFrame(13597, 0, send.encrypt(encodeMessage(13597))))
      c.socket.write(encodeFrame(13597, 0, send.encrypt(encodeMessage(13597, { commands: [{ id: 703, fields: { field_0x1c: 4 } }] }))))
    }
    for (let n = 0; n < 2; n++) {
      c.socket.write(encodeFrame(10108, 0, send.encrypt(Buffer.alloc(0))))
      const response = await c.receive()
      assert.equal(response.id, 20108); assert.equal(receive.decrypt(response.payload).length, 0)
    }
    assert.equal(game.statistics.logins, 1)
    if (starterHome) assert.equal((await new AccountStore(directory).login(account.field_0x80, account.field_0x90)).starter.selectedDeck, 4)
    receive.close(); send.close()
  })
}

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
