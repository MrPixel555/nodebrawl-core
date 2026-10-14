'use strict'
const { main } = require('./server/main')
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
