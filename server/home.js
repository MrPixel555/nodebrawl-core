'use strict'
const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { profile } = require('../lib/protocol/messages')
const { Writer, ProtocolError } = require('../lib/protocol/stream')
const starter = require('./data/starter-home.json')
const { selectedDeck } = require('./starter-state')

// External templates bind fixed-width account IDs explicitly. The starter
// profile below uses typed bindings generated from the native nested codecs.
async function loadHomeTemplate (filename) {
  if (!filename) return null
  const template = JSON.parse(await fs.readFile(filename, 'utf8'))
  if (template.librarySha256 !== profile.library_sha256 || template.messageId !== 21217) throw new Error('Home template does not match this library')
  if (typeof template.payloadHex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(template.payloadHex)) throw new Error('Invalid Home template payload')
  const payload = Buffer.from(template.payloadHex, 'hex')
  if (payload.length > 1048576 || createHash('sha256').update(payload).digest('hex') !== template.payloadSha256) throw new Error('Home template payload checksum mismatch')
  if (!Number.isInteger(template.version) || template.version < 0 || template.version > 65535) throw new Error('Invalid Home template version')
  if (!Array.isArray(template.accountIdOffsets) || template.accountIdOffsets.length < 1) throw new Error('Home template needs explicit account ID bindings')
  const used = new Set()
  for (const offset of template.accountIdOffsets) {
    if (!Number.isInteger(offset) || offset < 0 || offset + 8 > payload.length) throw new Error('Invalid Home account binding')
    for (let n = offset; n < offset + 8; n++) { if (used.has(n)) throw new Error('Overlapping Home account bindings'); used.add(n) }
  }
  return async account => {
    const copy = Buffer.from(payload)
    for (const offset of template.accountIdOffsets) { copy.writeInt32BE(account.id[0], offset); copy.writeInt32BE(account.id[1], offset + 4) }
    return { payload: copy, version: template.version }
  }
}

function createStarterHomeProvider () {
  if (starter.schema !== 1 || starter.librarySha256 !== profile.library_sha256 || starter.messageId !== 21217) throw new Error('Starter Home does not match this library')
  const parts = starter.parts.map(part => part.hex === undefined ? part : { buffer: Buffer.from(part.hex, 'hex') })
  return async account => {
    if (!Array.isArray(account.id) || account.id.length !== 2 || typeof account.name !== 'string' || !account.name || Buffer.byteLength(account.name, 'utf8') > 200) throw new ProtocolError('Invalid starter player identity')
    const writer = new Writer()
    for (const part of parts) {
      if (part.buffer) writer.raw(part.buffer)
      else if (part.field === 'accountId' && part.type === 'long') writer.long(account.id)
      else if (part.field === 'accountId' && part.type === 'vlong') { writer.vint(account.id[0]); writer.vint(account.id[1]) }
      else if (part.field === 'name' && part.type === 'string') writer.string(account.name)
      else if (part.field === 'selectedDeck' && part.type === 'vint') writer.vint(selectedDeck(account))
      else throw new Error('Invalid starter Home binding')
    }
    return { payload: writer.toBuffer(), version: starter.version }
  }
}

async function loadHomeProvider ({ mode, templatePath } = {}) {
  mode = mode || (templatePath ? 'template' : 'disabled')
  if (!['disabled', 'starter', 'template'].includes(mode)) throw new Error('Invalid HOME_MODE; use disabled, starter or template')
  if (mode !== 'template' && templatePath) throw new Error('HOME_TEMPLATE_PATH requires HOME_MODE=template')
  if (mode === 'template' && !templatePath) throw new Error('HOME_MODE=template requires HOME_TEMPLATE_PATH')
  if (mode === 'starter') return createStarterHomeProvider()
  return mode === 'template' ? loadHomeTemplate(templatePath) : null
}

module.exports = { loadHomeTemplate, createStarterHomeProvider, loadHomeProvider }
