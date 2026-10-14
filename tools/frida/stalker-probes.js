/* global Stalker, setTimeout */
'use strict'

// Callouts run in translated blocks. Never patch the original instructions.
// Identify probes by call site: Stalker owns LR translation on followed threads.
function createStalkerProbes (probes) {
  const callbacks = new Map(probes.map(probe => [probe.address.toString(), probe.callback]))
  const threads = new Set()
  let collectionQueued = false
  const controller = {
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
    stop () {
      for (const thread of Array.from(threads)) controller.unfollow(thread)
    },
  }
  return controller
}

module.exports = { createStalkerProbes }
