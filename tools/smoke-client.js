'use strict'
const net = require('node:net')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { FrameDecoder, encodeFrame } = require('../lib/protocol/frame')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')
const { keyPair, boxKey } = require('../lib/protocol/salsa17')
const { sealLogin, openLoginReply } = require('../lib/protocol/transport')
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
function finish (error) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  sharedKey?.fill(0)
  if (error) { console.error(error.message); socket.destroy(); process.exitCode = 1 } else socket.end()
}
const timer = setTimeout(() => finish(new Error('Protocol smoke test timed out')), 5000)
socket.on('connect', () => socket.write(encodeFrame(10100, 0, encodeMessage(10100, { field_0x84: 3, field_0x88: 1 }))))
socket.on('data', chunk => {
  try {
    for (const frame of decoder.push(chunk)) {
      if (stage === 'hello') {
        assert.equal(frame.id, 20100)
        const hello = decodeMessage(frame.id, frame.payload)
        assert.equal(hello.nonce.length, 24)
        stage = 'login'
        let payload = encodeMessage(10101, { field_0x90: 3, field_0x94: 1 })
        if (sharedKey) payload = sealLogin({ payload, sharedKey, clientNonce, clientPublicKey, serverPublicKey, serverHelloNonce: hello.nonce })
        socket.write(encodeFrame(10101, 4, payload))
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
  } catch (error) { finish(error) }
})
socket.on('error', error => finish(error))
socket.on('close', () => { if (stage !== 'done') finish(new Error('Connection closed before the expected LoginFailed')); else clearTimeout(timer) })
