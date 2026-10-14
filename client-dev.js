const configuration = {"host":"223.223.223.1","port":9339,"serverPublicKey":"b82bd01df81e8eba890cb3659d2b2f083a47717dc8159106380ca146bb8b9745"}
const clientCrypto = (() => { const module = { exports: {} }; 'use strict'
class ProtocolError extends Error {}
const mask = (1n << 64n) - 1n
const iv = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'].map(hex => BigInt('0x' + hex))
const permutations = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
]
function rotate (value, bits) { return ((value >> bits) | (value << (64n - bits))) & mask }

// BLAKE2b's digest length is part of its parameters; truncating BLAKE2b-512 differs.
function blake2b (input, length = 24) {
  if (!(input instanceof Uint8Array) || input.length > 1048576) throw new ProtocolError('Invalid BLAKE2b input')
  if (!Number.isInteger(length) || length < 1 || length > 64) throw new ProtocolError('Invalid BLAKE2b digest length')
  const hash = [...iv]
  hash[0] ^= 0x01010000n ^ BigInt(length)
  for (let offset = 0; offset < input.length || offset === 0; offset += 128) {
    const count = Math.min(input.length - offset, 128)
    const block = new Uint8Array(128)
    block.set(input.subarray(offset, offset + count))
    const view = new DataView(block.buffer)
    const words = Array.from({ length: 16 }, (_, n) => view.getBigUint64(n * 8, true))
    const state = [...hash, ...iv]
    state[12] ^= BigInt(offset + count)
    if (offset + count === input.length) state[14] ^= mask
    const mix = (a, b, c, d, x, y) => {
      state[a] = (state[a] + state[b] + x) & mask
      state[d] = rotate(state[d] ^ state[a], 32n)
      state[c] = (state[c] + state[d]) & mask
      state[b] = rotate(state[b] ^ state[c], 24n)
      state[a] = (state[a] + state[b] + y) & mask
      state[d] = rotate(state[d] ^ state[a], 16n)
      state[c] = (state[c] + state[d]) & mask
      state[b] = rotate(state[b] ^ state[c], 63n)
    }
    for (let round = 0; round < 12; round++) {
      const s = permutations[round % 10]
      for (let n = 0; n < 4; n++) mix(n, n + 4, n + 8, n + 12, words[s[n * 2]], words[s[n * 2 + 1]])
      for (let n = 0; n < 4; n++) mix(n, (n + 1) % 4 + 4, (n + 2) % 4 + 8, (n + 3) % 4 + 12, words[s[8 + n * 2]], words[s[9 + n * 2]])
    }
    for (let n = 0; n < 8; n++) hash[n] ^= state[n] ^ state[n + 8]
  }
  const output = new Uint8Array(64)
  const view = new DataView(output.buffer)
  hash.forEach((word, n) => view.setBigUint64(n * 8, word, true))
  return output.subarray(0, length)
}
// RFC 7748 Montgomery ladder, used by the optional Frida development adapter.
// Server key agreement continues to use Node's crypto implementation.
function x25519 (secret, publicKey) {
  if (!(secret instanceof Uint8Array) || secret.length !== 32 || !(publicKey instanceof Uint8Array) || publicKey.length !== 32) throw new ProtocolError('Invalid Curve25519 key')
  const scalar = Uint8Array.from(secret)
  scalar[0] &= 248; scalar[31] = (scalar[31] & 127) | 64
  const coordinate = Uint8Array.from(publicKey)
  coordinate[31] &= 127
  const prime = (1n << 255n) - 19n
  const mod = value => ((value % prime) + prime) % prime
  let x1 = 0n
  for (let n = 31; n >= 0; n--) x1 = (x1 << 8n) | BigInt(coordinate[n])
  x1 = mod(x1)
  let x2 = 1n; let z2 = 0n; let x3 = x1; let z3 = 1n; let swap = 0
  for (let bit = 254; bit >= 0; bit--) {
    const current = (scalar[bit >>> 3] >>> (bit & 7)) & 1
    swap ^= current
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2] }
    swap = current
    const a = mod(x2 + z2); const aa = mod(a * a)
    const b = mod(x2 - z2); const bb = mod(b * b)
    const e = mod(aa - bb); const c = mod(x3 + z3); const d = mod(x3 - z3)
    const da = mod(d * a); const cb = mod(c * b)
    x3 = mod((da + cb) ** 2n); z3 = mod(x1 * mod((da - cb) ** 2n))
    x2 = mod(aa * bb); z2 = mod(e * mod(aa + 121665n * e))
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2] }
  let inverse = 1n; let base = z2; let exponent = prime - 2n
  while (exponent > 0n) { if (exponent & 1n) inverse = mod(inverse * base); base = mod(base * base); exponent >>= 1n }
  let value = mod(x2 * inverse)
  if (value === 0n) throw new ProtocolError('Invalid Curve25519 peer key')
  const output = new Uint8Array(32)
  for (let n = 0; n < 32; n++) { output[n] = Number(value & 255n); value >>= 8n }
  scalar.fill(0)
  return output
}
module.exports = { blake2b, x25519 }
; return module.exports })()
const clientProbes = (() => { const module = { exports: {} }; /* global Stalker, setTimeout */
'use strict'

// Callouts run in translated blocks. Never patch the original instructions.
// Identify probes by call site: Stalker owns LR translation on followed threads.
function createStalkerProbes (probes) {
  const callbacks = new Map(probes.map(probe => [probe.address.toString(), probe.callback]))
  const threads = new Set()
  let collectionQueued = false
  return {
    follow (threadId) {
      if (threads.has(threadId)) return false
      Stalker.follow(threadId, {
        transform (iterator) {
          let instruction
          while ((instruction = iterator.next()) !== null) {
            const callback = callbacks.get(instruction.address.toString())
            if (callback && iterator.memoryAccess === 'open') iterator.putCallout(callback)
            iterator.keep()
          }
        },
      })
      threads.add(threadId)
      return true
    },
    unfollow (threadId) {
      if (!threads.has(threadId)) return
      Stalker.unfollow(threadId)
      threads.delete(threadId)
      // Collect on the script thread after the native callback has unwound.
      // Avoid doing this work synchronously in the Android render thread.
      if (!collectionQueued) {
        collectionQueued = true
        setTimeout(() => { collectionQueued = false; Stalker.garbageCollect() }, 50)
      }
    },
  }
}

module.exports = { createStalkerProbes }
; return module.exports })()
const clientFrame = (() => { const module = { exports: {} }; /* global Process, NativeFunction, NativeCallback */
'use strict'

// Enter tracing through a native bridge and leave it before returning to ART.
// traps:'all' resumes Stalker only for the original native invocation; the
// default bridge keeps Interceptor socket hooks working on untraced frames.
function createNativeFrame (address, returnType, argumentTypes, options) {
  const settings = { scheduling: 'cooperative', exceptions: 'propagate' }
  const original = new NativeFunction(address, returnType, argumentTypes, settings)
  const traced = new NativeFunction(address, returnType, argumentTypes, { ...settings, traps: 'all' })
  return new NativeCallback(function (...args) {
    if (!options.shouldTrace()) return original(...args)
    const thread = Process.getCurrentThreadId()
    let started
    try { started = options.probes.follow(thread) } catch (error) {
      options.onError(error)
      return original(...args)
    }
    try {
      options.onEnter(thread)
      const result = traced(...args)
      if (options.onReturn) options.onReturn(thread, result)
      return result
    } finally {
      if (started) options.probes.unfollow(thread)
      options.onLeave(thread)
    }
  }, returnType, argumentTypes)
}

module.exports = { createNativeFrame }
; return module.exports })()
/* global Process, Module, Interceptor, Memory, configuration, clientCrypto, clientProbes, clientFrame, Frida, Script, Stalker, ptr */
'use strict'

