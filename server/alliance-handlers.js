'use strict'

function createAllianceHandlers () {
  return new Map([[14783, async (session) => {
    // Advanced search uses its own result and popup consumer, not 25074.
    session.send(24184, { field_0x80: [] })
  }]])
}

module.exports = { createAllianceHandlers }
