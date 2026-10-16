'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const { BattleEngine } = require('./engine')
const { ProtocolError } = require('../../lib/protocol/stream')

async function run () {
  const engine = await BattleEngine.create(workerData)
  const snapshots = workerData.players.map((_, slot) => engine.snapshot(slot))
  parentPort.postMessage({ ready: true, snapshots, status: engine.status(), location: engine.definition.location.id })
  parentPort.on('message', ({ id, action, slot, command, ticks }) => {
    try {
      let result
      if (action === 'input') result = engine.queue(slot, command)
      else if (action === 'snapshot') result = { snapshot: engine.snapshot(slot), status: engine.status(), pendingCommands: engine.pending.map(input => input.command) }
      else if (action === 'advance') {
        if (engine.tick % 40 === 0) engine.definition.roster.forEach((player, i) => { if (player.bot) engine.botInput(i) })
        result = { ...engine.step(ticks), commands: engine.drainCommands() }
      } else if (action === 'forfeit') {
        if (!Number.isInteger(slot) || slot < 0 || slot >= engine.definition.roster.length) throw Error('Invalid forfeit slot')
        // 31c3f8 takes a LogicClientAvatar from GameMode, rather than the
        // world's LogicPlayer. Passing the latter incorrectly awards its team.
        if (!engine.ended) engine.vm.call(0x31c3f8, engine.world, engine.vm.qword(engine.game + 0xd0 + (slot % 2) * 8))
        result = { ...engine.status(), commands: engine.drainCommands() }
      } else throw Error('Unknown battle worker operation')
      parentPort.postMessage({ id, result })
    } catch (error) {
      // Protocol rejections are per-input; an unexpected native failure poisons
      // this VM. The host disposes it instead of continuing a partial mutation.
      parentPort.postMessage({ id, error: error.message, fatal: !(error instanceof ProtocolError) })
      if (!(error instanceof ProtocolError)) { engine.close(); parentPort.close() }
    }
  })
}

run().catch(error => { parentPort.postMessage({ startupError: error.message }); parentPort.close() })
