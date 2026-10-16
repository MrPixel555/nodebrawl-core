'use strict'
const { Reader, Writer, ProtocolError } = require('./stream')

// Home+0x650: 0x543f70 -> 0x181040 -> 0x1c49dc/0x19a968.
// Fixed-table references here are a single index+1 VInt, including zero for
// null. They are not the two-VInt dynamic dataReference format.
function readPassState (reader) {
  return {
    crowns: reader.vint(),
    freeClaimedCrowns: reader.vint(),
    premiumClaimedCrowns: reader.vint(),
    flag: reader.bool(),
    arenaIndex: reader.vint(),
    seenCrowns: reader.vint(),
    identities: reader.array(r => r.long(), false),
  }
}

function writePassState (writer, state) {
  collection(state.identities)
  writer.vint(state.crowns).vint(state.freeClaimedCrowns).vint(state.premiumClaimedCrowns)
    .bool(state.flag).vint(state.arenaIndex).vint(state.seenCrowns)
    .array(state.identities, (w, identity) => w.long(identity))
}

function readRewardSlot (reader) {
  const slot = { seasonId: reader.vint(), index: reader.vint() }
  slot.arena = reader.bool()
    ? { threshold: reader.vint(), field_0xc: reader.vint(), field_0x8: reader.vint(), field_0x14: reader.vint() }
    : null
  slot.pass = reader.bool() ? readPassState(reader) : null
  return slot
}

function writeRewardSlot (writer, slot) {
  writer.vint(slot.seasonId).vint(slot.index).bool(slot.arena !== null)
  if (slot.arena !== null) writer.vint(slot.arena.threshold).vint(slot.arena.field_0xc).vint(slot.arena.field_0x8).vint(slot.arena.field_0x14)
  writer.bool(slot.pass !== null)
  if (slot.pass !== null) writePassState(writer, slot.pass)
}

function decodeRewardManager (payload) {
  const reader = new Reader(payload, { maxCollection: 1000 })
  const manager = {
    field_0x20: reader.vint(),
    field_0x28: reader.vint(),
    field_0x24: reader.vint(),
    field_0x2c: reader.vint(),
    slots: reader.array(readRewardSlot, false),
  }
  reader.finish()
  return manager
}

function encodeRewardManager (manager) {
  collection(manager.slots)
  return new Writer().vint(manager.field_0x20).vint(manager.field_0x28).vint(manager.field_0x24).vint(manager.field_0x2c)
    .array(manager.slots, writeRewardSlot).toBuffer()
}

function collection (value) {
  if (!Array.isArray(value) || value.length > 1000) throw new ProtocolError('Invalid reward manager collection')
}

module.exports = { decodeRewardManager, encodeRewardManager }
