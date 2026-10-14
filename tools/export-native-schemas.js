'use strict'
const { schemaFor } = require('../lib/protocol/messages')
const inlineLoginStrings = new Set(['field_0x118', 'field_0x100', 'field_0xc8', 'field_0x130', 'field_0x158', 'field_0x170', 'field_0x188', 'field_0x1a0'])
const schemas = Object.fromEntries([10101, 20758, 20103].map(id => [id, schemaFor(id).map(field => ({
  ...field,
  object_offset: field.field.slice(6),
  storage: (id === 10101 && inlineLoginStrings.has(field.field)) || (id === 20758 && field.field === 'field_0x148') ? 'pointer' : 'field',
  invert: id === 20758 && field.field === 'field_0x140',
}))]))
console.log(JSON.stringify(schemas, null, 2))
