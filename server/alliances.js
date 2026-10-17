'use strict'
const { ProtocolError } = require('../lib/protocol/stream')
const catalogue = require('./data/alliance-catalogue.json')
const { playerState } = require('./starter-state')

const equalId = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 2 && b.length === 2 && a.every((value, index) => value === b[index])
function text (value, limit, empty = false) {
  return typeof value === 'string' && (empty || !!value.trim()) && Buffer.byteLength(value, 'utf8') <= limit && ![...value].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)
}
function reference (value, kind, rows, nullable = false) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isInteger) && ((nullable && value[0] === 0 && value[1] === 0) || (value[0] === kind && value[1] >= 0 && value[1] < rows.length))
}
function validateAlliances (database) {
  database.alliances ??= []
  database.nextAllianceId ??= 1
  if (!Array.isArray(database.alliances) || !Number.isInteger(database.nextAllianceId) || database.nextAllianceId < 1 || database.nextAllianceId > 2147483648) throw Error('Invalid clan database')
  const ids = new Set()
  for (const clan of database.alliances) {
    if (!equalId(clan.id, [0, clan.id?.[1]]) || !Number.isInteger(clan.id[1]) || clan.id[1] < 1 || clan.id[1] >= database.nextAllianceId || ids.has(clan.id[1]) || !text(clan.name, 60) || !text(clan.description, 560, true) || !reference(clan.badge, 16, catalogue.alliance_badges) || !reference(clan.region, 57, catalogue.regions, true) || ![1, 2, 3].includes(clan.type) || !Number.isInteger(clan.requiredScore) || clan.requiredScore < 0 || clan.requiredScore > 100000) throw Error('Invalid clan database')
    ids.add(clan.id[1])
  }
  for (const account of database.accounts) { if (account.alliance) {
    const clan = database.alliances.find(clan => equalId(clan.id, account.alliance.id))
    if (!clan || account.alliance.name !== clan.name || !equalId(account.alliance.badge, clan.badge) || ![1, 2, 3, 4].includes(account.alliance.role) || account.alliance.level !== 0) throw Error('Invalid clan membership')
  } }
}
function createAlliance (database, account, fields) {
  if (account.alliance) throw new ProtocolError('Player already belongs to a clan')
  if (!text(fields.field_0x80, 60) || !text(fields.field_0x88, 560, true) || !reference(fields.field_0x90, 16, catalogue.alliance_badges) || !reference(fields.field_0x98, 57, catalogue.regions, true) || ![1, 2, 3].includes(fields.field_0xa0) || !Number.isInteger(fields.field_0xa4) || fields.field_0xa4 < 0 || fields.field_0xa4 > 100000) throw new ProtocolError('Invalid clan creation settings')
  const state = playerState(account)
  if (state.gold < catalogue.createCost) throw new ProtocolError('Clan creation requires 1000 gold')
  if (database.nextAllianceId > 2147483647) throw Error('Clan ID space exhausted')
  const clan = { id: [0, database.nextAllianceId++], name: fields.field_0x80.trim(), description: fields.field_0x88, badge: [...fields.field_0x90], region: [...fields.field_0x98], type: fields.field_0xa0, requiredScore: fields.field_0xa4 }
  const gold = state.gold - catalogue.createCost
  // Native Gold debit (0x6466f4) also caps the FreeGold sub-balance at Gold.
  account.starter = { ...state, gold, freeGold: Math.min(state.freeGold, gold) }
  account.alliance = { id: [...clan.id], name: clan.name, badge: [...clan.badge], role: 2, level: 0 }
  database.alliances.push(clan)
  return clan
}
function clanData (database, clan) {
  const members = database.accounts.filter(account => equalId(account.alliance?.id, clan.id))
  return {
    header: { field_0x0: clan.id, field_0x8: clan.name, field_0x10: clan.badge, field_0x18: clan.type, field_0x1c: members.length, field_0x24: clan.requiredScore, field_0x50: clan.region },
    description: clan.description,
    members: members.map((account, index) => ({ field_0x10: account.id, field_0x8: account.id, field_0x20: account.name, field_0x48: [54, 1], field_0x28: account.alliance.role, field_0x2c: 1, field_0x30: 0, field_0x3c: index + 1, field_0x40: index + 1 })),
  }
}

module.exports = { equalId, validateAlliances, createAlliance, clanData }
