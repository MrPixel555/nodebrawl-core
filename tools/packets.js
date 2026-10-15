'use strict'
const { profile, schemaFor } = require('../lib/protocol/messages')
const { commandCatalog } = require('../lib/protocol/commands')
const recoveredNames = { 10453: 'CreateAlliance', 13882: 'ChangeAllianceSettings', 16592: 'SearchAlliances', 25074: 'AllianceSearchResult', 13597: 'EndClientTurn', 12405: 'HomeLogicStopped', 17967: 'TrainingNpcRequest', 10953: 'TrainingModeNpcRequest', 12373: 'PlayerProfileRequest', 22757: 'PlayerProfile', 26360: 'PlayerProfileFailed' }
const runtime = { 10100: 'hello', 10101: 'login', 10108: 'heartbeat', 10459: 'metadata receipt and bounded content diagnostics', 11485: 'startup receipt', 13752: 'network report receipt', 13597: 'starter commands 563/703/805 and initial naming 948', 12373: 'persisted starter player profile lookup', 16592: 'empty clan name search', 20100: 'hello response', 20103: 'login failure', 20108: 'heartbeat response', 20758: 'login success and content URL vectors', 21217: 'persistent starter Home provider', 22757: 'native starter profile provider; general codec unresolved', 26360: 'absent player response', 25074: 'empty clan search result' }
const messages = profile.messages.map(entry => {
  let schema = null
  try { schema = schemaFor(entry.id) } catch (_) {}
  return { id: entry.id, name: recoveredNames[entry.id] || entry.name, codec: schema !== null, runtimeSupport: runtime[entry.id] || null, fields: schema, nativeEncode: entry.encode, nativeDecode: entry.decode, factoryObservations: entry.factoryObservations }
})
const commands = [...commandCatalog.values()]
if (process.argv.includes('--json')) console.log(JSON.stringify({ librarySha256: profile.library_sha256, messages, commands }, null, 2))
else if (process.argv.includes('--commands')) {
  console.log(`${commands.length} native command types; ${commands.filter(command => command.fields !== null).length} verified codecs; starter handlers: 563 deck contents, 703 deck selection, unchanged level synchronization 805 and initial naming 948`)
  for (const command of commands) console.log(`${command.id}\t${command.fields === null ? 'unresolved' : 'codec'}\t${command.fields?.map(field => field.type).join(',') || ''}`)
}
else {
  console.log(`Library: ${profile.library_sha256}`)
  console.log(`${messages.length} discovered message IDs; ${messages.filter(m => m.codec).length} implemented wire codecs`)
  console.log('Wire codecs do not imply that gameplay handlers are implemented.')
  for (const message of messages) console.log(`${message.id}\t${message.name}\t${message.codec ? 'codec' : 'unresolved'}\t${message.fields?.map(f => f.type).join(',') || ''}`)
}
