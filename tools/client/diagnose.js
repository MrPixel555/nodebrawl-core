'use strict'
// No install, app-data reset or Frida. --launch explicitly restarts only the game.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { inflateRawSync } = require('node:zlib')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const PACKAGE = 'com.supercell.clashroyale'

function zipEntry (apk, wanted) {
  let end = -1
  for (let at = apk.length - 22; at >= Math.max(0, apk.length - 65557); at--) {
    if (apk.readUInt32LE(at) === 0x06054b50 && at + 22 + apk.readUInt16LE(at + 20) === apk.length) { end = at; break }
  }
  if (end < 0) throw new Error('APK ZIP directory not found')
  let at = apk.readUInt32LE(end + 16)
  for (let n = 0; n < apk.readUInt16LE(end + 10); n++) {
    if (apk.readUInt32LE(at) !== 0x02014b50) throw new Error('Invalid APK ZIP directory')
    const length = apk.readUInt16LE(at + 28)
    const name = apk.subarray(at + 46, at + 46 + length).toString('utf8')
    if (name === wanted) {
      const method = apk.readUInt16LE(at + 10)
      const size = apk.readUInt32LE(at + 24)
      const compressed = apk.readUInt32LE(at + 20)
      const offset = apk.readUInt32LE(at + 42)
      if (size > 32 * 1024 * 1024 || compressed > 32 * 1024 * 1024 || apk.readUInt32LE(offset) !== 0x04034b50) throw new Error('Unsupported APK entry size/header')
      const start = offset + 30 + apk.readUInt16LE(offset + 26) + apk.readUInt16LE(offset + 28)
      const input = apk.subarray(start, start + compressed)
      const data = method === 0 ? input : method === 8 ? inflateRawSync(input, { maxOutputLength: 32 * 1024 * 1024 }) : null
      if (!data || data.length !== size) throw new Error('Unsupported or truncated APK entry')
      return data
    }
    at += 46 + length + apk.readUInt16LE(at + 30) + apk.readUInt16LE(at + 32)
  }
  throw new Error('APK entry not found: ' + wanted)
}

function sha (value) { return createHash('sha256').update(value).digest('hex') }

function selectLogs (text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const pids = new Set()
  const parsed = lines.map(line => {
    const match = line.match(/^\d\d-\d\d\s+\S+\s+(\d+)\s+\d+\s+[VDIWEFA]\s+(\S+)\s*:\s*(.*)$/)
    return { line, pid: match?.[1], tag: match?.[2] ?? '', message: match?.[3] ?? line }
  })
  for (const row of parsed) {
    const announced = row.message.match(/Start proc (\d+):com\.supercell\.clashroyale(?:[\s/]|$)/) ??
      row.message.match(/Process:\s*com\.supercell\.clashroyale,\s*PID:\s*(\d+)/) ??
      row.message.match(/pid:\s*(\d+).*>>> com\.supercell\.clashroyale <<</)
    if (announced) pids.add(announced[1])
    if (/^(linker|AndroidRuntime|DEBUG|libnb|houdini)$/.test(row.tag) && row.message.includes(PACKAGE)) pids.add(row.pid)
  }
  pids.delete(undefined)
  const selected = parsed.filter(row => pids.has(row.pid) ||
    /UnsatisfiedLinkError|FATAL EXCEPTION|Fatal signal|Abort message|dlopen failed|cannot locate symbol/i.test(row.message) ||
    /houdini|native.?bridge|^libnb$|^DEBUG$/.test(row.tag) ||
    (row.message.includes(PACKAGE) && !/NewFileUpdater|clipboard|Proxy:/.test(row.line)))
  return {
    logs: selected.map(row => row.line),
    capture: {
      sourceLines: lines.length,
      selectedLines: selected.length,
      applicationPids: [...pids],
      libraryLoadSeen: selected.some(row => pids.has(row.pid) && /libg\.so|loadLibrary.*\bg\b/.test(row.message)),
      failureSeen: selected.some(row => pids.has(row.pid) && /UnsatisfiedLinkError|FATAL EXCEPTION|Fatal signal|Abort message|dlopen failed|cannot locate symbol/i.test(row.message)),
    },
  }
}

