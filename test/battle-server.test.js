'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { once } = require('node:events')
const { AccountStore } = require('../server/accounts')
const { createGameServer } = require('../server/core')
const { createStarterHomeProvider } = require('../server/home')
const { createStarterHandlers } = require('../server/starter-handlers')
const { BattleCoordinator } = require('../server/battle/coordinator')
const { FrameDecoder, encodeFrame } = require('../lib/protocol/frame')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')
const { decodeSectorStateEnvelope } = require('../lib/protocol/sector-state')

async function connect (port) {
  const socket = net.connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const decoder = new FrameDecoder(), frames = [], pending = []
  socket.on('data', bytes => {
    for (const frame of decoder.push(bytes)) {
      const index = pending.findIndex(waiter => waiter.id === frame.id)
      if (index < 0) frames.push(frame)
      else { const waiter = pending.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(frame) }
    }
  })
  socket.on('close', () => { for (const waiter of pending.splice(0)) { clearTimeout(waiter.timer); waiter.reject(Error('Connection closed')) } })
  const client = {
    socket,
    frames,
    send: (id, fields = {}) => socket.write(encodeFrame(id, 0, encodeMessage(id, fields))),
    receive: id => {
      const index = frames.findIndex(frame => frame.id === id)
      if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0])
      return new Promise((resolve, reject) => {
        const waiter = { id, resolve, reject, timer: setTimeout(() => { pending.splice(pending.indexOf(waiter), 1); reject(Error('Timed out waiting for ' + id)) }, 20000) }
        pending.push(waiter)
      })
    },
  }
  client.login = async (id = [0, 0], token = null, inBattle = false) => {
    client.send(10101, { field_0x80: id, field_0x88: token, field_0x90: 3, field_0x98: 1945 })
    const ok = decodeMessage(20758, (await client.receive(20758)).payload)
    await client.receive(inBattle ? 28991 : 21217)
    return { id: ok.field_0x80, token: ok.field_0x90 }
  }
  return client
}

async function setup (t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-battle-server-')), store = new AccountStore(directory)
  const homeProvider = createStarterHomeProvider(), logs = [], logger = entry => logs.push(entry)
  const battles = new BattleCoordinator({ store, homeProvider, logger, fallbackMs: 0, ...options })
  const handlers = createStarterHandlers({ store, battles, logger })
  for (const [id, handler] of battles.handlers()) handlers.set(id, handler)
  const game = createGameServer({ store, homeProvider, handlers, logger, traceNetwork: true, loginResponseProvider: options.initialLogin ? session => battles.initialResponse(session) : null })
  if (!options.initialLogin) game.events.on('login', session => battles.login(session).catch(error => battles.logError(error)))
  game.events.on('disconnect', session => { if (session.account) battles.disconnect(session) })
  game.server.listen(0, '127.0.0.1'); await once(game.server, 'listening')
  t.after(async () => { await battles.stop(); await game.stop(); await fs.rm(directory, { recursive: true, force: true }) })
  return { game, battles, store, logs, port: game.server.address().port }
}

const requestBattle = client => client.send(13597, { commands: [{ id: 527, fields: { field_0x20: 0, field_0x24: -1 } }] })

test('real TCP Training starts native world, acknowledges sectors, resumes the same match and returns Home', { timeout: 60000 }, async t => {
  const { game, battles, store, logs, port } = await setup(t)
  const first = await connect(port), identity = await first.login()
  first.send(17967, { field_0x80: [18, 7] })
  const snapshot = decodeSectorStateEnvelope((await first.receive(28991)).payload)
  assert.equal(snapshot.snapshot[0], 1)
  assert.ok(snapshot.snapshot.length > 800)
  first.send(15263)
  const sector = decodeMessage(26980, (await first.receive(26980)).payload)
  assert.equal(sector.field_0x80, 1)
  first.send(10108); await first.receive(20108)
  const match = [...battles.matches.values()][0]
  const disconnected = once(game.events, 'disconnect')
  first.socket.destroy(); await disconnected
  const resumed = await connect(port)
  assert.deepEqual(await resumed.login(identity.id, identity.token), identity)
  await resumed.receive(28991)
  assert.equal([...battles.matches.values()][0], match)
  resumed.send(15965); await resumed.receive(21217)
  const account = await store.login(identity.id, identity.token)
  assert.equal(account.battleHistory.length, 1)
  assert.equal(account.battleHistory[0].kind, 'training')
  assert.equal(account.battleHistory[0].outcome, 'loss')
  assert.equal(account.starter.gems, 100)
  assert.equal(battles.matches.size, 0)
  assert.ok(logs.some(row => row.event === 'battle-resumed'))
  assert.equal(logs.some(row => row.event === 'session-error'), false)
  resumed.socket.destroy()
})

