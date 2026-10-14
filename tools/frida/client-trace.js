/* global Process, Module, Interceptor, Memory, configuration, clientCrypto, clientProbes, clientFrame, Frida, Script, Stalker, ptr */
'use strict'

const sockets = new Set()
const installed = new Set()
const temporaries = new Map()
const registrationRoots = []
let probes = null
let peerActive = Boolean(configuration.serverPublicKey)
function record (event, fields = {}) { console.log(JSON.stringify({ event, ...fields })) }
function hex (pointer, size) { return Array.from(new Uint8Array(pointer.readByteArray(size)), n => n.toString(16).padStart(2, '0')).join('') }
function api (name) { return typeof Module.getGlobalExportByName === 'function' ? Module.getGlobalExportByName(name) : Module.getExportByName(null, name) }
function bytes (pointer, size) { return new Uint8Array(pointer.readByteArray(size)) }
function allocate (value) { const pointer = Memory.alloc(value.length); pointer.writeByteArray(Array.from(value)); return pointer }
function join (...arrays) { const result = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0)); let at = 0; for (const array of arrays) { result.set(array, at); at += array.length } return result }
function clearTemporary (thread) {
  const value = temporaries.get(thread)
  if (value) value.pointer.writeByteArray(Array(value.size).fill(0))
  temporaries.delete(thread)
}
function instrument (module) {
  if (probes && module.name !== 'libg.so') Stalker.exclude({ base: module.base, size: module.size })
  if (module.name !== 'libg.so' || installed.has(module.base.toString())) return
  if (Process.arch !== 'arm64') { record('unsupported-architecture', { arch: Process.arch }); return }
  if (module.size < 0x41e924) { record('library-profile-mismatch', { reason: 'module too small' }); return }
  const buildId = hex(module.base.add(0x210), 20)
  if (hex(module.base, 4) !== '7f454c46' || buildId !== '6e7c4084c38be82ffdb3e68fd64f10c71cfef2d4') { record('library-profile-mismatch', { reason: 'ELF build ID', buildId }); return }
  const locations = [
    [0x3bcc68, '2c79fe97'], [0x3bcc84, 'febbfe97'], [0x3bcc88, '08000071'],
    [0x27eab4, '99710394'], [0x27ead4, '0de9fd97'], [0x27ead8, 'f4334091'],
  ]
  for (const [offset, expected] of locations) {
    if (hex(module.base.add(offset), 4) !== expected) { record('library-profile-mismatch', { offset }); return }
  }
  if (hex(module.base.add(0x3f3f9c), 16) !== 'f30f1ef8fd7b01a9fd430091c84b00f0') { record('library-profile-mismatch', { reason: 'JNI update entry' }); return }
  installed.add(module.base.toString())
  if (configuration.serverPublicKey) installDevelopmentPeer(module)
  record('library-profile-matched', { module: module.name, buildId, base: module.base.toString(), nativeInlineHooks: 0, mode: configuration.serverPublicKey ? 'jni-scoped-peer' : 'sockets' })
}

