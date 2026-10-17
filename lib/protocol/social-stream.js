'use strict'
const { Reader, Writer, ProtocolError } = require('./stream')

// Original clan base 0x683afc, chat 0x64bcf4, stream messages
// 0x1f2524/0x675a0c. Only the recovered text entry type is accepted.
function writeChat (writer, entry) {
  writer.vint(2)
  for (const id of [entry.id, entry.sender, entry.sender]) writer.vint(id[0]).vint(id[1])
  writer.string(entry.name).vint(entry.role).vint(entry.level).vint(entry.age ?? 0)
    .bool(false).bool(false).vint(0).bool(false).long([0, 0]).string(entry.text)
}
function readChat (reader) {
  if (reader.vint() !== 2) throw new ProtocolError('Unsupported clan stream entry')
  const id = [reader.vint(), reader.vint()], sender = [reader.vint(), reader.vint()]
  const home = [reader.vint(), reader.vint()]
  const name = reader.string(), role = reader.vint(), level = reader.vint(), age = reader.vint()
  reader.bool(); reader.bool(); reader.vint(); reader.bool(); reader.long()
  return { id, sender, home, name, role, level, age, text: reader.string() }
}
// Original AvatarStream base 0x1a21bc and clan mail type 3 at 0x2c0d60.
function writeMail (writer, entry) {
  writer.vint(3).long(entry.id).bool(true).long(entry.sender).string(entry.name)
    .vint(entry.age ?? 0).vint(0).bool(false).bool(false).long(entry.clanId)
    .string(entry.text).dataReference(entry.badge).vint(entry.role).string(entry.subject)
    .bool(false).bool(false)
}
function readMail (reader) {
  if (reader.vint() !== 3) throw new ProtocolError('Unsupported avatar stream entry')
  const id = reader.long(), sender = reader.bool() ? reader.long() : null
  const name = reader.string(), age = reader.vint()
  reader.vint(); reader.bool(); reader.bool()
  const clanId = reader.long(), text = reader.string(), badge = reader.dataReference(), role = reader.vint(), subject = reader.string()
  reader.bool()
  if (reader.bool()) reader.long()
  return { id, sender, name, age, clanId, text, badge, role, subject }
}
function encodeSocialStream (id, fields = {}) {
  const writer = new Writer()
  if (id === 21749) writeChat(writer, fields.entry)
  else {
    const entries = fields.entries ?? []
    if (!Array.isArray(entries) || entries.length > 100) throw new ProtocolError('Invalid social stream size')
    writer.array(entries, id === 28299 ? writeMail : writeChat)
    if (id === 21822) writer.vint(0)
  }
  return writer.toBuffer()
}
function decodeSocialStream (id, payload) {
  const reader = new Reader(payload, { maxCollection: 100, maxString: 4096 })
  const fields = id === 21749 ? { entry: readChat(reader) } : { entries: reader.array(id === 28299 ? readMail : readChat, false) }
  if (id === 21822 && reader.vint() !== 0) throw new ProtocolError('Unsupported removed social entries')
  reader.finish()
  return fields
}
module.exports = { encodeSocialStream, decodeSocialStream }
