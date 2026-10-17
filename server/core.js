'use strict'
const net = require('node:net')
const { EventEmitter } = require('node:events')
const { randomBytes } = require('node:crypto')
const { FrameDecoder, encodeFrame } = require('../lib/protocol/frame')
const { encodeMessage, decodeMessage, schemaFor, loginOk, loginFailed } = require('../lib/protocol/messages')
const { ProtocolError } = require('../lib/protocol/stream')
const { contentUrl } = require('./content')

function createGameServer ({ store, homeProvider = null, handlers = new Map(), transportFactory = null, idleTimeout = 30000, maxConnections = 128, maxPayload = 1048576, logger = () => {}, traceNetwork = false, contentUrls = [], loginResponseProvider = null } = {}) {
  if (!Array.isArray(contentUrls) || contentUrls.length > 8) throw new TypeError('Invalid content URLs')
  contentUrls = contentUrls.map(contentUrl)
  if (!store || typeof store.login !== 'function') throw new TypeError('Account store required')
  if (transportFactory !== null && typeof transportFactory !== 'function') throw new TypeError('Invalid transport factory')
  if (loginResponseProvider !== null && typeof loginResponseProvider !== 'function') throw new TypeError('Invalid login response provider')
  if (homeProvider !== null && typeof homeProvider !== 'function') throw new TypeError('Invalid Home provider')
  if (!(handlers instanceof Map) || [...handlers.values()].some(handler => typeof handler !== 'function')) throw new TypeError('Invalid message handlers')
  if (!Number.isInteger(idleTimeout) || idleTimeout < 1 || idleTimeout > 2147483647) throw new TypeError('Invalid idle timeout')
  if (!Number.isInteger(maxConnections) || maxConnections < 1) throw new TypeError('Invalid connection limit')
  if (!Number.isInteger(maxPayload) || maxPayload < 1 || maxPayload > 0xffffff) throw new TypeError('Invalid payload limit')
  if (typeof logger !== 'function') throw new TypeError('Invalid logger')
  if (typeof traceNetwork !== 'boolean') throw new TypeError('Invalid network tracing option')
  const events = new EventEmitter()
  const clients = new Set()
  const statistics = { received: 0, sent: 0, unsupported: 0, malformed: 0, logins: 0 }
  let nextConnection = 1
  const server = net.createServer(socket => {
    if (clients.size >= maxConnections) { socket.destroy(); return }
    let transport = null
    try {
      transport = transportFactory ? transportFactory() : null
      if (transportFactory && (!transport || ['decode', 'hello', 'encode', 'overhead', 'close'].some(name => typeof transport[name] !== 'function'))) throw new TypeError('Invalid transport instance')
    } catch (_) { socket.destroy(); return }
    clients.add(socket)
    const connectionId = nextConnection++
    const traffic = { receivedBytes: 0, sentBytes: 0, receivedFrames: 0, sentFrames: 0 }
    let closeReason = 'closed'
    const trace = entry => { if (traceNetwork) logger({ connectionId, ...entry }) }
    socket.setNoDelay(true)
    socket.setTimeout(idleTimeout, () => { closeReason = 'idle-timeout'; socket.destroy() })
    const session = { socket, state: 'connected', account: null, nonce: null }
    trace({ event: 'connection-open', state: session.state })
    const decoder = new FrameDecoder({ maxPayload })
    let queue = Promise.resolve()
    let pending = 0
    session.send = (id, fields = {}, version = 0) => session.sendRaw(id, encodeMessage(id, fields), version)
    const sendBatch = frames => {
      if (socket.destroyed) return false
      let estimatedSize = 0
      const plainFrames = frames.map(({ id, payload, version = 0 }) => {
        const overhead = transport ? transport.overhead(id) : 0
        if (!Buffer.isBuffer(payload) || payload.length + overhead > maxPayload) throw new ProtocolError('Outbound payload limit exceeded')
        estimatedSize += payload.length + overhead + 7
        return encodeFrame(id, version, payload)
      })
      if (socket.writableLength + estimatedSize > maxPayload * 2 + 14) throw new ProtocolError('Outbound queue limit exceeded')
      const encoded = transport ? frames.map(frame => { const transformed = transport.encode(frame); return encodeFrame(transformed.id, transformed.version ?? 0, transformed.payload) }) : plainFrames
      const size = encoded.reduce((sum, frame) => sum + frame.length, 0)
      socket.write(Buffer.concat(encoded, size))
      statistics.sent += frames.length
      traffic.sentBytes += size
      traffic.sentFrames += encoded.length
      for (const frame of encoded) trace({ event: 'message-sent', id: frame.readUInt16BE(0), version: frame.readUInt16BE(5), payloadBytes: frame.length - 7, state: session.state })
      return true
    }
    session.sendRaw = (id, payload, version = 0) => sendBatch([{ id, payload, version }])
    const fail = (message, code = 1) => { session.send(20103, loginFailed(message, code), 4); session.state = 'failed'; socket.end() }
    async function handle (frame) {
      if (socket.destroyed || session.state === 'failed') return
      statistics.received++
      traffic.receivedFrames++
      trace({ event: 'message-received', id: frame.id, version: frame.version, payloadBytes: frame.payload.length, state: session.state })
      if (transport) frame = { ...frame, payload: transport.decode(frame) }
      if (frame.id === 10100) {
        if (session.state !== 'connected') throw new ProtocolError('Unexpected ClientHello')
        const hello = decodeMessage(frame.id, frame.payload)
        session.hello = hello
        session.nonce = randomBytes(24)
        session.state = 'hello'
        if (transport) transport.hello(session.nonce)
        session.send(20100, { nonce: session.nonce })
        events.emit('hello', session, hello)
      } else if (frame.id === 10101) {
        if (!['connected', 'hello'].includes(session.state)) throw new ProtocolError('Unexpected Login')
        const login = decodeMessage(frame.id, frame.payload)
        if (!homeProvider) { fail('Home data for this libg.so is not configured. A compatible player-state Home provider is required.'); return }
        const account = await store.login(login.field_0x80, login.field_0x88)
        trace({ event: 'account-login', kind: login.field_0x80.every(part => part === 0) ? 'created' : 'resumed' })
        if (socket.destroyed) return
        session.account = account
        const resumed = loginResponseProvider ? await loginResponseProvider(session) : null
        const home = resumed || await homeProvider(session.account, login)
        if (socket.destroyed) return
        if (!home || !Buffer.isBuffer(home.payload)) throw new Error('Home provider did not supply a payload')
        sendBatch([
          { id: 20758, payload: encodeMessage(20758, loginOk(session.account, login, new Date(), contentUrls)), version: 1 },
          { id: home.id ?? 21217, payload: home.payload, version: home.version ?? 0 },
        ])
        session.state = 'authenticated'
        statistics.logins++
        trace({ event: 'login-accepted', state: session.state, homeBytes: home.payload.length })
        events.emit('login', session)
      } else if (frame.id === 10108) {
        if (session.state !== 'authenticated') throw new ProtocolError('KeepAlive before authentication')
        decodeMessage(frame.id, frame.payload)
        session.send(20108)
      } else {
        if (session.state !== 'authenticated') throw new ProtocolError('Message before authentication')
        let codecAvailable = true
        try { schemaFor(frame.id) } catch (_) { codecAvailable = false }
        // Turn handlers must handle unknown nested command types atomically.
        const fields = codecAvailable && frame.id !== 13597 ? decodeMessage(frame.id, frame.payload) : null
        const handler = handlers.get(frame.id)
        if (handler) await handler(session, fields, frame)
        else {
          statistics.unsupported++
          logger({ event: 'unsupported-message', connectionId, id: frame.id, length: frame.payload.length, codecAvailable })
          if (traceNetwork && [10953, 17967].includes(frame.id)) logger({ event: 'training-request-data', npc: frame.id === 17967 ? fields.field_0x80 : fields.field_0x88, mode: frame.id === 10953 ? fields.field_0x80 : null })
          events.emit('unsupported', { id: frame.id, version: frame.version, length: frame.payload.length, fields })
        }
      }
    }
    socket.on('data', chunk => {
      traffic.receivedBytes += chunk.length
      trace({ event: 'bytes-received', bytes: chunk.length, state: session.state })
      try {
        const frames = decoder.push(chunk)
        pending += frames.length
        if (pending > 256) throw new ProtocolError('Inbound message queue limit exceeded')
        for (const frame of frames) {
          queue = queue.then(() => handle(frame)).catch(error => {
            if (session.state === 'failed') return
            if (error instanceof ProtocolError) statistics.malformed++
            logger({ event: 'session-error', connectionId, id: frame.id, version: frame.version, payloadBytes: frame.payload.length, state: session.state, error: error instanceof ProtocolError ? error.message : 'Internal server error' })
            try { fail(error instanceof ProtocolError ? error.message : 'Internal server error') } catch (_) { socket.destroy() }
          }).finally(() => { pending-- })
        }
      } catch (error) { statistics.malformed++; logger({ event: 'framing-error', connectionId, error: error.message }); socket.destroy() }
    })
    socket.on('end', () => { closeReason = 'peer-ended' })
    socket.on('error', error => { closeReason = error.code || 'socket-error'; logger({ event: 'socket-error', connectionId, error: error.code || 'socket error' }) })
    socket.on('close', () => {
      trace({ event: 'connection-close', state: session.state, reason: closeReason, ...traffic })
      transport?.close(); clients.delete(socket); events.emit('disconnect', session)
    })
  })
  async function stop () { for (const client of clients) client.destroy(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  return { server, events, statistics, clients, stop }
}
module.exports = { createGameServer }
