/* global Process, NativeFunction, NativeCallback */
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
      return traced(...args)
    } finally {
      if (started) options.probes.unfollow(thread)
      options.onLeave(thread)
    }
  }, returnType, argumentTypes)
}

module.exports = { createNativeFrame }
