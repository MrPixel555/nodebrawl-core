'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { applyCommands, playerState } = require('../server/starter-state')
const { createStarterHomeProvider } = require('../server/home')
const { encodeCommand, decodeCommand } = require('../lib/protocol/commands')
const native = require('../docs/native-lobby-actions.json')

test('manual swaps, inventory replacement and deck switching preserve the exact original native card order', () => {
  for (const scenario of native.swaps) {
    let account = { id: scenario.accountId, name: 'Player', starter: playerState({ starter: scenario.initial }) }
    for (const observation of scenario.observations) {
      const command = observation.command
      assert.equal(encodeCommand(command).toString('hex'), command.payloadHex)
      const parsed = decodeCommand(Buffer.from(command.payloadHex, 'hex'))
      account = applyCommands(account, [parsed])
      assert.equal(account.starter.selectedDeck, observation.selectedDeck)
      assert.deepEqual(account.starter.decks[account.starter.selectedDeck], observation.active)
      assert.deepEqual(account.starter.inventory, observation.inventory)
      if (observation.homeFlags !== undefined) assert.equal(account.starter.homeFlags, observation.homeFlags)
      assert.equal(new Set([...observation.active, ...observation.inventory]).size, 95)
    }
    for (const { selectors } of scenario.invalid) {
      const fields = Object.fromEntries(['field_0x1c', 'field_0x20', 'field_0x24'].map((key, n) => [key, selectors[n]]))
      assert.throws(() => applyCommands(account, [{ id: 693, fields }]), /Invalid/)
    }
  }
})

test('free pass tier-zero credit, cap and duplicate rejection match native execution', () => {
  const command = native.reward
  assert.equal(encodeCommand(command).toString('hex'), command.payloadHex)
  for (const gold of [100, 4999900, 5000000]) {
    const original = { id: [0, 1], name: 'Player', starter: playerState({ starter: { selectedDeck: 0, gold } }) }
    const account = applyCommands(original, [command])
    assert.equal(account.starter.gold, Math.min(5000000, gold + 500))
    assert.equal(account.starter.freeGold, Math.min(500, 5000000 - gold))
    assert.equal(account.starter.freePassGoldClaimed, true)
    assert.equal(original.starter.freePassGoldClaimed, false)
    assert.throws(() => applyCommands(account, [command]), /already claimed/)
    assert.throws(() => applyCommands(original, [command, command]), /already claimed/)
    assert.equal(original.starter.gold, gold)
  }
  for (const patch of [{ field_0x1c: 10 }, { field_0x1c: -1 }, { field_0x20: true }, { field_0x21: true }]) {
    assert.throws(() => applyCommands({ name: 'Player' }, [{ id: 836, fields: { ...command.fields, ...patch } }]), /Unsupported/)
  }
})

test('free pass claim Home matches complete native codecs with and without Arena1 boost and capped balances', async () => {
  for (const fixture of require('./fixtures/native-season-pass-home.json')) {
    const provider = createStarterHomeProvider({ emotes: false, now: () => fixture.nowMs })
    const result = await provider({ id: fixture.accountId, name: fixture.name, starter: { selectedDeck: 0, ...fixture.starter } })
    assert.equal(result.payload.toString('hex'), fixture.payloadHex)
    assert.equal(result.payload.length, fixture.nativeDecodeConsumed)
  }
})

test('invalid persisted inventory and pass flags fail instead of silently resetting a player', () => {
  for (const inventory of [null, [], [26000000], Array(87).fill(26000002)]) assert.throws(() => playerState({ starter: { selectedDeck: 0, inventory } }), /inventory/)
  for (const freePassGoldClaimed of [null, 0, 'true']) assert.throws(() => playerState({ starter: { selectedDeck: 0, freePassGoldClaimed } }), /claim state/)
  for (const homeFlags of [-1, 1, 32, 4294967296, 1.5, null]) assert.throws(() => playerState({ starter: { selectedDeck: 0, homeFlags } }), /Home flags/)
  for (const selector of [0, -1, 5]) assert.throws(() => applyCommands({ name: 'Player' }, [{ id: 869, fields: { field_0x1c: selector } }]), /flag selector/)
})

test('concurrent pass claims credit once and a rejected mixed batch leaves saved cards and balances unchanged', async t => {
  const fs = require('node:fs/promises')
  const os = require('node:os')
  const path = require('node:path')
  const { AccountStore } = require('../server/accounts')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-pass-atomic-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new AccountStore(directory)
  const account = await store.login([0, 0], null)
  const swap = { id: 693, fields: { field_0x1c: -1, field_0x20: 0, field_0x24: 1 } }
  await assert.rejects(store.applyStarterTurn(account, [swap, native.reward, native.reward]), /already claimed/)
  assert.deepEqual((await store.login(account.id, account.token)).starter, account.starter)
  const results = await Promise.allSettled([store.applyStarterTurn(account, [swap, native.reward]), new AccountStore(directory).applyStarterTurn(account, [swap, native.reward])])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const saved = await new AccountStore(directory).login(account.id, account.token)
  assert.equal(saved.starter.gold, 600)
  assert.equal(saved.starter.freeGold, 500)
  assert.equal(saved.starter.decks[0][0], account.starter.decks[0][1])
  assert.equal(saved.starter.decks[0][1], account.starter.decks[0][0])
})
