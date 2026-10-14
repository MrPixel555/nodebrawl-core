'use strict'
const { randomBytes } = require('node:crypto')
const { ProtocolError } = require('../lib/protocol/stream')
const { keyPair } = require('../lib/protocol/salsa17')
const { openLogin, sealLoginReply, SessionCipher } = require('../lib/protocol/transport')

class NativeTransport {
  constructor (serverSecret) {
    this.serverSecret = Buffer.from(serverSecret)
    this.serverPublicKey = keyPair(this.serverSecret).publicKey
    this.state = 'connected'
    this.handshake = null
    this.receiveCipher = null
    this.sendCipher = null
  }

  hello (nonce) {
    if (this.state !== 'connected') throw new ProtocolError('Unexpected transport hello')
    this.helloNonce = Buffer.from(nonce)
    this.state = 'hello'
  }

  decode (frame) {
    if (frame.id === 10100 && this.state === 'connected') return frame.payload
    if (frame.id === 10101 && this.state === 'hello') {
      this.handshake = openLogin({ box: frame.payload, serverSecret: this.serverSecret, serverPublicKey: this.serverPublicKey, serverHelloNonce: this.helloNonce })
      this.serverSecret.fill(0)
      this.state = 'login'
      return this.handshake.payload
    }
    if (this.state !== 'authenticated') throw new ProtocolError('Message before encrypted authentication')
    return this.receiveCipher.decrypt(frame.payload)
  }

  overhead (id) {
    if (id === 20100) return 0
    if (this.state === 'login' && [20758, 20103].includes(id)) return 72
    return 16
  }

  encode (frame) {
    if (frame.id === 20100 && this.state === 'hello') return frame
    if (this.state === 'login' && [20758, 20103].includes(frame.id)) {
      const serverNonce = randomBytes(24)
      const sessionKey = randomBytes(32)
      const payload = sealLoginReply({ ...this.handshake, payload: frame.payload, serverNonce, sessionKey, serverPublicKey: this.serverPublicKey })
      this.receiveCipher = new SessionCipher(sessionKey, this.handshake.clientNonce)
      this.sendCipher = new SessionCipher(sessionKey, serverNonce)
      this.handshake.sharedKey.fill(0)
      this.handshake = null
      sessionKey.fill(0)
      this.state = 'authenticated'
      return { ...frame, payload }
    }
    if (this.state !== 'authenticated') throw new ProtocolError('Cannot encrypt response before Login')
    return { ...frame, payload: this.sendCipher.encrypt(frame.payload) }
  }

  close () {
    this.serverSecret.fill(0)
    this.handshake?.sharedKey.fill(0)
    this.handshake = null
    this.sendCipher?.close()
    this.receiveCipher?.close()
    this.state = 'closed'
  }
}
module.exports = { NativeTransport }
