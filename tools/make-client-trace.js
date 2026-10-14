'use strict'
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const args = process.argv.slice(2)
let host = null
let port = 9339
let output = null
for (let n = 0; n < args.length; n += 2) {
  if (args[n] === '--host') host = args[n + 1]
  else if (args[n] === '--port') port = Number(args[n + 1])
  else if (args[n] === '--output') output = args[n + 1]
  else throw new Error('Usage: node tools/make-client-trace.js [--host IPv4] [--port 9339] --output FILE')
}
if (!output || (host !== null && net.isIP(host) !== 4) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Valid output, IPv4 host (optional) and port are required')
const source = fs.readFileSync(path.join(__dirname, 'frida/client-trace.js'), 'utf8')
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, `const configuration = ${JSON.stringify({ host, port })}\n` + source, { flag: 'wx' })
console.log(`Created ${output}; logs metadata only; ${host ? `redirects port 9339 to ${host}:${port}` : 'keeps the original connection address'}.`)
console.log('This script does not change client encryption or supply a compatible Home.')
