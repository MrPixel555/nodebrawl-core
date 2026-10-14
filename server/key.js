'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { keyPair } = require('../lib/protocol/salsa17')

async function loadServerKey (filename) {
  const read = async () => {
    const data = JSON.parse(await fs.readFile(filename, 'utf8'))
    if (data.schema !== 1 || typeof data.secret !== 'string' || !/^[a-f0-9]{64}$/.test(data.secret)) throw new Error('Invalid server key file')
    return Buffer.from(data.secret, 'hex')
  }
  try { return await read() } catch (error) { if (error.code !== 'ENOENT') throw error }
  await fs.mkdir(path.dirname(path.resolve(filename)), { recursive: true })
  const secret = randomBytes(32)
  const temporary = `${filename}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify({ schema: 1, secret: secret.toString('hex') }) + '\n', { mode: 0o600, flag: 'wx' })
    try { await fs.link(temporary, filename) } catch (error) { if (error.code !== 'EEXIST') throw error }
  } finally { secret.fill(0); await fs.rm(temporary, { force: true }) }
  return read()
}
module.exports = { loadServerKey, publicKey: secret => keyPair(secret).publicKey }
