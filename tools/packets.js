'use strict'
const { profile, schemaFor } = require('../lib/protocol/messages')
const { commandCatalog } = require('../lib/protocol/commands')
const recoveredNames = { 11712: 'AvatarStreamRequest', 28299: 'AvatarStream', 10453: 'CreateAlliance', 13882: 'ChangeAllianceSettings', 16592: 'CheckName', 20821: 'CheckNameResult', 25074: 'AllianceSearchResult', 14783: 'AdvancedAllianceSearch', 24184: 'AdvancedAllianceSearchResult', 16442: 'ServerFriendsRequest', 21047: 'ServerFriends', 13597: 'EndClientTurn', 12405: 'HomeLogicStopped', 17967: 'TrainingNpcRequest', 10953: 'TrainingModeNpcRequest', 12373: 'PlayerProfileRequest', 22757: 'PlayerProfile', 26360: 'PlayerProfileFailed', 28991: 'DeferredGameModeSnapshot', 15263: 'GameModeSnapshotAck' }
const runtime = { 11712: 'authenticated self AvatarStream request', 28299: 'only allocated empty AvatarStream supported; nonempty entry codecs unresolved', 10100: 'hello', 10101: 'login', 10108: 'heartbeat', 10459: 'metadata receipt and bounded content diagnostics', 11485: 'startup receipt', 13752: 'network report receipt', 13597: 'commands 563/693/703/805, initial naming 948, gold packs 687, Arena1 boost branch 595 and free tier-zero pass gold 836 and Home flags 869', 12373: 'persisted starter player profile lookup', 16592: 'name preflight; no account mutation', 20821: 'name check result; false flag accepts candidate', 14783: 'empty advanced clan search', 24184: 'advanced clan search result', 16442: 'empty server-friend list prefetch', 21047: 'only type-zero empty list supported; general friend codec unresolved', 20100: 'hello response', 20103: 'login failure', 20108: 'heartbeat response', 20758: 'login success and content URL vectors', 21217: 'persistent Home with 95 unlocked cards, card order and free pass claim', 22757: 'native starter profile provider; general codec unresolved', 26360: 'absent player response' }
const commandSupport = { 563: 'eight owned deck cards; foreign operations unsupported', 595: 'only Arena1 ChestSpeedUp reference [54,1], false flag', 687: 'three gold resource packs from table 55', 693: 'manual active-card swap or indexed inventory replacement', 703: 'select one of five persisted decks', 805: 'unchanged level-one synchronization only', 836: 'free tier 0, current pass, non-premium: 500 gold, cap and persistent claim', 869: 'set one of Home flag bits 1..4', 948: 'initial free naming only; later renames unsupported' }
const messages = profile.messages.map(entry => {
  let schema = null
  try { schema = schemaFor(entry.id) } catch (_) {}
  const result = { id: entry.id, name: recoveredNames[entry.id] || entry.name, codec: schema !== null, runtimeSupport: runtime[entry.id] || null, fields: schema, nativeEncode: entry.encode, nativeDecode: entry.decode, factoryObservations: entry.factoryObservations }
  if (entry.id === 28991) result.envelopeSupport = 'verified raw/zlib envelope; inner GameMode snapshot unresolved; no runtime battle handler'
  return result
})
const commands = [...commandCatalog.values()].map(command => ({ ...command, runtimeSupport: commandSupport[command.id] || null }))
if (process.argv.includes('--json')) console.log(JSON.stringify({ librarySha256: profile.library_sha256, messages, commands }, null, 2))
else if (process.argv.includes('--matrix')) {
  console.log('# Complete message and command implementation matrix\n')
  console.log('Every catalogued type is listed, including unresolved codecs and absent handlers. Runtime support below is the starter configuration and may cover only the stated branch. Factory creation, wire codecs and gameplay are separate checks.\n')
  console.log('| Message | Name | Wire codec | Runtime support |\n| --- | --- | --- | --- |')
  for (const message of messages) console.log(`| ${message.id} | ${message.name} | ${message.codec ? 'verified' : 'unresolved'} | ${message.runtimeSupport || 'not implemented'} |`)
  console.log('\n| Command | Native executor | Wire codec | Runtime support |\n| --- | --- | --- | --- |')
  for (const command of commands) console.log(`| ${command.id} | ${command.execute} | ${command.fields !== null ? 'verified' : 'unresolved'} | ${command.runtimeSupport || 'not implemented'} |`)
}
else if (process.argv.includes('--commands')) {
  console.log(`${commands.length} native command types; ${commands.filter(command => command.fields !== null).length} verified codecs; handlers: 563 deck contents, 687 gold packs, 693 manual card swaps, 703 deck selection, unchanged level synchronization 805, initial naming 948, Arena1 boost branch 595 and free tier-zero pass gold 836 and Home flags 869`)
  for (const command of commands) console.log(`${command.id}\t${command.fields === null ? 'unresolved' : 'codec'}\t${command.fields?.map(field => field.type).join(',') || ''}`)
}
else {
  console.log(`Library: ${profile.library_sha256}`)
  console.log(`${messages.length} discovered message IDs; ${messages.filter(m => m.codec).length} implemented wire codecs`)
  console.log('Wire codecs do not imply that gameplay handlers are implemented.')
  for (const message of messages) console.log(`${message.id}\t${message.name}\t${message.codec ? 'codec' : 'unresolved'}\t${message.fields?.map(f => f.type).join(',') || ''}`)
}
