'use strict'
const { createHash } = require('node:crypto')
function trophyAmount (id) { return 36 + createHash('sha256').update(id).digest().readUInt32BE(0) % 7 }
function historicalStatistics (history) {
  const stats = { trophies: 0, bestTrophies: 0, battles: 0, wins: 0, losses: 0, threeCrownWins: 0 }
  for (const row of Array.isArray(history) ? history : []) {
    if (row?.kind !== 'ladder' || !/^[0-9a-f]{32}$/.test(row.id) || !['win', 'loss', 'draw'].includes(row.outcome)) continue
    stats.battles++
    if (row.outcome === 'win') { stats.wins++; if (row.crowns === 3) stats.threeCrownWins++ }
    if (row.outcome === 'loss') stats.losses++
    const delta = row.outcome === 'draw' ? 0 : row.outcome === 'win' ? trophyAmount(row.id) : -trophyAmount(row.id)
    stats.trophies = Number.isInteger(row.trophies) && row.trophies >= 0 ? row.trophies : Math.max(0, stats.trophies + delta)
    stats.bestTrophies = Math.max(stats.bestTrophies, stats.trophies)
  }
  return stats
}
module.exports = { trophyAmount, historicalStatistics }
