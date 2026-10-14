'use strict'
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const args = process.argv.slice(2)
let host = null
let port = 9339
let output = null
let serverPublicKey = null
for (let n = 0; n < args.length; n += 2) {
  if (args[n] === '--host') host = args[n + 1]
  else if (args[n] === '--port') port = Number(args[n + 1])
  else if (args[n] === '--server-public-key') serverPublicKey = args[n + 1]
  else if (args[n] === '--output') output = args[n + 1]
  else throw new Error('Usage: node tools/make-client-trace.js [--host IPv4] [--port 9339] [--server-public-key HEX] --output FILE')
}
if ((serverPublicKey !== null && (!host || !/^[a-f0-9]{64}$/i.test(serverPublicKey))) || !output || (host !== null && net.isIP(host) !== 4) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Valid output, IPv4 host (optional) and port are required')
const math = fs.readFileSync(path.join(__dirname, '../lib/protocol/crypto-math.js'), 'utf8')
const bundle = `const clientCrypto = (() => { const module = { exports: {} }; ${math}; return module.exports })()\n`
const source = fs.readFileSync(path.join(__dirname, 'frida/client-trace.js'), 'utf8')
const probes = fs.readFileSync(path.join(__dirname, 'frida/stalker-probes.js'), 'utf8')
const probeBundle = `const clientProbes = (() => { const module = { exports: {} }; ${probes}; return module.exports })()\n`
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, `const configuration = ${JSON.stringify({ host, port, serverPublicKey })}\n` + bundle + probeBundle + source, { flag: 'wx' })
console.log(`Created ${output}; logs metadata only; ${host ? `redirects port 9339 to ${host}:${port}` : 'keeps the original connection address'}.`)
console.log(serverPublicKey ? 'Development peer uses Stalker callouts; no inline hooks in libg.so. Android verification is required; Home compatibility still requires a separate client test.' : 'Socket metadata only: no libg.so hooks; client encryption is unchanged.')
