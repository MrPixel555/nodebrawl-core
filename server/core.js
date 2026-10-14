'use strict'
const net = require('node:net')
const { EventEmitter } = require('node:events')
const { randomBytes } = require('node:crypto')
const { FrameDecoder, encodeFrame } = require('../lib/protocol/frame')
const { encodeMessage, decodeMessage, catalog, loginOk, loginFailed } = require('../lib/protocol/messages')
const { ProtocolError } = require('../lib/protocol/stream')

function createGameServer ({ store, homeProvider = null, handlers = new Map(), idleTimeout = 30000, maxConnections = 128, maxPayload = 1048576, logger = () => {} } = {}) {
  if (!store || typeof store.login !== 'function') throw new TypeError('Account store required')
  if (homeProvider !== null && typeof homeProvider !== 'function') throw new TypeError('Invalid Home provider')
  if (!(handlers instanceof Map) || [...handlers.values()].some(handler => typeof handler !== 'function')) throw new TypeError('Invalid message handlers')
  if (!Number.isInteger(idleTimeout) || idleTimeout < 1 || idleTimeout > 2147483647) throw new TypeError('Invalid idle timeout')
  if (!Number.isInteger(maxConnections) || maxConnections < 1) throw new TypeError('Invalid connection limit')
  if (!Number.isInteger(maxPayload) || maxPayload < 1 || maxPayload > 0xffffff) throw new TypeError('Invalid payload limit')
  if (typeof logger !== 'function') throw new TypeError('Invalid logger')
  const events = new EventEmitter()
  const clients = new Set()
  const statistics = { received: 0, sent: 0, unsupported: 0, malformed: 0, logins: 0 }
  const server = net.createServer(socket => {
    if (clients.size >= maxConnections) { socket.destroy(); return }
    clients.add(socket)
    socket.setNoDelay(true)
    socket.setTimeout(idleTimeout, () => socket.destroy())
    const session = { socket, state: 'connected', account: null, nonce: null }
    const decoder = new FrameDecoder({ maxPayload })
    let queue = Promise.resolve()
    let pending = 0
    session.send = (id, fields = {}, version = 0) => session.sendRaw(id, encodeMessage(id, fields), version)
    const sendBatch = frames => {
      if (socket.destroyed) return false
      const encoded = frames.map(({ id, payload, version = 0 }) => {
        if (!Buffer.isBuffer(payload) || payload.length > maxPayload) throw new ProtocolError('Outbound payload limit exceeded')
        return encodeFrame(id, version, payload)
      })
      const size = encoded.reduce((sum, frame) => sum + frame.length, 0)
      if (socket.writableLength + size > maxPayload * 2 + 14) throw new ProtocolError('Outbound queue limit exceeded')
      socket.write(Buffer.concat(encoded, size))
      statistics.sent += frames.length
      return true
    }
    session.sendRaw = (id, payload, version = 0) => sendBatch([{ id, payload, version }])
    const fail = (message, code = 1) => { session.send(20103, loginFailed(message, code), 4); session.state = 'failed'; socket.end() }
    async function handle (frame) {
      if (socket.destroyed || session.state === 'failed') return
      statistics.received++
      if (frame.id === 10100) {
        if (session.state !== 'connected') throw new ProtocolError('Unexpected ClientHello')
        const hello = decodeMessage(frame.id, frame.payload)
        session.hello = hello
        session.nonce = randomBytes(24)
        session.state = 'hello'
        session.send(20100, { nonce: session.nonce })
        events.emit('hello', session, hello)
      } else if (frame.id === 10101) {
        if (!['connected', 'hello'].includes(session.state)) throw new ProtocolError('Unexpected Login')
        const login = decodeMessage(frame.id, frame.payload)
        if (!homeProvider) { fail('Home data for this libg.so is not configured. A compatible player-state Home provider is required.'); return }
        const account = await store.login(login.field_0x80, login.field_0x88)
        if (socket.destroyed) return
        const home = await homeProvider(account, login)
        if (socket.destroyed) return
        if (!home || !Buffer.isBuffer(home.payload)) throw new Error('Home provider did not supply a payload')
        sendBatch([
          { id: 20758, payload: encodeMessage(20758, loginOk(account, login)), version: 1 },
          { id: 21217, payload: home.payload, version: home.version ?? 0 },
        ])
        session.account = account
        session.state = 'authenticated'
        statistics.logins++
        events.emit('login', session)
      } else if (frame.id === 10108) {
        if (session.state !== 'authenticated') throw new ProtocolError('KeepAlive before authentication')
        decodeMessage(frame.id, frame.payload)
        session.send(20108)
      } else {
        if (session.state !== 'authenticated') throw new ProtocolError('Message before authentication')
        const descriptor = catalog.get(frame.id)
        const fields = descriptor?.fields ? decodeMessage(frame.id, frame.payload) : null
        const handler = handlers.get(frame.id)
        if (handler) await handler(session, fields, frame)
        else {
          statistics.unsupported++
          logger({ event: 'unsupported-message', id: frame.id, length: frame.payload.length, codecAvailable: fields !== null })
          events.emit('unsupported', { id: frame.id, version: frame.version, length: frame.payload.length, fields })
        }
      }
    }
    socket.on('data', chunk => {
      try {
        const frames = decoder.push(chunk)
        pending += frames.length
        if (pending > 256) throw new ProtocolError('Inbound message queue limit exceeded')
        for (const frame of frames) {
          queue = queue.then(() => handle(frame)).catch(error => {
            if (session.state === 'failed') return
            if (error instanceof ProtocolError) statistics.malformed++
            logger({ event: 'session-error', error: error instanceof ProtocolError ? error.message : 'Internal server error' })
            try { fail(error instanceof ProtocolError ? error.message : 'Internal server error') } catch (_) { socket.destroy() }
          }).finally(() => { pending-- })
        }
      } catch (error) { statistics.malformed++; logger({ event: 'framing-error', error: error.message }); socket.destroy() }
    })
    socket.on('error', error => logger({ event: 'socket-error', error: error.code || 'socket error' }))
    socket.on('close', () => { clients.delete(socket); events.emit('disconnect', session) })
  })
  async function stop () { for (const client of clients) client.destroy(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  return { server, events, statistics, clients, stop }
}
module.exports = { createGameServer }
