'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { loadBattleRuntime } = require('../server/battle/runtime')

test('installed battle runtime exposes the pinned ARM64 factory', () => {
  assert.equal(typeof loadBattleRuntime(), 'function')
})

for (const failure of ['missing-package', 'old-version', 'missing-arm64', 'invalid-factory']) {
  test(`startup fails before keys/listeners when runtime has ${failure}`, () => {
    const script = `
      const assert = require('node:assert/strict'), Module = require('node:module');
      const fs = require('node:fs/promises'), net = require('node:net');
      for (const method of ['readFile', 'writeFile', 'mkdir']) fs[method] = () => {throw Error('Unexpected filesystem access before runtime validation')};
      net.createServer = () => {throw Error('Unexpected network service before runtime validation')};
      const load = Module._load;
      Module._load = function (id, ...args) {
        if (id === '@alexaltea/unicorn-js/package.json') {
          if (${JSON.stringify(failure)} === 'missing-package') throw Error('MODULE_NOT_FOUND');
          return {version: ${JSON.stringify(failure)} === 'old-version' ? '0.0.0' : '2.1.4'};
        }
        if (id === '@alexaltea/unicorn-js/arm64') {
          if (${JSON.stringify(failure)} === 'missing-arm64') throw Error('ARM64 export missing');
          return {};
        }
        return load.call(this, id, ...args);
      };
      require('./server/main').main().then(() => {process.exitCode=2}).catch(error => {
        assert.equal(error.code, 'BATTLE_RUNTIME_UNAVAILABLE');
        assert.match(error.message, /npm ci/);
        console.log('runtime-rejected');
      });
    `
    const result = spawnSync(process.execPath, ['-e', script], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, HOME_MODE: 'starter', BATTLE_MODE: 'native', TRANSPORT: 'nacl17', TRACE_NETWORK: '0' }, timeout: 10000, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'runtime-rejected')
  })
}
