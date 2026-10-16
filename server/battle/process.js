'use strict'
const path = require('node:path')
const { Worker } = require('node:worker_threads')

class BattleProcess {
  constructor (options, { timeout = 15000 } = {}) {
    this.worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: options, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 8 } })
    this.requests = new Map()
    this.sequence = 0
    this.timeout = timeout
    this.closed = false
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
      this.startTimer = setTimeout(() => this.fail(Error('Battle engine startup timed out')), timeout)
    })
    this.worker.on('message', message => {
      if (message.ready) { clearTimeout(this.startTimer); this.resolveReady(message); return }
      if (message.startupError) { this.fail(Error(message.startupError)); return }
      const pending = this.requests.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer); this.requests.delete(message.id)
      if (message.error) pending.reject(Error(message.error))
      else pending.resolve(message.result)
      if (message.fatal) this.fail(Error(message.error))
    })
    this.worker.on('error', error => this.fail(error))
    this.worker.on('exit', code => { if (!this.closed) this.fail(Error('Battle engine exited: ' + code)) })
  }

  call (action, fields = {}) {
    if (this.closed) return Promise.reject(Error('Battle engine is closed'))
    if (this.requests.size >= 128) return Promise.reject(Error('Battle engine request limit exceeded'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(Error('Battle engine operation timed out')), this.timeout)
      this.requests.set(id, { resolve, reject, timer })
      this.worker.postMessage({ id, action, ...fields })
    })
  }

  fail (error) {
    if (this.closed) return
    this.rejectReady(error)
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.requests.clear()
    this.close()
  }

  async close () {
    if (this.closed) return
    this.closed = true
    this.rejectReady(Error('Battle engine stopped'))
    clearTimeout(this.startTimer)
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(Error('Battle engine stopped')) }
    this.requests.clear()
    await this.worker.terminate()
  }
}

module.exports = { BattleProcess }
