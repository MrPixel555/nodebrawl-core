'use strict'
const { profile, schemaFor } = require('../lib/protocol/messages')
const { commandCatalog } = require('../lib/protocol/commands')
const messages = profile.messages.map(entry => {
  let schema = null
  try { schema = schemaFor(entry.id) } catch (_) {}
  return { id: entry.id, name: entry.id === 13597 ? 'EndClientTurn' : entry.name, codec: schema !== null, fields: schema, nativeEncode: entry.encode, nativeDecode: entry.decode, factoryObservations: entry.factoryObservations }
})
const commands = [...commandCatalog.values()]
if (process.argv.includes('--json')) console.log(JSON.stringify({ librarySha256: profile.library_sha256, messages, commands }, null, 2))
else if (process.argv.includes('--commands')) {
  console.log(`${commands.length} native command types; ${commands.filter(command => command.fields !== null).length} verified codecs; only 703 SelectDeck has a starter handler`)
  for (const command of commands) console.log(`${command.id}\t${command.fields === null ? 'unresolved' : 'codec'}\t${command.fields?.map(field => field.type).join(',') || ''}`)
}
else {
  console.log(`Library: ${profile.library_sha256}`)
  console.log(`${messages.length} discovered message IDs; ${messages.filter(m => m.codec).length} implemented wire codecs`)
  console.log('Wire codecs do not imply that gameplay handlers are implemented.')
  for (const message of messages) console.log(`${message.id}\t${message.name}\t${message.codec ? 'codec' : 'unresolved'}\t${message.fields?.map(f => f.type).join(',') || ''}`)
}