function installDevelopmentPeer (module) {
  const peer = Uint8Array.from(configuration.serverPublicKey.match(/../g).map(byte => parseInt(byte, 16)))
  const basePoint = new Uint8Array(32); basePoint[0] = 9
  function messaging (context, outgoing) {
    // Slots are in the caller immediately before BL, not inside the crypto core.
    const object = context.sp.add(outgoing ? 0x60 : 0x3b0).readPointer()
    const state = object.add(0x254).readU32()
    if (outgoing ? ![3, 4].includes(state) : state !== 4) throw new Error('Unexpected native handshake state ' + state)
    return object
  }
  function guardProbe (action) {
    return context => {
      if (!peerActive) return
      const thread = Process.getCurrentThreadId()
      try { action(context, thread) } catch (error) {
        record('development-peer-error', { message: error.message, thread })
        peerActive = false
        clearTemporary(thread)
      }
    }
  }
  function shared (outgoing) {
    return guardProbe((context, thread) => {
      clearTemporary(thread)
      const object = messaging(context, outgoing)
      const secret = bytes(object.add(0x280), 32)
      let raw
      try {
        const pub = clientCrypto.x25519(secret, basePoint)
        if (Array.from(pub, byte => byte.toString(16).padStart(2, '0')).join('') !== hex(object.add(0x260), 32)) throw new Error('Native client key pair mismatch')
        raw = clientCrypto.x25519(secret, peer)
      } finally { secret.fill(0) }
      const pointer = allocate(raw)
      raw.fill(0)
      temporaries.set(thread, { pointer, size: 32 })
      context.x2 = pointer
      record('development-peer-shared', { direction: outgoing ? 'login' : 'reply', state: object.add(0x254).readU32() })
    })
  }
  function nonce (outgoing) {
    return guardProbe((context, thread) => {
      // The native HSalsa core has consumed the temporary shared secret.
      clearTemporary(thread)
      const object = messaging(context, outgoing)
      const pub = bytes(object.add(0x260), 32)
      const digest = clientCrypto.blake2b(outgoing ? join(pub, peer) : join(bytes(object.add(0x2a0), 24), pub, peer), 24)
      const pointer = allocate(digest)
      temporaries.set(thread, { pointer, size: 24 })
      context.x3 = pointer
      record(outgoing ? 'development-peer-seal' : 'development-peer-open', { paddedBytes: context.x2.toUInt32() })
    })
  }
  const definitions = [
    [0x3bcc68, shared(true)], [0x3bcc84, nonce(true)],
    [0x3bcc88, guardProbe((context, thread) => { clearTemporary(thread); record('development-peer-seal-result', { result: context.x0.toInt32() }) })],
    [0x27eab4, shared(false)], [0x27ead4, nonce(false)],
    [0x27ead8, guardProbe((context, thread) => {
      clearTemporary(thread)
      record('development-peer-open-result', { result: context.x0.toInt32() })
      peerActive = false
      // The JNI wrapper ends tracing after the complete native frame returns.
    })],
  ]
  probes = clientProbes.createStalkerProbes(definitions.map(([offset, action]) => ({ address: module.base.add(offset), callback: action })))
  // Never relocate ART's non-ABI interpreter or other system-library code.
  // JNI registration gives us an exact native frame boundary on every update.
  for (const other of Process.enumerateModules()) {
    if (other.name !== 'libg.so') Stalker.exclude({ base: other.base, size: other.size })
  }
  installNativeFrame(module)
}

function installNativeFrame (module) {
  const art = Process.findModuleByName('libart.so')
  const addresses = new Set()
  if (art) {
    for (const symbol of art.enumerateSymbols()) {
      if (symbol.name.includes('RegisterNatives') && symbol.name.includes('JNI') && !symbol.name.includes('CheckJNI')) addresses.add(symbol.address.toString())
    }
  }
  if (!addresses.size) {
    peerActive = false
    record('development-peer-unavailable', { reason: 'ART RegisterNatives entry not found; no thread tracing started' })
    return
  }
  let registered = false
  const seenThreads = new Set()
  for (const address of addresses) {
    Interceptor.attach(ptr(address), {
      onEnter (args) {
        const count = args[3].toInt32()
        if (registered || count < 1 || count > 512) return
        const methods = args[2]
        for (let n = 0; n < count; n++) {
          const row = methods.add(n * 24)
          if (!row.add(16).readPointer().equals(module.base.add(0x3f3f9c))) continue
          if (row.readPointer().readUtf8String() !== 'update' || row.add(8).readPointer().readUtf8String() !== '()Z') continue
          const replacement = clientFrame.createNativeFrame(module.base.add(0x3f3f9c), 'uint8', ['pointer', 'pointer'], {
            probes,
            shouldTrace: () => peerActive,
            onEnter (thread) {
              if (!seenThreads.has(thread)) { seenThreads.add(thread); record('native-frame-scope-started', { thread, method: 'GameApp.update', interpreterExcluded: true }) }
            },
            onLeave: clearTemporary,
            onError (error) { peerActive = false; record('development-peer-error', { message: error.message }) },
          })
          // Clone the whole JNI table: its original bytes belong to libg's
          // protected data, so only RegisterNatives receives the replacement.
          const copy = Memory.alloc(count * 24)
          copy.writeByteArray(methods.readByteArray(count * 24))
          copy.add(n * 24 + 16).writePointer(replacement)
          registrationRoots.push({ copy, replacement })
          args[2] = copy
          this.replaced = true
          registered = true
          break
        }
      },
      onLeave (result) {
        if (!this.replaced) return
        if (result.toInt32() === 0) record('jni-frame-registered', { method: 'GameApp.update', signature: '()Z', nativeInlineHooks: 0 })
        else {
          peerActive = false
          record('development-peer-error', { message: 'JNI RegisterNatives rejected the copied table', result: result.toInt32() })
        }
      },
    })
  }
  record('development-peer-enabled', { publicKey: configuration.serverPublicKey, method: 'stalker-jni-scope', nativeInlineHooks: 0, spawnRequired: true })
}

