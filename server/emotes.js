'use strict'
const { Writer, ProtocolError } = require('../lib/protocol/stream')
const { writeEmote } = require('../lib/protocol/emotes')
const fingerprint = require('../content/fingerprint.json').sha
// These two exports exist in the supplied APK's verified SC files. Their
// checksums are the MD5 of the decoded SC stream, as stored in each SC header.
// Private pack IDs avoid asserting unknown historical official pack mappings.
const definitions = [
  { id: [10001, 0], file: 'ui.sc', checksum: '8328251af75aa0ccc1fc8d855b485cee' },
  { id: [10002, 0], file: 'season_3_legendary_dl.sc', checksum: 'dec76341b23995eeb4797d0618cb9e94' },
].map(entry => ({ ...entry, available: true, defaultOwned: true, sfx: {}, sc: { file: entry.file, path: `/${fingerprint}/sc/${entry.file}`, checksum: entry.checksum }, availableForOffer: false, exclusive: false }))
const defaultDeck = [...definitions.map(entry => entry.id), ...Array.from({ length: 6 }, () => [0, 0])]
function validateEmoteDeck (deck) {
  if (!Array.isArray(deck) || deck.length !== 8 || deck.some(id => !Array.isArray(id) || id.length !== 2 || !id.every(Number.isInteger) || !(id.every(n => n === 0) || definitions.some(entry => entry.id.every((n, i) => n === id[i]))))) throw new ProtocolError('Invalid owned emote deck')
}
function writeEmotes (writer, deck = defaultDeck) {
  validateEmoteDeck(deck)
  writer.vint(definitions.length)
  for (const entry of definitions) writeEmote(writer, entry)
  writer.vint(0).vint(definitions.length)
  for (const entry of definitions) writer.long(entry.id)
  for (const id of deck) writer.long(id)
  writer.vint(0).vint(0).vint(0).vint(0).vint(0)
}
function encodeEmotes (deck) { const writer = new Writer(); writeEmotes(writer, deck); return writer.toBuffer() }
function battleEmotes (deck = defaultDeck) {
  validateEmoteDeck(deck)
  const resource = value => ({ File: value.file || '', Path: value.path || '', Checksum: value.checksum || '' })
  return {
    oe: definitions.map(entry => entry.id[0] * 4294967296 + entry.id[1]),
    de: deck.map(id => ({ p: id[0], e: id[1] })),
    abe: definitions.map(entry => ({ Index_hi: entry.id[0], Index_lo: entry.id[1], Available: true, DefaultOwned: true, Sfx: resource(entry.sfx), ScFile: resource(entry.sc), AvailableForOffer: false, Exclusive: false })),
  }
}
module.exports = { definitions, defaultDeck, validateEmoteDeck, writeEmotes, encodeEmotes, battleEmotes }
