'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { diffieHellman, createPublicKey } = require('node:crypto')
const { keyPair, core, seal, open } = require('../lib/protocol/salsa17')
const { loginNonce, replyNonce } = require('../lib/protocol/transport')
const { NativeTransport } = require('../server/transport')
const login = require('./fixtures/native-login-envelope.json')
const failed = require('./fixtures/native-encrypted-failed.json')

// Executes the actual generated script in a small Frida API model. Native
// call-site stack slots are checked separately by verify_development_peer.py.
function client (publicKey, profileMatches = true) {
  const blocks = new Map()
  const logs = []; const hooks = []; const excluded = []
  const callouts = new Map(); const unfollowed = []; const callbacks = new Map(); const invocations = []; const following = new Set()
  let nativeBody = () => 1
  let allocation = 0x40000000
  class Pointer {
    constructor (value) { this.value = Number(value) }
    add (n) { return new Pointer(this.value + n) }
    toString () { return '0x' + this.value.toString(16) }
    toUInt32 () { return this.value >>> 0 }
    toInt32 () { return this.value | 0 }
    equals (other) { return this.value === other.value }
    region (size) {
      for (const [base, data] of blocks) if (this.value >= base && this.value + size <= base + data.length) return data.subarray(this.value - base, this.value - base + size)
      throw new Error('Unmapped test memory ' + this.toString())
    }

    readByteArray (size) { return Uint8Array.from(this.region(size)).buffer }
    writeByteArray (data) { if (data.length === undefined) data = new Uint8Array(data); this.region(data.length).set(data) }
    readU32 () { return this.region(4).readUInt32LE() }
    readPointer () { return new Pointer(this.region(8).readBigUInt64LE()) }
    writePointer (value) { this.region(8).writeBigUInt64LE(BigInt(value.value)) }
    readUtf8String () {
      for (const [base, data] of blocks) if (this.value >= base && this.value < base + data.length) return data.subarray(this.value - base).toString().split('\0')[0]
      throw new Error('Unmapped test string')
    }
  }
  const base = new Pointer(0x100000000)
  const module = { name: 'libg.so', size: 0x1000000, base }
  const art = { name: 'libart.so', size: 0x10000, base: new Pointer(0x50000000), enumerateSymbols: () => [{ name: '_ZN3art3JNI_RegisterNatives', address: new Pointer(0x50001000) }] }
  blocks.set(base.value, Buffer.from('7f454c46', 'hex'))
  blocks.set(base.value + 0x210, Buffer.from(profileMatches ? '6e7c4084c38be82ffdb3e68fd64f10c71cfef2d4' : '0000000000000000000000000000000000000000', 'hex'))
  const instructions = [[0x3bcc68, '2c79fe97'], [0x3bcc84, 'febbfe97'], [0x3bcc88, '08000071'], [0x27eab4, '99710394'], [0x27ead4, '0de9fd97'], [0x27ead8, 'f4334091']]
  for (const [offset, hex] of instructions) blocks.set(base.value + offset, Buffer.from(hex, 'hex'))
  const originalInstructions = instructions.map(([offset]) => Buffer.from(blocks.get(base.value + offset)))
  blocks.set(base.value + 0x3f3f9c, Buffer.from('f30f1ef8fd7b01a9fd430091c84b00f0', 'hex'))
  const memory = { alloc (size) { const pointer = new Pointer(allocation); blocks.set(allocation, Buffer.alloc(size)); allocation += size + 16; return pointer } }
  const context = vm.createContext({
    console: { log: value => logs.push(JSON.parse(value)) },
    Process: { arch: 'arm64', getCurrentThreadId: () => 42, enumerateModules: () => [module, art], findModuleByName: name => name === 'libart.so' ? art : null, attachModuleObserver: observer => observer.onAdded(module) },
    Module: { getGlobalExportByName: name => name },
    Memory: memory,
    ptr: value => new Pointer(Number(value)),
    NativeFunction: function (address, returnType, argumentTypes, settings) {
      assert(address.equals(base.add(0x3f3f9c)))
      assert.equal(returnType, 'uint8')
      assert.equal(JSON.stringify(argumentTypes), '["pointer","pointer"]')
      return (...args) => { invocations.push({ args, settings }); return nativeBody(...args) }
    },
    NativeCallback: function (fn) { const pointer = memory.alloc(16); callbacks.set(pointer.value, fn); return pointer },
    Interceptor: { attach: (address, callbacks) => hooks.push({ address, callbacks }) },
    Stalker: {
      exclude: range => excluded.push(range),
      follow (threadId, options) {
        following.add(threadId)
        let index = -1
        options.transform({ memoryAccess: 'open', next: () => ++index < instructions.length ? { address: base.add(instructions[index][0]) } : null, putCallout: callback => callouts.set(instructions[index][0], callback), keep: () => {} })
      },
      unfollow: thread => { unfollowed.push(thread); following.delete(thread) },
      garbageCollect: () => {},
    },
    Frida: { version: 'model' },
    Script: { runtime: 'model' },
    setInterval: () => assert.fail('Never follow Java/GL threads from a timer'),
  })
  const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8')
  const bundle = (name, file) => `const ${name} = (() => { const module = {exports:{}}; ${source(file)}; return module.exports })();\n`
  vm.runInContext(`const configuration = ${JSON.stringify({ host: '198.51.100.3', port: 9339, serverPublicKey: publicKey })};\n` + bundle('clientCrypto', 'lib/protocol/crypto-math.js') + bundle('clientProbes', 'tools/frida/stalker-probes.js') + bundle('clientFrame', 'tools/frida/native-frame.js') + source('tools/frida/client-trace.js'), context)
  let replacement
  const methods = memory.alloc(48)
  const name = memory.alloc(7); name.writeByteArray(Buffer.from('update\0'))
  const signature = memory.alloc(4); signature.writeByteArray(Buffer.from('()Z\0'))
  methods.add(24).writePointer(name); methods.add(32).writePointer(signature); methods.add(40).writePointer(base.add(0x3f3f9c))
  const originalTable = Buffer.from(methods.readByteArray(48))
  function register (valid = true) {
    const hook = hooks.find(hook => hook.address instanceof Pointer && hook.address.value === 0x50001000)
    assert(hook, 'RegisterNatives observer missing')
    if (!valid) methods.add(40).writePointer(base.add(0x1234))
    const args = [new Pointer(0), new Pointer(0), methods, new Pointer(2)]
    const invocation = {}
    hook.callbacks.onEnter.call(invocation, args)
    hook.callbacks.onLeave.call(invocation, new Pointer(0))
    if (valid) {
      assert(!args[2].equals(methods), 'JNI input table must be cloned')
      assert.deepEqual(Buffer.from(methods.readByteArray(48)), originalTable)
      assert.deepEqual(Buffer.from(args[2].readByteArray(24)), originalTable.subarray(0, 24))
      replacement = callbacks.get(args[2].add(40).readPointer().value)
      assert(replacement)
    } else assert(args[2].equals(methods))
  }
  function frame (operation = () => 1) {
    if (!replacement) register()
    nativeBody = operation
    return replacement(new Pointer(17), new Pointer(34))
  }
  const object = new Pointer(0x20000000); const stack = new Pointer(0x30000000)
  const data = Buffer.alloc(0x300); blocks.set(object.value, data)
  const stackBytes = Buffer.alloc(0x400); blocks.set(stack.value, stackBytes)
  stackBytes.writeBigUInt64LE(BigInt(object.value), 0x60)
  stackBytes.writeBigUInt64LE(BigInt(object.value), 0x3b0)
  function state (fixture, value) {
    data.writeUInt32LE(value, 0x254)
    for (const [name, offset] of [['clientPublicKey', 0x260], ['clientSecret', 0x280], ['clientNonce', 0x2a0]]) Buffer.from(fixture[name], 'hex').copy(data, offset)
  }
  function probe (offset, registers = {}) {
    assert(following.has(42), 'Peer probes must execute inside the native frame')
    const value = { sp: stack, x0: new Pointer(0), x2: new Pointer(128), ...registers }
    callouts.get(offset)(value)
    return value
  }
  return { logs, hooks, callouts, state, probe, Pointer, unfollowed, data, originalInstructions, instructions, blocks, base, register, frame, invocations, excluded, following }
}

