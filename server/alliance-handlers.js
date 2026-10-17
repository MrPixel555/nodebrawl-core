'use strict'
const { equalId, agedEntries } = require('./alliances')
const { ProtocolError } = require('../lib/protocol/stream')

function createAllianceHandlers ({ store, logger = () => {}, battles } = {}) {
  const sessions = new Set()
  const members = session => [...sessions].filter(other => !other.socket.destroyed && equalId(other.account?.alliance?.id, session.account.alliance?.id))
  const handlers = new Map([[14783, async (session, fields = {}) => {
    // Advanced search uses its own result and popup consumer, not 25074.
    session.send(24184, { field_0x80: store ? await store.listAlliances(fields.field_0x80 || '') : [] })
  }], [10453, async (session, fields) => {
    if (!store || battles?.active(session)) return
    const { account, data } = await store.createAlliance(session.account, fields)
    session.account = account
    // This native server command performs the client-side debit and membership
    // transition. Sending a Home with the already-debited balance first would
    // charge the client cache twice.
    session.send(22192, {
      field_0x80: {
        id: 477,
        fields: {
          field_0x20: account.alliance.id,
          field_0x30: account.alliance.name,
          field_0x28: account.alliance.badge,
          field_0x38: true,
        },
      },
    })
    session.send(28165, { field_0x80: data })
    session.send(21822, { entries: [] })
    logger({ event: 'alliance-created', members: 1 })
  }], [11632, async (session, fields) => {
    if (!store || battles?.active(session)) return
    try {
      const result = await store.socialAction(session.account, 'chat', fields)
      session.account = result.account
      const entry = agedEntries([result.entry])[0]
      for (const member of members(session)) member.send(21749, { entry })
      if (!sessions.has(session)) session.send(21749, { entry })
      logger({ event: 'clan-chat-sent' })
    } catch (error) { if (!(error instanceof ProtocolError)) throw error; logger({ event: 'clan-action-rejected', action: 'chat', reason: error.message }) }
  }], [13882, async (session, fields) => {
    if (!store || battles?.active(session)) return
    try {
      const result = await store.socialAction(session.account, 'settings', fields)
      session.account = result.account
      const targets = members(session)
      if (!targets.includes(session)) targets.push(session)
      for (const member of targets) {
        member.account = await store.login(member.account.id, member.account.token)
        member.send(28165, { field_0x80: result.data })
      }
      logger({ event: 'clan-settings-updated' })
    } catch (error) { if (!(error instanceof ProtocolError)) throw error; logger({ event: 'clan-action-rejected', action: 'settings', reason: error.message }) }
  }]])
  handlers.login = async session => {
    sessions.add(session)
    if (!session.account.alliance) return
    const data = await store.findAlliance(session.account.alliance.id)
    if (data && !session.socket.destroyed) {
      session.send(28165, { field_0x80: data })
      session.send(21822, { entries: await store.clanChat(session.account) })
    }
  }
  handlers.disconnect = session => sessions.delete(session)
  handlers.broadcastMail = async session => {
    for (const member of members(session)) {
      member.account = await store.login(member.account.id, member.account.token)
      if (!member.socket.destroyed) member.send(28299, { entries: agedEntries(member.account.mail) })
    }
  }
  return handlers
}

module.exports = { createAllianceHandlers }
