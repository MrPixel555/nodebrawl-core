/* global Stalker */
'use strict'

// Callouts run in translated blocks. Never patch the original instructions.
// Identify probes by call site: Stalker owns LR translation on followed threads.
function createStalkerProbes (probes) {
  const callbacks = new Map(probes.map(probe => [probe.address.toString(), probe.callback]))
  const threads = new Set()
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
      // A scope may run once per frame; reclaim completed translation contexts.
      Stalker.garbageCollect()
    },
  }
}

module.exports = { createStalkerProbes }
