'use strict'
const modes = require('./battle/catalogue.json').modes

const entries = [
  { id: 1002, name: '2v2', modeName: 'TeamVsTeamLadder' },
  { id: 1001, name: 'Double Elixir', modeName: 'DoubleElixir' },
].map(entry => ({ ...entry, mode: modes.find(mode => mode.Name === entry.modeName && mode.ValidPartyMode === 'true') }))
if (entries.some(entry => !entry.mode)) throw Error('Party source modes are missing')

function partyCatalogue (enabled = true) {
  return {
    revision: enabled ? 1 : -1,
    events: enabled
      ? entries.map(entry => ({
        id: entry.id,
        versionId: 1,
        variantId: 0,
        name: entry.name,
        category: 20,
        startTime: 1600000000,
        endTime: 2140000000,
        visibleTime: 1600000000,
        visibleEndTime: 2140000000,
        startNotificationTid: '',
        endNotificationTid: '',
        eventName: entry.modeName,
        json: JSON.stringify({ GameMode: entry.modeName }),
        targetingId: 0,
        personallyTargeted: false,
        schedulingType: 0,
        eventGroupId: 0,
        eventTopGroupId: 0,
        impressionId: entry.id,
      }))
      : [],
  }
}

function partyMode (fields) {
  if (![0, 2].includes(fields.field_0x20)) return null
  return entries.find(entry => entry.id === fields.field_0x24)?.mode || null
}

module.exports = { partyCatalogue, partyMode }
