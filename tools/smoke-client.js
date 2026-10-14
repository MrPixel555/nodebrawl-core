'use strict'
const net = require('node:net')
const assert = require('node:assert/strict')
const { FrameDecoder, encodeFrame } = require('../lib/protocol/frame')
const { encodeMessage, decodeMessage } = require('../lib/protocol/messages')
const socket = net.connect(Number(process.env.PORT || 9339), process.env.HOST || '127.0.0.1')
const decoder = new FrameDecoder()
let stage = 'hello'
const timer = setTimeout(() => { console.error('Protocol smoke test timed out'); socket.destroy(); process.exitCode = 1 }, 5000)
socket.on('connect', () => socket.write(encodeFrame(10100, 0, encodeMessage(10100, { field_0x84: 3, field_0x88: 1 }))))
socket.on('data', chunk => {
  try {
    for (const frame of decoder.push(chunk)) {
      if (stage === 'hello') {
        assert.equal(frame.id, 20100)
        assert.equal(decodeMessage(frame.id, frame.payload).nonce.length, 24)
        stage = 'login'
        socket.write(encodeFrame(10101, 4, encodeMessage(10101, { field_0x90: 3, field_0x94: 1 })))
      } else {
        assert.equal(frame.id, 20103)
        assert.equal(frame.version, 4)
        assert.match(decodeMessage(frame.id, frame.payload).field_0x98, /compatible player-state Home provider/)
        clearTimeout(timer)
        socket.end()
        console.log('PASS: native ClientHello/ServerHello framing and explicit missing-Home LoginFailed response')
        console.log('This verifies protocol startup only. It does not validate gameplay or encrypted-client compatibility.')
      }
    }
  } catch (error) { clearTimeout(timer); console.error(error.message); socket.destroy(); process.exitCode = 1 }
})
socket.on('error', error => { clearTimeout(timer); console.error(error.message); process.exitCode = 1 })
