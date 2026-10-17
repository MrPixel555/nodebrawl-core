'use strict'
const expectedVersion = require('../../package.json').dependencies['@alexaltea/unicorn-js']

function loadBattleRuntime () {
  try {
    const installed = require('@alexaltea/unicorn-js/package.json').version
    if (installed !== expectedVersion) throw Error(`Installed version ${installed}; expected ${expectedVersion}`)
    const factory = require('@alexaltea/unicorn-js/arm64')
    if (typeof factory !== 'function') throw Error('The ARM64 module does not export a runtime factory')
    return factory
  } catch (cause) {
    const error = new Error(`Native battle runtime unavailable. In this server directory run "npm ci", then restart "npm start". Required: @alexaltea/unicorn-js@${expectedVersion} with ARM64 support. Detail: ${cause.message.split('\n')[0]}`, { cause })
    error.code = 'BATTLE_RUNTIME_UNAVAILABLE'
    throw error
  }
}

module.exports = { loadBattleRuntime }
