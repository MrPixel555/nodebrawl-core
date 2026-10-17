'use strict'
const assert = require('node:assert/strict')
const { NativeVM } = require('../server/battle/vm')
const { BattleEngine, battleDefinition } = require('../server/battle/engine')
const { encodeMessage } = require('../lib/protocol/messages')
const { encodeSectorStateEnvelope } = require('../lib/protocol/sector-state')
const fixtures = require('../test/fixtures/native-battle-fixes.json')

async function main () {
  const vm = await NativeVM.create()
  try {
    const definitions = {
      13351: { constructor: 0x5ebdd4, decode: 0x531908, encode: 0x24de20 },
      22871: { constructor: 0x608750, decode: 0x739d3c, encode: 0x57be64 },
    }
    const verify = (id, fields) => {
      const wire = encodeMessage(id, fields), schema = definitions[id], input = vm.stream(wire)
      const message = vm.alloc(0x100)
      vm.call(schema.constructor, message)
      vm.write(message + 0x10, vm.read(input.stream, 0x68))
      vm.call(schema.decode, message)
      assert.equal(vm.integer(message + 0x24), wire.length)
      vm.integer(message + 0x24, 0); vm.integer(message + 0x2c, 0)
      vm.call(schema.encode, message)
      assert.equal(vm.integer(message + 0x24), wire.length)
      assert.deepEqual(vm.read(vm.qword(message + 0x30), wire.length), wire)
    }
    for (const fixture of fixtures) verify(fixture.id, fixture.fields)
    const battle = new BattleEngine(vm, battleDefinition({ training: true, players: [{ id: [0, 123], name: 'Player', deck: require('../server/data/starter-home.json').starter.deckIds }], seed: 42, time: 1600000000 }))
    verify(22871, { field_0x7c: 2, field_0x9c: 0, field_0xa0: 3, field_0xb0: encodeSectorStateEnvelope(battle.snapshot()) })
    console.log('PASS: 9 original LogicEvent/BattleResult fixtures and a real native snapshot in BattleResult decode/re-encode')
  } finally { vm.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