test('real TCP normal queue cancellation, two-human matchmaking, forfeit and persistent winner gold', { timeout: 60000 }, async t => {
  const { battles, store, logs, port } = await setup(t)
  const first = await connect(port), second = await connect(port)
  const identities = [await first.login(), await second.login()]
  requestBattle(first); first.send(13006); await first.receive(25382)
  assert.equal(battles.queue.size, 0)
  requestBattle(first); requestBattle(second)
  await Promise.all([first.receive(28991), second.receive(28991)])
  first.send(15263); second.send(15263)
  await Promise.all([first.receive(26980), second.receive(26980)])
  first.send(15965)
  await Promise.all([first.receive(21217), second.receive(22871)])
  second.send(15965); await second.receive(21217)
  const loser = await store.login(identities[0].id, identities[0].token), winner = await store.login(identities[1].id, identities[1].token)
  assert.equal(loser.battleHistory[0].outcome, 'loss')
  assert.equal(winner.battleHistory[0].outcome, 'win')
  assert.equal(loser.starter.gold, 100); assert.equal(winner.starter.gold, 105)
  assert.equal(winner.battleHistory[0].gold, 5)
  second.send(15965); await second.receive(21217)
  assert.equal((await store.login(winner.id, winner.token)).battleHistory.length, 1)
  assert.equal(battles.matches.size, 0)
  assert.ok(logs.some(row => row.event === 'matchmaking-cancelled'))
  assert.equal(logs.some(row => row.event === 'session-error'), false)
  first.socket.destroy(); second.socket.destroy()
})

test('TCP login routes directly to the unfinished online match; offline completion persists both accounts and 18100 returns current Home', { timeout: 60000 }, async t => {
  const { game, battles, store, port } = await setup(t, { initialLogin: true })
  const first = await connect(port), second = await connect(port)
  const identities = [await first.login(), await second.login()]
  requestBattle(first); requestBattle(second)
  await Promise.all([first.receive(28991), second.receive(28991)])
  first.send(15263); second.send(15263)
  await Promise.all([first.receive(26980), second.receive(26980)])
  const match = [...battles.matches.values()][0]
  let disconnected = once(game.events, 'disconnect')
  first.socket.destroy(); await disconnected
  const resumed = await connect(port)
  await resumed.login(identities[0].id, identities[0].token, true)
  resumed.send(15263); resumed.send(10108); await resumed.receive(20108)
  assert.equal(resumed.frames.some(frame => frame.id === 21217), false)
  assert.equal(battles.active(match.players[0].session), match)
  for (const client of [resumed, second]) {
    disconnected = once(game.events, 'disconnect'); client.socket.destroy(); await disconnected
  }
  assert.equal(match.phase, 'running'); assert.equal(match.awayTimer, undefined)
  const result = await match.process.call('forfeit', { slot: 0 })
  await battles.finish(match, result)
  const [loser, winner] = await Promise.all(identities.map(id => store.login(id.id, id.token)))
  assert.equal(loser.battleHistory.length, 1); assert.equal(winner.battleHistory.length, 1)
  assert.equal(loser.starter.trophies, 0)
  assert.ok(winner.starter.trophies >= 36 && winner.starter.trophies <= 42)
  const returned = await connect(port)
  await returned.login(identities[1].id, identities[1].token)
  returned.send(18100, { field_0x7c: true, field_0x80: 0 }); await returned.receive(21217)
  assert.equal(returned.frames.some(frame => frame.id === 28991), false)
  assert.equal((await store.login(identities[1].id, identities[1].token)).battleHistory.length, 1)
  returned.socket.destroy()
})
