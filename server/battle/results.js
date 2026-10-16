'use strict'
const { ProtocolError } = require('../../lib/protocol/stream')
const catalogue = require('./catalogue.json')
const { playerState } = require('../starter-state')

function validateBattleHistory (history) {
  if (history === undefined) return []
  if (!Array.isArray(history) || history.length > 1000) throw new ProtocolError('Invalid battle history')
  const ids = new Set()
  for (const row of history) {
    if (!row || !/^[0-9a-f]{32}$/.test(row.id) || ids.has(row.id) || !['training', 'ladder', 'friendly'].includes(row.kind) || !['win', 'loss', 'draw'].includes(row.outcome) || !Number.isInteger(row.crowns) || row.crowns < 0 || row.crowns > 3 || !Number.isInteger(row.gold) || row.gold < 0 || row.gold > 10000 || !Number.isFinite(Date.parse(row.at))) throw new ProtocolError('Invalid battle history record')
    ids.add(row.id)
  }
  return history
}

function applyBattleResult (account, result, now) {
  const history = validateBattleHistory(account.battleHistory)
  if (!result || !/^[0-9a-f]{32}$/.test(result.id) || !['training', 'ladder', 'friendly'].includes(result.kind) || !Number.isInteger(result.slot) || result.slot < 0 || result.slot > 5 || ![-1, 0, 1].includes(result.winner) || !Number.isInteger(result.crowns) || result.crowns < 0 || result.crowns > 3) throw new ProtocolError('Invalid authoritative battle result')
  if (history.some(row => row.id === result.id)) return account
  const arena = catalogue.arenas.find(row => row.id === result.arena)
  if (!arena) throw new ProtocolError('Invalid battle reward arena')
  const outcome = result.winner === -1 ? 'draw' : result.slot % 2 === result.winner ? 'win' : 'loss'
  const state = playerState(account)
  const crowns = result.kind === 'ladder' ? result.crowns : 0
  if (state.passCrowns + crowns > 2147483647) throw new ProtocolError('Season crown limit exceeded')
  const reward = outcome === 'win' && result.kind === 'ladder' ? Number(arena.BattleRewardGold || 0) : 0
  if (!Number.isInteger(reward) || reward < 0 || reward > 10000) throw new ProtocolError('Invalid arena gold reward')
  const gold = Math.min(reward, Math.max(0, 5000000 - state.gold))
  state.gold += gold
  state.passCrowns += crowns
  const row = { id: result.id, kind: result.kind, outcome, crowns: result.crowns, gold, at: new Date(now).toISOString() }
  return { ...account, starter: { ...account.starter, ...state }, battleHistory: [...history.slice(-999), row] }
}

module.exports = { applyBattleResult, validateBattleHistory }
