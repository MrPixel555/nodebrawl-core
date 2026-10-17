'use strict'
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const moduleFactory = require('./runtime').loadBattleRuntime()
const imports = require('./imports.json')
const { library_sha256: libraryHash } = require('../../lib/protocol/libg-profile.json')

class NativeVM {
  static async create () {
    const api = await moduleFactory()
    return new NativeVM(api)
  }

  constructor (api) {
    this.api = api
    this.cpu = new api.Unicorn(api.ARCH_ARM64, api.MODE_ARM)
    this.hooks = new Map()
    this.handles = []
    this.allocated = new Map()
    this.freeBlocks = []
    this.mutexes = new Set()
    this.stop = 0x20001000
    const root = path.join(__dirname, 'image')
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')))
    if (manifest.librarySha256 !== libraryHash || manifest.blocks.length !== 3 || manifest.heap < 0x10000000 || manifest.heap >= 0x18000000) throw Error('Battle image does not match the client')
    const blocks = manifest.blocks.map(block => {
      if (!/^block-[0-2]\.zlib$/.test(block.file) || block.size < 1 || block.size > 0x4000000) throw Error('Invalid battle image block')
      const bytes = zlib.inflateSync(fs.readFileSync(path.join(root, block.file)), { maxOutputLength: block.size })
      if (bytes.length !== block.size || crypto.createHash('sha256').update(bytes).digest('hex') !== block.sha256) throw Error('Bad native image')
      return { ...block, bytes }
    })
    this.cpu.mem_map(0, Math.ceil((blocks[0].size + 4096) / 4096) * 4096, api.PROT_ALL)
    this.cpu.mem_map(0x10000000, 0x10000000, api.PROT_ALL)
    this.cpu.mem_map(0x20000000, 0x200000, api.PROT_ALL)
    const regions = [[4096, blocks[0].size], [0x10000000, manifest.heap - 0x10000000], [0x20000000, 0x200000]]
    for (const [index, block] of blocks.entries()) {
      if (block.address !== regions[index][0] || block.size !== regions[index][1]) throw Error('Invalid battle image region')
      this.write(block.address, block.bytes)
    }
    this.cpu.mem_protect(0, 4096, api.PROT_NONE)
    this.heap = manifest.heap
    this.reg('SP', 0x201f0000)
    this.reg('TPIDR_EL0', 0x20000000)
    for (const item of imports) this.qword(item.slot, item.address)
    // One bounded PLT hook: separate point hooks force range checks for every
    // emulated instruction and made an otherwise identical battle ten times slower.
    const importMap = new Map(imports.map(item => [BigInt(item.address), item.name]))
    this.handles.push(this.cpu.hook_add(api.HOOK_CODE, (cpu, address) => { const name = importMap.get(address); if (!name) throw Error('Unexpected PLT instruction'); this.import(name) }, undefined, imports[0].address, imports.at(-1).address))
    this.hook(0x736afc, () => { throw Error('Native diagnostic: ' + this.string(this.reg(0))) })
    this.handles.push(this.cpu.hook_add(api.HOOK_INTR, (cpu, no) => {
      if (this.reg(8) !== 169) throw Error('Unsupported battle syscall ' + this.reg(8))
      this.write(this.reg(0), Buffer.from('01000000000000000000000000000000', 'hex'))
      this.reg(0, 0)
    }))
  }

  reg (name, value) {
    const id = this.api['ARM64_REG_' + (typeof name === 'number' ? 'X' + name : name)]
    if (id === undefined) throw Error('Bad register ' + name)
    if (value === undefined) {
      const result = this.cpu.reg_read_i64(id)
      return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : result
    }
    this.cpu.reg_write_i64(id, BigInt.asUintN(64, BigInt(value)))
  }