const sockets = new Set()
const ioStatus = new Map()
const activeIO = new Set()
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
    [0x250bbc, 'fc6fbaa9fa6701a9f85f02a9f65703a9'],
    [0x54c92c, 'f44fbea9fd7b01a9fd430091f30300aa'],
    [0x41e914, 'f44fbea9fd7b01a9fd430091f30300aa'],
    [0x3affd4, 'fc6fbaa9fa6701a9f85f02a9f65703a9'],
  ]
  for (const [offset, expected] of locations) {
    if (hex(module.base.add(offset), expected.length / 2) !== expected) { record('library-profile-mismatch', { offset }); return }
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
  const lastStates = new Map()
  function observe (action) {
    return context => { try { action(context) } catch (error) { record('observation-error', { message: error.message }) } }
  }
  definitions.push(
    [0x250bbc, observe(context => {
      const object = context.x0
      const state = object.add(0x254).readU32()
      if (lastStates.get(object.toString()) === state) return
      if (lastStates.size >= 8) lastStates.clear()
      lastStates.set(object.toString(), state)
      record('native-messaging-state', { state })
    })],
    [0x54c92c, observe(context => {
      const object = context.x0
      record('native-client-hello-encode', { version: object.add(8).readU32(), fields: Object.fromEntries([0x7c, 0x80, 0x84, 0x88, 0x8c, 0xa8, 0xac].map(offset => ['field_0x' + offset.toString(16), object.add(offset).readU32()])) })
    })],
    [0x41e914, observe(context => {
      const object = context.x0
      record('native-login-encode', { version: object.add(8).readU32(), major: object.add(0x90).readU32(), minor: object.add(0x94).readU32(), build: object.add(0x98).readU32() })
    })],
    [0x3affd4, observe(context => record('native-login-build', { state: context.x0.add(0x254).readU32() }))],
  )
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
  const frames = new Map()
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
              const progress = frames.get(thread) || { count: 0 }
              progress.started = Date.now()
              frames.set(thread, progress)
              if (!seenThreads.has(thread)) { seenThreads.add(thread); record('native-frame-scope-started', { thread, method: 'GameApp.update', interpreterExcluded: true }) }
            },
            onReturn (thread, result) {
              const progress = frames.get(thread)
              progress.count++
              if (progress.count <= 3 || progress.count % 300 === 0) record('native-frame-returned', { thread, frames: progress.count, durationMs: Date.now() - progress.started, result })
            },
            onLeave (thread) {
              clearTemporary(thread)
              const progress = frames.get(thread)
              if (progress.count <= 3 || progress.count % 300 === 0) record('native-frame-complete', { thread, frames: progress.count })
            },
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
    ioStatus.set(socket, { started: new Set(), errors: new Map(), sentBytes: 0, receivedBytes: 0 })
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