test('Frida socket diagnostics install no protected hooks or Stalker callouts', () => {
  const c = client(null)
  assert.deepEqual(c.hooks.map(hook => hook.address), ['connect', 'send', 'recv', 'close'])
  assert.equal(c.callouts.size, 0)
  assert.equal(c.logs.find(log => log.event === 'library-profile-matched').mode, 'sockets')
})

test('Frida refuses a different native build before activating the peer adapter', () => {
  const c = client('11'.repeat(32), false)
  assert.equal(c.callouts.size, 0)
  assert(c.logs.some(log => log.event === 'library-profile-mismatch'))
})

test('actual Stalker peer callouts produce matching Login and reply keys/nonces and erase temporaries', () => {
  const serverSecret = Buffer.alloc(32, 29)
  const peer = keyPair(serverSecret)
  const c = client(peer.publicKey.toString('hex'))
  assert.equal(c.callouts.size, 0, 'Registration alone must not trace a Java thread')
  assert(c.hooks.every(hook => typeof hook.address === 'string' || hook.address.value === 0x50001000))
  const transport = new NativeTransport(serverSecret)
  c.frame(() => {
    assert.equal(c.callouts.size, 6)
    c.state(login, 3)
    const keyPointer = c.probe(0x3bcc68).x2
    const raw = Buffer.from(keyPointer.readByteArray(32))
    const expected = diffieHellman({ privateKey: keyPair(Buffer.from(login.clientSecret, 'hex')).privateKey, publicKey: createPublicKey(peer.privateKey) })
    assert.deepEqual(raw, expected)
    const noncePointer = c.probe(0x3bcc84).x3
    assert.deepEqual(Buffer.from(keyPointer.readByteArray(32)), Buffer.alloc(32))
    const nonce = Buffer.from(noncePointer.readByteArray(24))
    assert.deepEqual(nonce, loginNonce(Buffer.from(login.clientPublicKey, 'hex'), peer.publicKey))
    const box = seal(Buffer.from(login.nativePaddedPlaintext, 'hex').subarray(32), nonce, core(Buffer.alloc(16), raw, true))
    transport.hello(Buffer.from(login.serverHelloNonce, 'hex'))
    assert.deepEqual(transport.decode({ id: 10101, payload: Buffer.concat([Buffer.from(login.clientPublicKey, 'hex'), box]) }), Buffer.from(login.loginPayload, 'hex'))
    c.probe(0x3bcc88)
    assert.deepEqual(Buffer.from(noncePointer.readByteArray(24)), Buffer.alloc(24))
    return 1
  })
  c.frame(() => {
    c.state(login, 4)
    const incomingKeyPointer = c.probe(0x27eab4).x2
    const incomingRaw = Buffer.from(incomingKeyPointer.readByteArray(32))
    const incomingNoncePointer = c.probe(0x27ead4).x3
    assert.deepEqual(Buffer.from(incomingKeyPointer.readByteArray(32)), Buffer.alloc(32))
    const incomingNonce = Buffer.from(incomingNoncePointer.readByteArray(24))
    assert.deepEqual(incomingNonce, replyNonce(Buffer.from(login.clientNonce, 'hex'), Buffer.from(login.clientPublicKey, 'hex'), peer.publicKey))
    const failedBox = transport.encode({ id: 20103, version: 4, payload: Buffer.from(failed.payload, 'hex') }).payload
    assert.deepEqual(open(failedBox, incomingNonce, core(Buffer.alloc(16), incomingRaw, true)).subarray(56), Buffer.from(failed.payload, 'hex'))
    c.probe(0x27ead8)
    assert.deepEqual(Buffer.from(incomingNoncePointer.readByteArray(24)), Buffer.alloc(24))
    return 1
  })
  assert.deepEqual(c.unfollowed, [42, 42])
  c.frame(() => 1)
  assert.equal(c.invocations.at(-1).settings.traps, undefined, 'Stop tracing after the authenticated reply')
  assert.deepEqual(c.unfollowed, [42, 42])
  for (let n = 0; n < c.instructions.length; n++) assert.deepEqual(c.blocks.get(c.base.value + c.instructions[n][0]), c.originalInstructions[n])
  const recorded = JSON.stringify(c.logs)
  for (const secret of [login.clientSecret, failed.clientSecret, serverSecret.toString('hex')]) assert(!recorded.includes(secret))
  assert(!c.logs.some(log => log.event === 'development-peer-error'))
  transport.close()
})

