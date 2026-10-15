'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomBytes, timingSafeEqual } = require('node:crypto')
const { ProtocolError } = require('../lib/protocol/stream')
const { playerState, applyCommands } = require('./starter-state')

const queues = new Map()

function sameToken (a, b) {
  const first = Buffer.from(a || '')
  const second = Buffer.from(b || '')
  return first.length === second.length && first.length > 0 && timingSafeEqual(first, second)
}

class AccountStore {
  constructor (directory) { this.directory = path.resolve(directory) }
  serial (operation) {
    const result = (queues.get(this.directory) || Promise.resolve()).then(operation)
    const settled = result.catch(() => {})
    queues.set(this.directory, settled)
    settled.then(() => { if (queues.get(this.directory) === settled) queues.delete(this.directory) })
    return result
  }

  async load () {
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.directory, 'accounts.json'), 'utf8'))
      if (data.schema !== 1 || !Number.isInteger(data.nextId) || data.nextId < 1 || data.nextId > 2147483648 || !Array.isArray(data.accounts)) throw new Error('Invalid account database')
      const ids = new Set()
      for (const account of data.accounts) {
        if (!account || !Array.isArray(account.id) || account.id.length !== 2 || account.id[0] !== 0 || !Number.isInteger(account.id[1]) || account.id[1] < 1 || account.id[1] >= data.nextId || ids.has(account.id[1]) || typeof account.token !== 'string' || !/^[0-9a-f]{40}$/.test(account.token) || typeof account.name !== 'string' || typeof account.createdAt !== 'string' || !Number.isFinite(Date.parse(account.createdAt))) throw new Error('Invalid account database')
        ids.add(account.id[1])
        playerState(account)
      }
      return data
    } catch (error) {
      if (error.code === 'ENOENT') return { schema: 1, nextId: 1, accounts: [] }
      throw error
    }
  }

  async save (database) {
    await fs.mkdir(this.directory, { recursive: true })
    const target = path.join(this.directory, 'accounts.json')
    const temporary = path.join(this.directory, `accounts.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      await fs.writeFile(temporary, JSON.stringify(database, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await fs.rename(temporary, target)
    } finally { await fs.rm(temporary, { force: true }) }
  }

  login (id, token) {
    if (!Array.isArray(id) || id.length !== 2 || !id.every(n => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647) || (token !== null && typeof token !== 'string')) return Promise.reject(new ProtocolError('Invalid account credentials'))
    return this.serial(async () => {
      const database = await this.load()
      if (id[0] !== 0 || id[1] !== 0) {
        const account = database.accounts.find(a => a.id[0] === id[0] && a.id[1] === id[1])
        if (!account || !sameToken(token, account.token)) throw new ProtocolError('Invalid account credentials')
        return account
      }
      if (database.nextId > 2147483647) throw new Error('Account ID space exhausted')
      const account = { id: [0, database.nextId++], token: randomBytes(20).toString('hex'), name: 'Player', createdAt: new Date().toISOString(), starter: playerState({ starter: { selectedDeck: 0, nameSet: false, nameChangeCount: -1 } }) }
      database.accounts.push(account)
      await this.save(database)
      return account
    })
  }

  selectDeck (identity, deck) {
    return this.applyStarterTurn(identity, [{ id: 703, fields: { field_0x1c: deck } }])
  }

  findPlayer (id) {
    return this.serial(async () => {
      if (!Array.isArray(id) || id.length !== 2 || !id.every(Number.isInteger)) throw new ProtocolError('Invalid player identity')
      const account = (await this.load()).accounts.find(account => account.id[0] === id[0] && account.id[1] === id[1])
      if (!account) return null
      // Profile responses never include credentials or private gem/gold balances.
      return { id: [...account.id], name: account.name, starter: { ...playerState(account), gold: 0, gems: 0, freeGems: 0 } }
    })
  }

  applyStarterTurn (identity, commands) {
    return this.serial(async () => {
      if (!Array.isArray(commands) || commands.length > 512) throw new ProtocolError('Invalid command count')
      const database = await this.load()
      const index = database.accounts.findIndex(account => account.id[0] === identity?.id?.[0] && account.id[1] === identity?.id?.[1])
      const account = database.accounts[index]
      if (!account || !sameToken(identity.token, account.token)) throw new ProtocolError('Invalid account credentials')
      const next = applyCommands(account, commands)
      if (JSON.stringify(next) !== JSON.stringify(account)) {
        database.accounts[index] = next
        await this.save(database)
      }
      return next
    })
  }
}
module.exports = { AccountStore }
