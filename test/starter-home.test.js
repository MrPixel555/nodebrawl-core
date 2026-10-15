'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createStarterHomeProvider, createStarterProfileProvider, loadHomeProvider } = require('../server/home')
const fixtures = require('./fixtures/native-starter-home.json')

test('starter player identity bindings match full native Home outputs, including VInt boundaries and UTF-8', async () => {
  const provider = createStarterHomeProvider()
  for (const fixture of fixtures) {
    const home = await provider({ id: fixture.accountId, name: fixture.name, starter: { selectedDeck: fixture.selectedDeck ?? 0, ...fixture.starter } })
    assert.equal(home.version, 0)
    assert.equal(home.payload.toString('hex'), fixture.payloadHex)
  }
  const first = await provider({ id: fixtures[0].accountId, name: fixtures[0].name })
  first.payload.fill(0)
  assert.equal((await provider({ id: fixtures[0].accountId, name: fixtures[0].name })).payload.toString('hex'), fixtures[0].payloadHex)
})

test('starter Home rejects identities exceeding the native limits', async () => {
  const provider = createStarterHomeProvider()
  for (const id of [[], [0], [0, 1.5], [0, 2147483648]]) await assert.rejects(provider({ id, name: 'Player' }))
  for (const name of ['', null, 'ا'.repeat(101)]) await assert.rejects(provider({ id: [0, 1], name }), /identity/)
  for (const starter of [null, [], {}, { selectedDeck: -1 }, { selectedDeck: 5 }, { selectedDeck: 1.5 }]) await assert.rejects(provider({ id: [0, 1], name: 'Player', starter }), /deck selection/)
})

test('Home mode selection preserves the disabled default and rejects conflicting configuration', async () => {
  assert.equal(await loadHomeProvider(), null)
  assert.equal(await loadHomeProvider({ mode: 'disabled' }), null)
  assert.equal(typeof await loadHomeProvider({ mode: 'starter' }), 'function')
  await assert.rejects(loadHomeProvider({ mode: 'unknown' }), /HOME_MODE/)
  await assert.rejects(loadHomeProvider({ mode: 'template' }), /requires HOME_TEMPLATE_PATH/)
  await assert.rejects(loadHomeProvider({ mode: 'starter', templatePath: 'example.json' }), /requires HOME_MODE=template/)
})

test('profile card collection and Avatar match native outputs for UTF-8 names, large IDs and reordered decks', async () => {
  const provider = createStarterProfileProvider()
  for (const fixture of require('./fixtures/native-starter-profile.json')) {
    const result = await provider({ id: fixture.accountId, name: fixture.name, starter: fixture.starter })
    assert.equal(result.payload.toString('hex'), fixture.payloadHex)
  }
})
