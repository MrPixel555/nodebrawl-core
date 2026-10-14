'use strict'
const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { profile } = require('../lib/protocol/messages')

// Nested Home data still requires the matching game assets and schema.
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
module.exports = { loadHomeTemplate }