  read (address, size) {
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(size) || size < 0 || size > 0x400000) throw Error('Invalid battle memory read')
    return Buffer.from(this.cpu.mem_read(address, size))
  }

  write (address, bytes) { this.cpu.mem_write(address, bytes) }
  integer (address, value) {
    if (value === undefined) return this.read(address, 4).readInt32LE()
    const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); this.write(address, bytes)
  }

  qword (address, value) {
    if (value === undefined) return Number(this.read(address, 8).readBigUInt64LE())
    const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value))); this.write(address, bytes)
  }

  alloc (size) {
    if (!Number.isSafeInteger(size) || size < 0 || size > 0x400000) throw Error('Bad allocation ' + size)
    const aligned = Math.ceil(Math.max(size, 16) / 16) * 16
    const i = this.freeBlocks.findIndex(block => block.size >= aligned)
    let pointer
    if (i >= 0) { const block = this.freeBlocks.splice(i, 1)[0]; pointer = block.address; if (block.size > aligned) this.freeBlocks.push({ address: pointer + aligned, size: block.size - aligned }) } else {
      pointer = this.heap; this.heap += aligned
      if (this.heap > 0x20000000) throw Error('Native heap exhausted')
    }
    this.allocated.set(pointer, aligned)
    this.write(pointer, Buffer.alloc(aligned))
    return pointer
  }

  free (address) {
    const size = this.allocated.get(address)
    if (size) { this.allocated.delete(address); this.freeBlocks.push({ address, size }) }
  }

  string (address) {
    const parts = []
    for (let n = 0; n < 100000; n += 128) {
      const block = this.read(address + n, Math.min(128, 4096 - ((address + n) & 4095)))
      const zero = block.indexOf(0)
      if (zero >= 0) return Buffer.concat([...parts, block.subarray(0, zero)]).toString('utf8')
      parts.push(block)
      if (block.length !== 128) n -= 128 - block.length
    }
    throw Error('Unterminated native string')
  }

  hook (address, callback) {
    if (!this.hooks.has(address)) this.handles.push(this.cpu.hook_add(this.api.HOOK_CODE, () => this.hooks.get(address)(), undefined, address, address))
    this.hooks.set(address, callback)
  }

  ret (value = 0) { this.reg(0, value); this.reg('PC', this.reg('LR')) }
  call (address, ...args) {
    const entry = address
    args.forEach((value, n) => this.reg(n, value))
    this.reg('LR', this.stop)
    for (let n = 0; n < 2; n++) {
      try { this.cpu.emu_start(address, this.stop, 0, 10000000) } catch (error) { throw Error(String(error) + '; entry=0x' + entry.toString(16) + '; PC=0x' + this.reg('PC').toString(16)) }
      address = this.reg('PC')
      if (address === this.stop) return this.reg(0)
    }
    throw Error('Native budget exhausted at ' + address.toString(16))
  }

  import (name) {
    const a = this.reg(0), b = this.reg(1), c = this.reg(2)
    if (['newlocale', 'freelocale', 'uselocale', 'strtoll_l', 'strtoull_l', '__errno', '__ctype_get_mb_cur_max', 'mbtowc'].includes(name)) return this.locale(name, a, b, c)
    switch (name) {
      case 'malloc': case '_Znwm': case '_Znam': return this.ret(this.alloc(a))
      case 'calloc': return this.ret(this.alloc(a * b))
      case 'free': case '_ZdlPv': case '_ZdaPv': this.free(a); return this.ret()
      case 'memcpy': case 'memmove': case '__memcpy_chk': case '__memmove_chk': this.write(a, this.read(b, c)); return this.ret(a)
      case 'memset': case '__memset_chk': this.write(a, Buffer.alloc(c, b & 255)); return this.ret(a)
      case 'strlen': return this.ret(Buffer.byteLength(this.string(a)))
      case 'strnlen': { const bytes = this.read(a, b); const zero = bytes.indexOf(0); return this.ret(zero < 0 ? b : zero) }
      case 'strcmp': return this.ret(Math.sign(Buffer.compare(Buffer.from(this.string(a)), Buffer.from(this.string(b)))))
      case 'strcasecmp': return this.ret(Math.sign(Buffer.compare(Buffer.from(this.string(a).replace(/[A-Z]/g, x => x.toLowerCase())), Buffer.from(this.string(b).replace(/[A-Z]/g, x => x.toLowerCase())))))
      case 'strcpy': { const text = Buffer.from(this.string(b) + '\0'); this.write(a, text); return this.ret(a) }
      case 'strncpy': { const text = Buffer.alloc(c); Buffer.from(this.string(b)).copy(text); this.write(a, text); return this.ret(a) }
      case 'memcmp': return this.ret(Math.sign(Buffer.compare(this.read(a, c), this.read(b, c))))
      case 'atoi': {
        const value = Number(this.string(a).match(/^[\t\n\v\f\r ]*([+-]?[0-9]+)/)?.[1] || 0)
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw Error('Battle atoi overflow')
        return this.ret(value)
      }
      case 'gettimeofday': case 'clock_gettime': this.qword(name === 'gettimeofday' ? a : b, 1); this.qword((name === 'gettimeofday' ? a : b) + 8, 0); return this.ret()
      case 'time': if (a) this.qword(a, 1); return this.ret(1)
      case 'pthread_mutex_lock': if (this.mutexes.has(a)) throw Error('Native lock contention'); this.mutexes.add(a); return this.ret()
      case 'pthread_mutex_unlock': if (!this.mutexes.delete(a)) throw Error('Native lock ownership'); return this.ret()
      case 'pthread_mutex_init': case 'pthread_mutex_destroy': this.mutexes.delete(a); return this.ret()
      case 'pthread_self': return this.ret(0x20000000)
      case 'pthread_cond_broadcast': case 'pthread_cond_signal': case '__cxa_atexit': case '__cxa_guard_abort': return this.ret()
      case '__cxa_guard_acquire': return this.ret(this.read(a, 1)[0] ? 0 : 1)
      case '__cxa_guard_release': this.write(a, Buffer.from([1])); return this.ret()
      case 'getpid': return this.ret(process.pid)
      default: throw Error('Unsupported native import: ' + name + ' at ' + this.reg('PC').toString(16))
    }
  }

  locale (name, a, b, c) {
    const state = 0x20001800, global = 0xffffffffffffffffn
    const active = this.read(state, 8).readBigUInt64LE() || global
    const check = pointer => {
      if (pointer === global) return
      if (typeof pointer === 'bigint') pointer = Number(pointer)
      if (pointer < 0x10000000 || pointer >= this.heap || this.read(pointer, 8).toString('hex') !== '564d4c4f432d4300') throw Error('Invalid battle C locale')
    }
    if (name === '__errno') return this.ret(state + 8)
    if (name === '__ctype_get_mb_cur_max') { check(active); return this.ret(1) }
    if (name === 'newlocale') {
      if (!['C', 'POSIX'].includes(this.string(b))) throw Error('Unsupported battle locale')
      if (c) { check(c); if (c === global) throw Error('Invalid newlocale base'); return this.ret(c) }
      const pointer = this.alloc(16); this.write(pointer, Buffer.from('VMLOC-C\0')); return this.ret(pointer)
    }
    if (name === 'uselocale') { if (a) { check(a); this.qword(state, a) }; return this.ret(active) }
    if (name === 'freelocale') { check(a); if (a === global || BigInt(a) === active) throw Error('Invalid freelocale'); this.write(a, Buffer.alloc(8)); return this.ret() }
    if (name === 'mbtowc') {
      check(active)
      if (!b) return this.ret()
      const value = c ? this.read(b, 1)[0] : 128
      if (value >= 128) { this.integer(state + 8, 84); return this.ret(-1) }
      if (a) this.integer(a, value)
      return this.ret(value ? 1 : 0)
    }
    check(this.reg(3))
    if (c !== 0 && (c < 2 || c > 36)) throw Error('Invalid battle integer base')
    const text = this.string(a), prefix = text.match(/^[\t\n\v\f\r ]*([+-]?)/)[0]
    let position = prefix.length
    const negative = prefix.endsWith('-')
    const hex = /^0x[0-9a-f]/i.test(text.slice(position))
    const base = c || (hex ? 16 : text[position] === '0' ? 8 : 10)
    if (base === 16 && hex) position += 2
    const start = position, unsigned = name === 'strtoull_l'
    const limit = unsigned ? (1n << 64n) - 1n : negative ? 1n << 63n : (1n << 63n) - 1n
    let value = 0n, overflow = false
    for (; position < text.length; position++) {
      const digit = parseInt(text[position], 36)
      if (!Number.isInteger(digit) || digit >= base) break
      value = value * BigInt(base) + BigInt(digit)
      if (value > limit) { value = limit; overflow = true }
    }
    if (position === start) position = 0
    if (b) this.qword(b, a + position)
    if (overflow) this.integer(state + 8, 34)
    if (negative && !(unsigned && overflow)) value = -value
    return this.ret(value)
  }

  nativeString (text) {
    const data = Buffer.from(text + '\0'), pointer = this.alloc(data.length), object = this.alloc(24)
    this.write(pointer, data); this.call(0x65612c, object, pointer); this.free(pointer)
    return object
  }

  json (value) {
    const string = this.nativeString(JSON.stringify(value))
    const object = this.call(0x73b08c, string)
    this.call(0x466ef0, string); this.free(string)
    if (!object) throw Error('Native battle JSON parse failed')
    return object
  }

  stream (payload = Buffer.alloc(0)) {
    const stream = this.alloc(0x70), buffer = this.alloc(Math.max(payload.length, 0x10000))
    this.write(buffer, payload)
    this.qword(stream, 0xa3ec88); this.integer(stream + 0x18, payload.length)
    this.qword(stream + 0x20, buffer); this.integer(stream + 0x28, Math.max(payload.length, 0x10000)); this.integer(stream + 0x2c, payload.length)
    return { stream, buffer }
  }

  close () { this.cpu.close() }
}
module.exports = { NativeVM }