for (const name of ['send', 'recv', 'sendto', 'recvfrom', 'write', 'read']) {
  Interceptor.attach(api(name), {
    onEnter (args) {
      this.socket = args[0].toInt32()
      if (!sockets.has(this.socket)) return
      this.thread = Process.getCurrentThreadId()
      if (activeIO.has(this.thread)) return
      activeIO.add(this.thread)
      this.ownsIO = true
      this.buffer = args[1]
      this.requested = args[2].toUInt32()
      this.direction = ['send', 'sendto', 'write'].includes(name) ? 'send' : 'recv'
      const status = ioStatus.get(this.socket)
      if (!status.started.has(this.direction)) {
        status.started.add(this.direction)
        record('socket-io-start', { socket: this.socket, api: name, direction: this.direction, requested: this.requested })
      }
    },
    onLeave (result) {
      if (!this.ownsIO) return
      activeIO.delete(this.thread)
      const count = result.toInt32()
      const status = ioStatus.get(this.socket)
      if (!status) return
      if (count < 0 && status.errors.has(this.direction) && status.errors.get(this.direction) === this.errno) return
      if (count < 0) status.errors.set(this.direction, this.errno)
      else status.errors.delete(this.direction)
      if (count > 0) status[this.direction === 'send' ? 'sentBytes' : 'receivedBytes'] += count
      const fields = { socket: this.socket, api: name, bytes: count, requested: this.requested, errno: count < 0 ? this.errno : 0 }
      if (count >= 7) {
        const header = new Uint8Array(this.buffer.readByteArray(7))
        fields.candidateHeader = { id: header[0] * 256 + header[1], bytes: header[2] * 65536 + header[3] * 256 + header[4], version: header[5] * 256 + header[6] }
      }
      record('socket-' + this.direction, fields)
    },
  })
}
Interceptor.attach(api('close'), {
  onEnter (args) {
    const socket = args[0].toInt32()
    const status = ioStatus.get(socket)
    if (status) record('game-socket-close', { socket, sentBytes: status.sentBytes, receivedBytes: status.receivedBytes })
    ioStatus.delete(socket)
    sockets.delete(socket)
  },
})

if (typeof Process.attachModuleObserver === 'function') Process.attachModuleObserver({ onAdded: instrument })
else {
  const module = Process.findModuleByName('libg.so')
  if (module) instrument(module)
  else throw new Error('This Frida version requires attaching after libg.so loads; use a current Frida release for spawn mode')
}
record('trace-ready', { fridaVersion: Frida.version, scriptRuntime: Script.runtime, redirected: Boolean(configuration.host), credentialsCaptured: false, developmentPeerRequested: Boolean(configuration.serverPublicKey), nativeInlineHooks: 0, tracingScope: 'jni-update-only', diagnostics: 'network-v1' })
