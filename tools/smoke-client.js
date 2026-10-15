'use strict'
const net = require('node:net')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { FrameDecoder, encodeFrame } = require('../lib/protocol/frame')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')
const { keyPair, boxKey } = require('../lib/protocol/salsa17')
const { sealLogin, openLoginReply, SessionCipher } = require('../lib/protocol/transport')
const { createStarterHomeProvider } = require('../server/home')
const expectStarter = process.env.EXPECT_HOME === 'starter'
if (process.env.EXPECT_HOME && !['missing', 'starter'].includes(process.env.EXPECT_HOME)) throw new Error('EXPECT_HOME must be missing or starter')
const publicHex = process.env.SERVER_PUBLIC_KEY
if (publicHex && !/^[a-f0-9]{64}$/i.test(publicHex)) throw new Error('Invalid SERVER_PUBLIC_KEY')
const serverPublicKey = publicHex ? Buffer.from(publicHex, 'hex') : null
const secret = serverPublicKey ? randomBytes(32) : null
const clientPublicKey = secret ? keyPair(secret).publicKey : null
const clientNonce = secret ? randomBytes(24) : null
const sharedKey = secret ? boxKey(serverPublicKey, secret) : null
secret?.fill(0)
const socket = net.connect(Number(process.env.PORT || 9339), process.env.HOST || '127.0.0.1')
const decoder = new FrameDecoder()
let stage = 'hello'
let finished = false
let receiveCipher = null
let sendCipher = null
let account = null
let queue = Promise.resolve()
function finish (error) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  sharedKey?.fill(0)
  receiveCipher?.close()
  sendCipher?.close()
  if (error) { console.error(error.message); socket.destroy(); process.exitCode = 1 } else socket.end()
}
const timer = setTimeout(() => finish(new Error('Protocol smoke test timed out')), 5000)
socket.on('connect', () => socket.write(encodeFrame(10100, 0, encodeMessage(10100, { field_0x84: 3, field_0x88: 1 }))))
socket.on('data', chunk => {
  try {
    for (const frame of decoder.push(chunk)) queue = queue.then(() => handle(frame)).catch(finish)
  } catch (error) { finish(error) }
})
async function handle (frame) {
  if (finished) return
  if (stage === 'hello') {
    assert.equal(frame.id, 20100)
    const hello = decodeMessage(frame.id, frame.payload)
    assert.equal(hello.nonce.length, 24)
    stage = 'login'
    let payload = encodeMessage(10101, { field_0x90: 3, field_0x94: 1 })
    if (sharedKey) payload = sealLogin({ payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey, serverHelloNonce: hello.nonce })
    socket.write(encodeFrame(10101, 4, payload))
  } else if (stage === 'login' && expectStarter) {
    assert.equal(frame.id, 20758)
    let payload = frame.payload
    if (sharedKey) {
      const opened = openLoginReply({ box: payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey })
      receiveCipher = new SessionCipher(opened.sessionKey, opened.serverNonce)
      sendCipher = new SessionCipher(opened.sessionKey, clientNonce)
      opened.sessionKey.fill(0)
      payload = opened.payload
    }
    account = decodeMessage(20758, payload)
    assert.match(account.field_0x90, /^[a-f0-9]{40}$/)
    stage = 'home'
  } else if (stage === 'home') {
    assert.equal(frame.id, 21217)
    const payload = receiveCipher ? receiveCipher.decrypt(frame.payload) : frame.payload
    const expected = await createStarterHomeProvider()({ id: account.field_0x80, name: 'Player' })
    assert.deepEqual(payload, expected.payload)
    stage = 'alliance-search'
    for (const [id, fields] of [
      [10459, { field_0x80_0x8: 'smoke-client', field_0x80_0x20_json: '{"source":"smoke-client"}' }],
      [11485, {}],
      [16592, { field_0x80: 'smoke-check' }],
    ]) {
      const plain = encodeMessage(id, fields)
      socket.write(encodeFrame(id, 0, sendCipher ? sendCipher.encrypt(plain) : plain))
    }
  } else if (stage === 'alliance-search') {
    assert.equal(frame.id, 25074)
    const payload = receiveCipher ? receiveCipher.decrypt(frame.payload) : frame.payload
    assert.deepEqual(decodeMessage(25074, payload), { field_0x80: 'smoke-check', field_0x88: [] })
    stage = 'heartbeat'
    const body = sendCipher ? sendCipher.encrypt(Buffer.alloc(0)) : Buffer.alloc(0)
    socket.write(encodeFrame(10108, 0, body))
  } else if (stage === 'heartbeat') {
    assert.equal(frame.id, 20108)
    const payload = receiveCipher ? receiveCipher.decrypt(frame.payload) : frame.payload
    assert.equal(payload.length, 0)
    stage = 'done'
    finish()
    console.log(`PASS: ${sharedKey ? 'encrypted' : 'plaintext'} LoginOk, starter Home, startup receipts, empty clan search and heartbeat`)
    console.log('Starter Home matches its native codec profile; Android lobby and gameplay remain unverified.')
  } else {
    assert.equal(frame.id, 20103)
    assert.equal(frame.version, 4)
    let payload = frame.payload
    if (sharedKey) {
      const opened = openLoginReply({ box: payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey })
      payload = opened.payload
      opened.sessionKey.fill(0)
    }
    assert.match(decodeMessage(frame.id, payload).field_0x98, /compatible player-state Home provider/)
    stage = 'done'
    finish()
    console.log(`PASS: ${sharedKey ? 'encrypted' : 'plaintext'} ClientHello/ServerHello, Login and explicit missing-Home LoginFailed`)
    console.log('This verifies protocol startup only. It does not validate Android gameplay or a usable Home.')
  }
}
socket.on('error', error => finish(error))
socket.on('close', () => { if (stage !== 'done') finish(new Error('Connection closed before the expected protocol sequence')); else clearTimeout(timer) })