async function captureLive (adb, prefix, run) {
  const child = spawn(adb, [...prefix, 'logcat', '-b', 'all', '-v', 'threadtime', '-T', '1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks = []
  let size = 0
  let truncated = false
  let streamError = ''
  child.stdout.on('data', value => {
    if (size + value.length <= 64 * 1024 * 1024) { chunks.push(value); size += value.length } else { truncated = true }
  })
  child.stderr.on('data', value => { streamError = (streamError + value.toString()).slice(-4096) })
  let ended = false
  const closed = new Promise(resolve => child.once('close', code => { ended = true; resolve(code) }))
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    // Start draining logcat before starting the game. Async ADB commands keep
    // this pipe flowing even while am start -W waits for a dying process.
    await new Promise(resolve => setTimeout(resolve, 300))
    if (ended) throw new Error('Live logcat exited: ' + streamError)
    await run('shell', 'am', 'force-stop', PACKAGE)
    let launchOutput
    try { launchOutput = await run('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.GameApp') } catch (error) { launchOutput = error.message }
    await new Promise(resolve => setTimeout(resolve, 2500))
    if (ended) throw new Error('Live logcat exited: ' + streamError)
    return { text: Buffer.concat(chunks).toString('utf8'), truncated, launchOutput }
  } finally {
    if (!ended) child.kill()
    await closed
  }
}

async function collect (run, live, launch) {
  const report = { schema: 2, timeUtc: new Date().toISOString(), properties: {}, errors: [] }
  // Capture first: getprop/dumpsys/pm/pull themselves flood MuMu linker logs.
  const captured = launch ? await live() : { text: await run('logcat', '-d', '-b', 'all', '-v', 'threadtime', '-t', '60000'), truncated: false }
  const selected = selectLogs(captured.text)
  report.logs = selected.logs
  report.logCapture = { ...selected.capture, mode: launch ? 'live-relaunch' : 'snapshot-before-metadata', truncated: captured.truncated }
  if (launch) report.launchOutput = captured.launchOutput
  for (const name of ['ro.product.cpu.abilist', 'ro.product.cpu.abilist64', 'ro.build.version.sdk', 'ro.dalvik.vm.native.bridge', 'ro.dalvik.vm.isa.arm64', 'ro.enable.native.bridge.exec']) {
    try { report.properties[name] = await run('shell', 'getprop', name) } catch (error) { report.errors.push(error.message) }
  }
  try {
    const packageInfo = await run('shell', 'dumpsys', 'package', PACKAGE)
    report.packageInfo = packageInfo.split(/\r?\n/).filter(line => /versionCode=|versionName=|primaryCpuAbi=|secondaryCpuAbi=|nativeLibraryDir=/.test(line)).map(line => line.trim())
  } catch (error) { report.errors.push(error.message) }
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '../../client/build-report.json'), 'utf8'))
  report.expectedApkSha256 = expected.apkSha256
  report.expectedLibrarySha256 = expected.patchedLibrarySha256
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-client-report-'))
  try {
    const location = (await run('shell', 'pm', 'path', PACKAGE)).split(/\r?\n/).find(line => line.startsWith('package:') && line.endsWith('/base.apk'))
    if (!location) throw new Error('Installed base APK path not found')
    const apkPath = path.join(temporary, 'base.apk')
    await run('pull', location.slice(8), apkPath)
    const apk = fs.readFileSync(apkPath)
    report.apkSha256 = sha(apk)
    const library = zipEntry(apk, 'lib/arm64-v8a/libg.so')
    report.librarySha256 = sha(library)
    report.programHeaderOffset = Number(library.readBigUInt64LE(32))
    report.programHeaderCount = library.readUInt16LE(56)
    report.configuration = zipEntry(apk, 'assets/configs.so').toString('utf8').trim()
    report.matchesPublishedLibrary = report.librarySha256 === expected.patchedLibrarySha256
  } catch (error) { report.errors.push(error.message) } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
  return { report, raw: captured.text }
}

async function main () {
  const args = process.argv.slice(2)
  if (args.some(value => value.startsWith('--') && value !== '--launch') || args.filter(value => !value.startsWith('--')).length > 1) throw new Error('Usage: node tools/client/diagnose.js [serial] [--launch]')
  const serial = args.find(value => !value.startsWith('--'))
  const adb = process.env.ADB || 'adb'
  const prefix = serial ? ['-s', serial] : []
  const run = async (...args) => (await execute(adb, [...prefix, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000, windowsHide: true })).stdout.trim()
  const { report, raw } = await collect(run, () => captureLive(adb, prefix, run), args.includes('--launch'))
  const folder = path.join(__dirname, '../../.local/client-diagnostics')
  fs.mkdirSync(folder, { recursive: true })
  const stem = new Date().toISOString().replace(/[:.]/g, '-')
  const output = path.join(folder, stem + '.json')
  const rawFile = path.join(folder, stem + '.raw.log')
  fs.writeFileSync(rawFile, raw, { mode: 0o600, flag: 'wx' })
  report.logCapture.rawLogFile = path.basename(rawFile)
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  console.log('Saved local device report:', output)
  console.log('Full captured log:', rawFile)
  console.log('Published native library match:', report.matchesPublishedLibrary ?? 'unknown')
  console.log('Game library load seen:', report.logCapture.libraryLoadSeen, '; failure seen:', report.logCapture.failureSeen)
  if (!report.logCapture.libraryLoadSeen && !report.logCapture.failureSeen) console.log('No game load/failure captured. Run again with --launch.')
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
module.exports = { zipEntry, selectLogs, collect, captureLive }
