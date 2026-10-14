'use strict'
const { profile, schemaFor } = require('../lib/protocol/messages')
const messages = profile.messages.map(entry => {
  let schema = null
  try { schema = schemaFor(entry.id) } catch (_) {}
  return { id: entry.id, name: entry.name, codec: schema !== null, fields: schema, nativeEncode: entry.encode, nativeDecode: entry.decode, factoryObservations: entry.factoryObservations }
})
if (process.argv.includes('--json')) console.log(JSON.stringify({ librarySha256: profile.library_sha256, messages }, null, 2))
else {
  console.log(`Library: ${profile.library_sha256}`)
  console.log(`${messages.length} discovered message IDs; ${messages.filter(m => m.codec).length} implemented wire codecs`)
  console.log('Wire codecs do not imply that gameplay handlers are implemented.')
  for (const message of messages) console.log(`${message.id}\t${message.name}\t${message.codec ? 'codec' : 'unresolved'}\t${message.fields?.map(f => f.type).join(',') || ''}`)
}