Interceptor.attach(api('connect'), {
  onEnter (args) {
    const address = args[1]
    const family = address.readU16()
    const size = family === 2 ? 16 : family === 10 ? 28 : 0
    if (!size || args[2].toUInt32() < size) return
    const bytes = new Uint8Array(address.readByteArray(size))
    const port = bytes[2] * 256 + bytes[3]
    if (port !== 9339) return
    const originalHost = family === 2 ? Array.from(bytes.slice(4, 8)).join('.') : Array.from({ length: 8 }, (_, n) => (bytes[8 + n * 2] * 256 + bytes[9 + n * 2]).toString(16)).join(':')
    const socket = args[0].toInt32()
    sockets.add(socket)
    this.socket = socket
    peerActive = Boolean(configuration.serverPublicKey)
    if (configuration.host) {
      const replacement = Memory.alloc(size)
      bytes[2] = configuration.port >>> 8
      bytes[3] = configuration.port & 255
      if (family === 2) bytes.set(configuration.host.split('.').map(Number), 4)
      else { bytes.fill(0, 4); bytes[18] = 255; bytes[19] = 255; bytes.set(configuration.host.split('.').map(Number), 20) }
      replacement.writeByteArray(Array.from(bytes))
      this.address = replacement
      args[1] = replacement
    }
    record('game-connect', { socket, originalHost, originalPort: port, redirectedHost: configuration.host, redirectedPort: configuration.host ? configuration.port : null })
  },
  onLeave (result) {
    if (this.socket === undefined) return
    record('game-connect-result', { socket: this.socket, result: result.toInt32(), errno: this.errno })
  },
})

for (const name of ['send', 'recv']) {
  Interceptor.attach(api(name), {
    onEnter (args) {
      this.socket = args[0].toInt32()
      if (!sockets.has(this.socket)) return
      this.buffer = args[1]
      this.requested = args[2].toUInt32()
    },
    onLeave (result) {
      if (!this.buffer) return
      const count = result.toInt32()
      const fields = { socket: this.socket, bytes: count, requested: this.requested }
      if (count >= 7) {
        const header = new Uint8Array(this.buffer.readByteArray(7))
        fields.candidateHeader = { id: header[0] * 256 + header[1], bytes: header[2] * 65536 + header[3] * 256 + header[4], version: header[5] * 256 + header[6] }
      }
      record('socket-' + name, fields)
    },
  })
}
Interceptor.attach(api('close'), {
  onEnter (args) { sockets.delete(args[0].toInt32()) },
})

if (typeof Process.attachModuleObserver === 'function') Process.attachModuleObserver({ onAdded: instrument })
else {
  const module = Process.findModuleByName('libg.so')
  if (module) instrument(module)
  else throw new Error('This Frida version requires attaching after libg.so loads; use a current Frida release for spawn mode')
}
record('trace-ready', { fridaVersion: Frida.version, scriptRuntime: Script.runtime, redirected: Boolean(configuration.host), credentialsCaptured: false, developmentPeerRequested: Boolean(configuration.serverPublicKey), nativeInlineHooks: 0, tracingScope: 'jni-update-only' })
