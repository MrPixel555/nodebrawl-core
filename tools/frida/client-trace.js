/* global Process, Module, Interceptor, Memory, send, configuration */
'use strict'

const sockets = new Set()
const installed = new Set()
function record (event, fields = {}) { send({ event, ...fields }) }
function hex (pointer, size) { return Array.from(new Uint8Array(pointer.readByteArray(size)), n => n.toString(16).padStart(2, '0')).join('') }
function api (name) { return typeof Module.getGlobalExportByName === 'function' ? Module.getGlobalExportByName(name) : Module.getExportByName(null, name) }

function instrument (module) {
  if (module.name !== 'libg.so' || installed.has(module.base.toString())) return
  if (Process.arch !== 'arm64') { record('unsupported-architecture', { arch: Process.arch }); return }
  if (module.size < 0x41e924) { record('library-profile-mismatch', { reason: 'module too small' }); return }
  const functions = [
    [0x250bbc, 'messaging-read', 'fc6fbaa9fa6701a9f85f02a9f65703a9'],
    [0x41e914, 'login-encode', 'f44fbea9fd7b01a9fd430091f30300aa'],
    [0x154440, 'home-decode', 'f50f1df8f44f01a9fd7b02a9fd830091'],
    [0x1f8f08, 'authenticated-open', 'fc0f1af8fa6701a9f85f02a9f65703a9'],
  ]
  // Validate every hook location before installing any native hook.
  for (const [offset, name, expected] of functions) {
    if (hex(module.base.add(offset), 16) !== expected) { record('library-profile-mismatch', { name, offset }); return }
  }
  installed.add(module.base.toString())
  for (const [offset, name] of functions) {
    Interceptor.attach(module.base.add(offset), {
      onEnter (args) {
        this.nativeObject = args[0]
        this.name = name
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
      },
    })
  }
  record('library-profile-matched', { module: module.name, base: module.base.toString(), nativeHooks: functions.length })
}

Interceptor.attach(api('connect'), {
  onEnter (args) {
    const address = args[1]
    if (args[2].toUInt32() < 16 || address.readU16() !== 2) return
    const bytes = new Uint8Array(address.readByteArray(16))
    const port = bytes[2] * 256 + bytes[3]
    if (port !== 9339) return
    const originalHost = Array.from(bytes.slice(4, 8)).join('.')
    const socket = args[0].toInt32()
    sockets.add(socket)
    this.socket = socket
    if (configuration.host) {
      const replacement = Memory.alloc(16)
      bytes[2] = configuration.port >>> 8
      bytes[3] = configuration.port & 255
      bytes.set(configuration.host.split('.').map(Number), 4)
      replacement.writeByteArray(bytes)
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
record('trace-ready', { redirected: Boolean(configuration.host), credentialsCaptured: false, transportChanged: false })