test('peer callouts reject invalid native key state without writing argument registers', () => {
  const c = client(keyPair(Buffer.alloc(32, 29)).publicKey.toString('hex'))
  c.state(login, 3)
  c.data.fill(0, 0x260, 0x280)
  const original = new c.Pointer(1234)
  c.frame(() => { assert.equal(c.probe(0x3bcc68, { x2: original }).x2, original); return 1 })
  assert(c.logs.some(log => log.event === 'development-peer-error' && log.message === 'Native client key pair mismatch'))
})

test('JNI bridge excludes ART, traces only the native invocation and forwards its arguments/result', () => {
  const c = client(keyPair(Buffer.alloc(32, 29)).publicKey.toString('hex'))
  assert.equal(c.callouts.size, 0)
  assert(c.excluded.some(range => range.base.value === 0x50000000))
  c.register()
  assert.equal(c.callouts.size, 0)
  assert.equal(c.frame((env, object) => { assert.equal(env.value, 17); assert.equal(object.value, 34); return 1 }), 1)
  assert.deepEqual(c.unfollowed, [42])
  assert.equal(c.frame(() => 0), 0)
  assert.deepEqual(c.unfollowed, [42, 42])
  assert(c.invocations.every(call => call.settings.traps === 'all' && call.settings.scheduling === 'cooperative'))
})

test('JNI observer leaves an unrelated registration table untouched', () => {
  const c = client(keyPair(Buffer.alloc(32, 29)).publicKey.toString('hex'))
  c.register(false)
  assert.equal(c.callouts.size, 0)
  assert(!c.logs.some(log => log.event === 'jni-frame-registered'))
})

test('JNI scope keeps an outer trace through nested native calls and unwinds on errors', () => {
  const c = client(keyPair(Buffer.alloc(32, 29)).publicKey.toString('hex'))
  c.frame(() => {
    assert.equal(c.frame(() => 1), 1)
    assert(c.following.has(42))
    return 0
  })
  assert.deepEqual(c.unfollowed, [42])
  assert.throws(() => c.frame(() => { throw new Error('native invocation failed') }), /native invocation failed/)
  assert.deepEqual(c.unfollowed, [42, 42])
  assert.equal(c.following.size, 0)
})
