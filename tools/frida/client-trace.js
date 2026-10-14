/* global Process, Module, Interceptor, Memory, send, configuration, clientCrypto, Frida, Script */
'use strict'

const sockets = new Set()
const installed = new Set()
const handshakes = new Map()
function record (event, fields = {}) { send({ event, ...fields }) }
function hex (pointer, size) { return Array.from(new Uint8Array(pointer.readByteArray(size)), n => n.toString(16).padStart(2, '0')).join('') }
function api (name) { return typeof Module.getGlobalExportByName === 'function' ? Module.getGlobalExportByName(name) : Module.getExportByName(null, name) }

function instrument (module) {
  if (module.name !== 'libg.so' || installed.has(module.base.toString())) return
  if (Process.arch !== 'arm64') { record('unsupported-architecture', { arch: Process.arch }); return }
  if (module.size < 0x41e924) { record('library-profile-mismatch', { reason: 'module too small' }); return }
  const buildId = hex(module.base.add(0x210), 20)
  if (hex(module.base, 4) !== '7f454c46' || buildId !== '6e7c4084c38be82ffdb3e68fd64f10c71cfef2d4') { record('library-profile-mismatch', { reason: 'ELF build ID', buildId }); return }
  const functions = [
    [0x250bbc, 'messaging-read', 'fc6fbaa9fa6701a9f85f02a9f65703a9'],
    [0x41e914, 'login-encode', 'f44fbea9fd7b01a9fd430091f30300aa'],
    [0x154440, 'home-decode', 'f50f1df8f44f01a9fd7b02a9fd830091'],
    [0x3affd4, 'login-build', 'fc6fbaa9fa6701a9f85f02a9f65703a9'],
    [0x1f8f08, 'authenticated-open', 'fc0f1af8fa6701a9f85f02a9f65703a9'],
  ]
  // Validate every hook location before installing any native hook.
  for (const [offset, name, expected] of functions) {
    if (hex(module.base.add(offset), 16) !== expected) { record('library-profile-mismatch', { name, offset }); return }
  }
  if (configuration.serverPublicKey && (hex(module.base.add(0x35b118), 16) !== 'fc4fbea9fd7b01a9fd430091ffc30cd1' || hex(module.base.add(0x36bc7c), 16) !== 'fc4fbea9fd7b01a9fd430091ff8333d1')) { record('library-profile-mismatch', { reason: 'crypto hook profile' }); return }
  installed.add(module.base.toString())
  for (const [offset, name] of functions) {
    Interceptor.attach(module.base.add(offset), {
      onEnter (args) {
        this.nativeObject = args[0]
        this.name = name
        if (['messaging-read', 'login-build'].includes(name)) {
          this.thread = Process.getCurrentThreadId()
          this.previousHandshake = handshakes.get(this.thread)
          handshakes.set(this.thread, { object: args[0], kind: name })
        }
        if (name === 'messaging-read') {
          const state = args[0].add(0x254).readU32()
          const fields = { state }
          if (state === 4) fields.clientPublicKey = hex(args[0].add(0x260), 32)
          record(name + '-enter', fields)
        } else if (name === 'authenticated-open') record(name + '-enter', { paddedBytes: args[2].toUInt32() })
      },
      onLeave (result) {
        try {
          const object = this.nativeObject
          if (name === 'messaging-read') record(name + '-leave', { state: object.add(0x254).readU32(), returnedMessage: !result.isNull() })
          else if (name === 'login-encode') record(name, { version: object.add(8).readU32(), major: object.add(0x90).readS32(), minor: object.add(0x94).readS32(), build: object.add(0x98).readS32(), payloadBytes: object.add(0x24).readU32() })
          else if (name === 'home-decode') record(name, { consumedBytes: object.add(0x24).readU32() })
          else if (name === 'authenticated-open') record(name + '-leave', { result: result.toInt32() })
        } catch (error) { record('observation-error', { name, message: error.message }) }
        finally {
          if (this.thread !== undefined) {
            if (this.previousHandshake) handshakes.set(this.thread, this.previousHandshake)
            else handshakes.delete(this.thread)
          }
        }
      },
    })
  }
  if (configuration.serverPublicKey) installDevelopmentPeer(module)
  record('library-profile-matched', { module: module.name, buildId, base: module.base.toString(), nativeHooks: functions.length + (configuration.serverPublicKey ? 3 : 0) })
}

function installDevelopmentPeer (module) {
  const peer = Uint8Array.from(configuration.serverPublicKey.match(/../g).map(byte => parseInt(byte, 16)))
  const pointer = bytes => { const result = Memory.alloc(bytes.length); result.writeByteArray(Array.from(bytes)); return result }
  const publicBytes = object => new Uint8Array(object.add(0x260).readByteArray(32))
  const join = (...arrays) => { const result = new Uint8Array(arrays.reduce((sum, bytes) => sum + bytes.length, 0)); let at = 0; for (const bytes of arrays) { result.set(bytes, at); at += bytes.length } return result }
  const coreAddress = module.base.add(0x35b118)
  const sealAddress = module.base.add(0x36bc7c)
  if (hex(coreAddress, 16) !== 'fc4fbea9fd7b01a9fd430091ffc30cd1' || hex(sealAddress, 16) !== 'fc4fbea9fd7b01a9fd430091ff8333d1') throw new Error('Development peer crypto profile mismatch')
  Interceptor.attach(coreAddress, {
    onEnter (args) {
      const caller = this.returnAddress.sub(module.base).toUInt32()
      if (![0x3bcc6c, 0x27eab8].includes(caller) || args[3].toInt32() !== 1) return
      const active = handshakes.get(Process.getCurrentThreadId())
      if (!active) throw new Error('Missing native handshake context')
      const secret = new Uint8Array(active.object.add(0x280).readByteArray(32))
      const shared = clientCrypto.x25519(secret, peer)
      secret.fill(0)
      this.key = pointer(shared)
      shared.fill(0)
      args[2] = this.key
    },
    onLeave () { if (this.key) this.key.writeByteArray(Array(32).fill(0)) },
  })
  for (const [name, address, returnOffset] of [['seal', sealAddress, 0x3bcc88], ['open', module.base.add(0x1f8f08), 0x27ead8]]) {
    Interceptor.attach(address, {
      onEnter (args) {
        if (this.returnAddress.sub(module.base).toUInt32() !== returnOffset) return
        const active = handshakes.get(Process.getCurrentThreadId())
        if (!active) throw new Error('Missing native handshake context')
        const pub = publicBytes(active.object)
        const nonce = name === 'seal' ? clientCrypto.blake2b(join(pub, peer), 24) : clientCrypto.blake2b(join(new Uint8Array(active.object.add(0x2a0).readByteArray(24)), pub, peer), 24)
        this.nonce = pointer(nonce)
        args[3] = this.nonce
        record('development-peer-' + name, { payloadBytes: args[2].toUInt32() })
      },
    })
  }
  record('development-peer-enabled', { publicKey: configuration.serverPublicKey })
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
  onLeave (result) { if (this.socket !== undefined) record('game-connect-result', { socket: this.socket, result: result.toInt32(), errno: this.errno }) },
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
record('trace-ready', { fridaVersion: Frida.version, scriptRuntime: Script.runtime, redirected: Boolean(configuration.host), credentialsCaptured: false, developmentPeerRequested: Boolean(configuration.serverPublicKey) })
