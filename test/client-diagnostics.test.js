'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { selectLogs, collect, captureLive } = require('../tools/client/diagnose')

const started = '10-17 20:00:00.000 1298 1298 I ActivityManager: Start proc 1234:com.supercell.clashroyale/u0a58 for activity'
const load = '10-17 20:00:00.100 1234 1234 D linker: loading /data/app/com.supercell.clashroyale-ab/lib/arm64/libg.so'
const failure = '10-17 20:00:00.200 1234 1234 E AndroidRuntime: java.lang.UnsatisfiedLinkError: dlopen failed'

test('game load and failure survive thousands of later foreign linker lines', () => {
  const noise = Array.from({ length: 8000 }, (_, n) => `10-17 20:00:01.000 ${9000 + n} ${9000 + n} D linker: loading adb command libc.so`)
  const result = selectLogs([started, load, failure, ...noise].join('\n'))
  assert.deepEqual(result.logs, [started, load, failure])
  assert.deepEqual(result.capture.applicationPids, ['1234'])
  assert.equal(result.capture.sourceLines, 8003)
  assert.equal(result.capture.libraryLoadSeen, true)
  assert.equal(result.capture.failureSeen, true)
})

test('target process details are not cut at the previous 2000-line boundary', () => {
  const details = Array.from({ length: 4000 }, (_, n) => `10-17 20:00:00.150 1234 1234 D linker: application detail ${n}`)
  const result = selectLogs([started, load, failure, ...details].join('\n'))
  assert.equal(result.logs.length, 4003)
  assert.ok(result.logs.includes(failure))
})

test('metadata command chatter does not manufacture evidence of a game launch', () => {
  const chatter = [
    '10-17 20:00:01.000 9001 9001 D linker: loading libc.so',
    '10-17 20:00:01.000 1447 1812 W NewFileUpdater: retrying com.supercell.clashroyale',
  ]
  const result = selectLogs(chatter.join('\n'))
  assert.deepEqual(result.logs, [])
  assert.equal(result.capture.libraryLoadSeen, false)
  assert.equal(result.capture.failureSeen, false)
})

test('an unrelated application crash is kept without claiming the game failed', () => {
  const unrelated = '10-17 20:00:01.000 9001 9001 E AndroidRuntime: FATAL EXCEPTION: unrelated application'
  const result = selectLogs([started, load, unrelated].join('\n'))
  assert.ok(result.logs.includes(unrelated))
  assert.equal(result.capture.libraryLoadSeen, true)
  assert.equal(result.capture.failureSeen, false)
})

test('snapshot is captured before any getprop, dumpsys or APK pull', async () => {
  const calls = []
  const run = async (...args) => {
    calls.push(args)
    return args[0] === 'logcat' ? [started, load, failure].join('\n') : ''
  }
  const { report, raw } = await collect(run, () => assert.fail('snapshot must not launch'), false)
  assert.equal(calls[0][0], 'logcat')
  assert.deepEqual(calls[0].slice(1), ['-d', '-b', 'all', '-v', 'threadtime', '-t', '60000'])
  assert.ok(report.logs.includes(failure))
  assert.equal(report.logCapture.mode, 'snapshot-before-metadata')
  assert.ok(raw.includes(load))
  assert.ok(report.errors.some(value => value.includes('base APK path')))
  assert.equal(calls.some(value => value.includes('force-stop')), false)
})

test('live capture is retained even when later device metadata requests fail', async () => {
  let captured = false
  const run = async () => { assert.equal(captured, true); throw new Error('device metadata unavailable') }
  const live = async () => { captured = true; return { text: [started, load, failure].join('\n'), truncated: false, launchOutput: 'app exited' } }
  const { report } = await collect(run, live, true)
  assert.ok(report.logs.includes(failure))
  assert.equal(report.logCapture.mode, 'live-relaunch')
  assert.equal(report.launchOutput, 'app exited')
  assert.ok(report.errors.length > 0)
})

test('live child stream drains while asynchronous launch commands run', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'client-live-log-test-'))
  try {
    const fixture = path.join(directory, 'fake-adb.js')
    fs.writeFileSync(fixture, 'process.stdout.write(' + JSON.stringify([started, load, failure].join('\n') + '\n') + '); setInterval(() => {}, 1000)\n')
    const commands = []
    const run = async (...args) => { commands.push(args); return 'launch attempted' }
    const result = await captureLive(process.execPath, [fixture], run)
    assert.ok(result.text.includes(failure))
    assert.deepEqual(commands, [
      ['shell', 'am', 'force-stop', 'com.supercell.clashroyale'],
      ['shell', 'am', 'start', '-W', '-n', 'com.supercell.clashroyale/.GameApp'],
    ])
    assert.equal(result.launchOutput, 'launch attempted')
    assert.equal(result.truncated, false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('live capture reports missing adb without leaving a child process', async () => {
  await assert.rejects(captureLive(path.join(os.tmpdir(), 'missing-adb-binary'), [], async () => ''), /ENOENT/)
})
