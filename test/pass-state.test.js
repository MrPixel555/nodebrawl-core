'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { playerState, applyCommands } = require('../server/starter-state')
const { AccountStore } = require('../server/accounts')
const { createStarterHomeProvider } = require('../server/home')
const { decodeRewardManager, encodeRewardManager } = require('../lib/protocol/pass-state')
const { encodeCommand, decodeCommand } = require('../lib/protocol/commands')
const native = require('../docs/native-pass-state.json')
const homes = require('./fixtures/native-pass-state-home.json')
const { rewardForCrowns } = require('../server/season-pass')

test('complete original reward catalogue and crown selectors match all five native pass variants', async () => {
  const { createHash } = require('node:crypto')
  const cataloguePath = path.join(__dirname, '../server/data/season-rewards.json')
  assert.equal(createHash('sha256').update(await fs.readFile(cataloguePath)).digest('hex'), native.catalogueSha256)
  const catalogue = require('../server/data/season-rewards.json')
  assert.equal(catalogue.passes.length, native.passRows)
  assert.equal(catalogue.passes.reduce((total, pass) => total + pass.rewards.length * 2, 0), native.tracks)
  for (const { passId, selector, crowns } of native.selections) {
    if (crowns === null) assert.throws(() => rewardForCrowns(selector, passId), /crown selector/)
    else assert.equal(rewardForCrowns(selector, passId).crowns, crowns)
  }
  assert.throws(() => rewardForCrowns(0, 123), /Unknown/)
  for (const crowns of [null, 0.5, 2147483648]) assert.throws(() => rewardForCrowns(crowns), /crown selector/)
})

test('native reward manager optional branches, distinct integer fields and identity vectors roundtrip exactly', () => {
  for (const fixture of native.managerShapes) {
    assert.deepEqual(decodeRewardManager(Buffer.from(fixture.hex, 'hex')), fixture.fields)
    assert.equal(encodeRewardManager(fixture.fields).toString('hex'), fixture.hex)
  }
  const empty = { field_0x20: 0, field_0x28: 0, field_0x24: 0, field_0x2c: 0, slots: [] }
  assert.deepEqual(decodeRewardManager(encodeRewardManager(empty)), empty)
  for (const slots of [null, Array(1001).fill({})]) assert.throws(() => encodeRewardManager({ ...empty, slots }), /collection/)
})

test('free gold selectors between native crown thresholds grant the same one-time tier-zero reward', () => {
  for (const fixture of native.claimSelectors) {
    const account = { name: 'Player' }
    if (fixture.result !== 0) assert.throws(() => applyCommands(account, [fixture.command]))
    else {
      const next = applyCommands(account, [fixture.command])
      assert.equal(next.starter.gold, 600)
      assert.equal(next.starter.freeGold, 500)
      assert.throws(() => applyCommands(next, [fixture.command]), /already claimed/)
    }
  }
})

test('pass seen validation and mutations match original 762 for every observed boundary', () => {
  for (const observation of native.observations) {
    assert.equal(encodeCommand(observation.command).toString('hex'), observation.command.payloadHex)
    const command = decodeCommand(Buffer.from(observation.command.payloadHex, 'hex'))
    const starter = { selectedDeck: 0, passCrowns: observation.crowns, passSeenCrowns: observation.initialSeen, freePassGoldClaimed: observation.claimed }
    const before = { id: [0, 1], name: 'Player', starter }
    if (observation.result !== 0) assert.throws(() => applyCommands(before, [command]), /season pass/i)
    else {
      const next = applyCommands(before, [command])
      assert.equal(next.starter.passSeenCrowns, observation.seen)
      assert.equal(next.starter.passCrowns, observation.crowns)
      assert.equal(next.starter.gold, 100)
    }
    assert.equal(before.starter.passSeenCrowns, observation.initialSeen)
  }
})

test('persisted pass progress is migrated and validated without granting crowns', () => {
  const legacy = playerState({ starter: { selectedDeck: 0, freePassGoldClaimed: true } })
  assert.equal(legacy.passCrowns, 0)
  assert.equal(legacy.passSeenCrowns, -1)
  assert.equal(legacy.freePassGoldClaimed, true)
  for (const passCrowns of [-1, 1.5, null, '10', 2147483648]) assert.throws(() => playerState({ starter: { selectedDeck: 0, passCrowns } }), /pass progress/)
  for (const passSeenCrowns of [-2, 1, 1.5, null, '0']) assert.throws(() => playerState({ starter: { selectedDeck: 0, passSeenCrowns } }), /pass progress/)
  for (const passInitialized of [null, 0, 'true']) assert.throws(() => playerState({ starter: { selectedDeck: 0, passInitialized } }), /initialization/)
})

test('pass manager and complete Home exactly match every native fixture including gold/boost coexistence', async () => {
  for (const fixture of homes) {
    const payload = Buffer.from(fixture.managerHex, 'hex')
    const manager = decodeRewardManager(payload)
    assert.deepEqual(encodeRewardManager(manager), payload)
    const progress = manager.slots[0].pass
    assert.equal(progress.crowns, fixture.starter.passCrowns)
    assert.equal(progress.seenCrowns, fixture.starter.passSeenCrowns)
    assert.equal(progress.freeClaimedCrowns, fixture.starter.freePassGoldClaimed ? 0 : -1)
    const home = await createStarterHomeProvider({ emotes: false, now: () => fixture.nowMs })({ id: fixture.accountId, name: fixture.name, starter: fixture.starter })
    assert.equal(home.payload.toString('hex'), fixture.payloadHex)
    assert.equal(home.payload.length, fixture.nativeDecodeConsumed)
    for (let end = 0; end < payload.length; end++) assert.throws(() => decodeRewardManager(payload.subarray(0, end)))
    assert.throws(() => decodeRewardManager(Buffer.concat([payload, Buffer.from([0])])), /trailing/)
  }
})

test('seen pass survives store restart; invalid or mixed batches preserve previous rewards and state', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-pass-state-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new AccountStore(directory)
  const account = await store.login([0, 0], null)
  const seen = { id: 762, fields: { field_0x1c: 0 } }
  const claim = require('../docs/native-lobby-actions.json').reward
  const invalid = { id: 762, fields: { field_0x1c: 10 } }
  await assert.rejects(store.applyStarterTurn(account, [seen, claim, invalid]), /earned crowns/)
  assert.equal((await store.login(account.id, account.token)).starter.passSeenCrowns, -1)
  await store.applyStarterTurn(account, [seen, claim])
  const restored = await new AccountStore(directory).login(account.id, account.token)
  assert.equal(restored.starter.passSeenCrowns, 0)
  assert.equal(restored.starter.passCrowns, 0)
  assert.equal(restored.starter.freePassGoldClaimed, true)
  assert.equal(restored.starter.gold, 600)
  assert.deepEqual((await createStarterHomeProvider({ emotes: false })(restored)).payload, (await createStarterHomeProvider({ emotes: false })(await store.login(account.id, account.token))).payload)
})
