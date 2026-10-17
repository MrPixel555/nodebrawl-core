'use strict'

function createAllianceHandlers ({ store, logger = () => {}, battles } = {}) {
  return new Map([[14783, async (session, fields = {}) => {
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
    logger({ event: 'alliance-created', members: 1 })
  }]])
}

module.exports = { createAllianceHandlers }
