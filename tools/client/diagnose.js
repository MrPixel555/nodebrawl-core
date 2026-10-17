'use strict'
// Read-only device collection. No install, app-data reset or Frida required.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { inflateRawSync } = require('node:zlib')
const { execFileSync } = require('node:child_process')

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

function main () {
  const serial = process.argv[2]
  const adb = process.env.ADB || 'adb'
  const prefix = serial ? ['-s', serial] : []
  const run = (...args) => execFileSync(adb, [...prefix, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const report = { schema: 1, timeUtc: new Date().toISOString(), properties: {}, errors: [] }
  for (const name of ['ro.product.cpu.abilist', 'ro.product.cpu.abilist64', 'ro.build.version.sdk', 'ro.dalvik.vm.native.bridge', 'ro.dalvik.vm.isa.arm64', 'ro.enable.native.bridge.exec']) {
    report.properties[name] = run('shell', 'getprop', name)
  }
  const packageInfo = run('shell', 'dumpsys', 'package', 'com.supercell.clashroyale')
  report.packageInfo = packageInfo.split(/\r?\n/).filter(line => /versionCode=|versionName=|primaryCpuAbi=|secondaryCpuAbi=|nativeLibraryDir=/.test(line)).map(line => line.trim())
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '../../client/build-report.json'), 'utf8'))
  report.expectedApkSha256 = expected.apkSha256
  report.expectedLibrarySha256 = expected.patchedLibrarySha256
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-client-report-'))
  try {
    const location = run('shell', 'pm', 'path', 'com.supercell.clashroyale').split(/\r?\n/).find(line => line.startsWith('package:') && line.endsWith('/base.apk'))
    if (!location) throw new Error('Installed base APK path not found')
    const apkPath = path.join(temporary, 'base.apk')
    run('pull', location.slice(8), apkPath)
    const apk = fs.readFileSync(apkPath)
    report.apkSha256 = sha(apk)
    const library = zipEntry(apk, 'lib/arm64-v8a/libg.so')
    report.librarySha256 = sha(library)
    report.programHeaderOffset = Number(library.readBigUInt64LE(32))
    report.programHeaderCount = library.readUInt16LE(56)
    report.configuration = zipEntry(apk, 'assets/configs.so').toString('utf8').trim()
    report.matchesPublishedLibrary = report.librarySha256 === expected.patchedLibrarySha256
  } catch (error) { report.errors.push(error.message) } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
  const log = run('logcat', '-d', '-v', 'threadtime')
  report.logs = log.split(/\r?\n/).filter(line => /houdini|native.?bridge|libnb\s|linker\s|UnsatisfiedLinkError|FATAL EXCEPTION|Fatal signal|com\.supercell\.clashroyale/i.test(line)).slice(-2000)
  const folder = path.join(__dirname, '../../.local/client-diagnostics')
  fs.mkdirSync(folder, { recursive: true })
  const output = path.join(folder, new Date().toISOString().replace(/[:.]/g, '-') + '.json')
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  console.log('Saved local device report:', output)
  console.log('Published native library match:', report.matchesPublishedLibrary ?? 'unknown')
}

if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { zipEntry }
