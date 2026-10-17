'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { AccountStore } = require('../server/accounts')
const { createAllianceHandlers } = require('../server/alliance-handlers')
const { encodeCommand, decodeCommand } = require('../lib/protocol/commands')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')
const { createStarterHomeProvider, createStarterProfileProvider } = require('../server/home')
const settings = { field_0x80: 'قبیله', field_0x88: 'Description', field_0x90: [16, 0], field_0xa0: 1, field_0xa4: 0, field_0x98: [0, 0] }

for (const fixture of require('./fixtures/native-clan-membership.json')) {
  test(`native clan membership command, created=${fixture.fields.field_0x38}`, () => {
    const wire = Buffer.from(fixture.payloadHex, 'hex')
    assert.deepEqual(encodeCommand(fixture), wire)
    assert.deepEqual(decodeCommand(wire), { id: 477, fields: fixture.fields })
    assert.deepEqual(decodeMessage(22192, wire).field_0x80, { id: 477, fields: fixture.fields })
    for (let n = 0; n < wire.length; n++) assert.throws(() => decodeCommand(wire.subarray(0, n)))
    assert.throws(() => encodeMessage(16194, { field_0x80: fixture }), /origin/)
  })
}
for (const fixture of require('./fixtures/native-full-clan.json')) {
  test('full clan data and member list match original native codecs', () => {
    const wire = Buffer.from(fixture.payloadHex, 'hex')
    assert.deepEqual(encodeMessage(28165, fixture.fields), wire)
    assert.deepEqual(decodeMessage(28165, wire), fixture.fields)
    for (let n = 0; n < wire.length; n++) assert.throws(() => decodeMessage(28165, wire.subarray(0, n)))
    assert.throws(() => decodeMessage(28165, Buffer.concat([wire, Buffer.from([0])])), /trailing/)
  })
}
for (const [index, fixture] of require('./fixtures/native-dynamic-home.json').entries()) {
  test(`current Party/clan Home/Profile native round trip ${index}`, async () => {
    const provider = fixture.id === 21217 ? createStarterHomeProvider({ unlocked: fixture.unlocked, party: true }) : createStarterProfileProvider({ unlocked: fixture.unlocked })
    const result = await provider(fixture.account)
    assert.equal(result.payload.toString('hex'), fixture.payloadHex)
    assert.equal(result.payload.length, fixture.nativeDecodeConsumed)
    assert.equal(fixture.nativeReencodeEqual, true)
  })
}

test('clan creation charges once atomically, persists membership and sends the native acknowledgement before clan data', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-clans-'))
  t.after(() => fs.rm(directory, { force: true, recursive: true }))
  const store = new AccountStore(directory), account = await store.login([0, 0], null)
  await assert.rejects(store.createAlliance(account, settings), /1000 gold/)
  const funded = await store.applyStarterTurn(account, [{ id: 687, fields: { field_0x20: [55, 0] } }])
  assert.equal(funded.starter.gold, 1100)
  await store.serial(async () => {
    const data = await store.load()
    data.accounts[0].starter.freeGold = 500
    await store.save(data)
  })
  const first = store.createAlliance(funded, settings), repeated = store.createAlliance(funded, settings)
  const result = await first
  await assert.rejects(repeated, /already belongs/)
  assert.equal(result.account.starter.gold, 100)
  assert.equal(result.account.starter.freeGold, 100)
  const restarted = new AccountStore(directory), resumed = await restarted.login(account.id, account.token)
  assert.deepEqual(resumed.alliance, result.account.alliance)
  assert.equal((await restarted.listAlliances('قبیله')).length, 1)
  assert.deepEqual(await restarted.listAlliances('missing'), [])
  assert.equal((await restarted.findAlliance(resumed.alliance.id)).members.length, 1)
  assert.equal((await restarted.findPlayer(account.id)).alliance.role, 2)
  assert.equal((await fs.readdir(directory)).length, 1)
  const second = await store.login([0, 0], null)
  const rich = await store.applyStarterTurn(second, [{ id: 687, fields: { field_0x20: [55, 0] } }])
  const sent = [], session = { account: rich, send: (id, fields) => sent.push({ id, payload: encodeMessage(id, fields) }) }
  await createAllianceHandlers({ store }).get(10453)(session, settings)
  assert.deepEqual(sent.map(packet => packet.id), [22192, 28165])
  assert.equal(decodeMessage(22192, sent[0].payload).field_0x80.fields.field_0x38, true)
  assert.equal(decodeMessage(28165, sent[1].payload).field_0x80.members[0].field_0x10[1], second.id[1])
  assert.equal(session.account.starter.gold, 100)
  await assert.rejects(store.createAlliance({ ...rich, token: 'wrong' }, settings), /credentials/)
})

test('clan creation rejects unknown data and invalid settings without debiting or storing a clan', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-clans-rejected-'))
  t.after(() => fs.rm(directory, { force: true, recursive: true }))
  const store = new AccountStore(directory), account = await store.login([0, 0], null)
  await store.applyStarterTurn(account, [{ id: 687, fields: { field_0x20: [55, 0] } }])
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')
  for (const override of [{ field_0x80: ' ' }, { field_0x80: 'a'.repeat(61) }, { field_0x90: [16, 9999] }, { field_0x90: [26, 0] }, { field_0xa0: -1 }, { field_0xa4: -1 }, { field_0x98: [57, 99999] }]) await assert.rejects(store.createAlliance(account, { ...settings, ...override }), /settings/)
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before)
})
