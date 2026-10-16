'use strict'
const { decodeMessage } = require('../lib/protocol/messages')
const { ProtocolError } = require('../lib/protocol/stream')
const contentFiles = new Set(require('../content/fingerprint.json').files.map(entry => entry.file))
contentFiles.add('fingerprint.json')

function contentEvent (name, data) {
  const phases = new Map(['ContentDownloadStarted', 'ContentDownloadFailed', 'ContentDownloadSucceeded', 'MandatoryDownloadStarted', 'MandatoryDownloadFailed', 'MandatoryDownloadSucceeded'].map(name => [name, name]))
  const phase = [name, data?.type, data?.event, data?.event_name].find(value => phases.has(value))
  if (!phase) return null
  const event = { event: 'client-content-event', phase }
  const code = data?.error_code ?? (typeof data?.failCode === 'string' && /^-?\d{1,10}$/.test(data.failCode) ? Number(data.failCode) : null)
  if (Number.isInteger(code) && Math.abs(code) <= 2147483647) event.errorCode = code
  const downloadUrl = data?.download_url ?? (data?.product === 'download_url' ? data?.productDetail : null)
  if (typeof downloadUrl === 'string') {
    try {
      const url = new URL(downloadUrl)
      const filename = decodeURIComponent(url.pathname).replace(/^\/(?:[a-f0-9]{40}\/)?/, '')
      // Report only manifest-listed asset paths. Queries and arbitrary event
      // contents can contain private data and are deliberately not retained.
      if (contentFiles.has(filename)) { event.host = url.hostname; event.file = filename }
    } catch (_) {}
  }
  return event
}

function createStartupHandlers ({ logger = () => {}, traceNetwork = false } = {}) {
  return new Map([
    [16442, async (session) => {
      // The Party popup also requests server friends. No friend relations
      // exist yet. Type zero + allocated empty list uses two fixed int32s.
      session.sendRaw(21047, Buffer.alloc(8))
      if (traceNetwork) logger({ event: 'server-friends-sent', count: 0 })
    }],
    [10459, async (session, fields, frame) => {
      const data = fields || decodeMessage(10459, frame.payload)
      if (typeof data.field_0x80_0x8 !== 'string' || typeof data.field_0x80_0x20_json !== 'string') throw new ProtocolError('Invalid client metadata')
      let metadata
      try { metadata = JSON.parse(data.field_0x80_0x20_json) } catch (_) { throw new ProtocolError('Invalid client metadata JSON') }
      if (traceNetwork) {
        logger({ event: 'client-metadata-accepted', payloadBytes: frame.payload.length })
        const event = contentEvent(data.field_0x80_0x8, metadata)
        if (event) logger(event)
      }
    }],
    [11485, async (session, fields, frame) => {
      decodeMessage(11485, frame.payload)
      if (traceNetwork) logger({ event: 'client-ui-startup-notice' })
    }],
    [13752, async (session, fields, frame) => {
      // Native 0x682aac sends a measured float*1000 and socket-derived string.
      // This is a report receipt; keep the client's address and values private.
      decodeMessage(13752, frame.payload)
      if (traceNetwork) logger({ event: 'client-network-report', payloadBytes: frame.payload.length })
    }],
  ])
}

module.exports = { createStartupHandlers, contentEvent }
