'use strict'
function writeResource (writer, value = {}) { writer.string(value.file ?? '').string(value.path ?? '').string(value.checksum ?? '') }
function readResource (reader) { return { file: reader.string(), path: reader.string(), checksum: reader.string() } }
function writeEmote (writer, value) {
  writer.long(value.id).bool(value.available).bool(value.defaultOwned)
  writeResource(writer, value.sfx); writeResource(writer, value.sc)
  writer.bool(value.availableForOffer).bool(value.exclusive)
}
function readEmote (reader) {
  return { id: reader.long(), available: reader.bool(), defaultOwned: reader.bool(), sfx: readResource(reader), sc: readResource(reader), availableForOffer: reader.bool(), exclusive: reader.bool() }
}
module.exports = { writeEmote, readEmote }
