'use strict'
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const cwd = path.resolve(__dirname, '..')

async function freePort () {
  const reserve = net.createServer().listen(0, '127.0.0.1')
  await once(reserve, 'listening')
  const port = reserve.address().port
  await new Promise(resolve => reserve.close(resolve))
  return port
}

async function run (mode, transport) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-cli-'))
  const port = await freePort()
  const contentPort = await freePort()
  const contentUrl = `http://127.0.0.1:${contentPort}`
  const env = { ...process.env, HOME_MODE: mode, HOST: '127.0.0.1', PORT: String(port), TRANSPORT: transport, TRACE_NETWORK: '1', SERVER_KEY_PATH: path.join(directory, 'key.json'), DATA_DIR: path.join(directory, 'accounts'), CONTENT_PORT: String(contentPort), CONTENT_HOST: '127.0.0.1', CONTENT_URL: contentUrl, CONTENT_UPSTREAM_URL: '', CONTENT_ROOT: path.join(cwd, 'content') }
  delete env.HOME_TEMPLATE_PATH
  let output = ''; let errors = ''
  const server = spawn(process.execPath, ['index.js'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', data => { output += data })
  server.stderr.on('data', data => { errors += data })
  let timer
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Server startup timeout')), 15000)
      server.once('error', reject)
      server.once('exit', code => reject(new Error('Server startup exit ' + code + ': ' + errors)))
      server.stdout.on('data', () => { if (output.includes('Content fingerprint ')) resolve() })
    })
    clearTimeout(timer)
    const clientEnv = { ...env, EXPECT_HOME: mode === 'starter' ? 'starter' : 'missing' }
    if (mode === 'starter') clientEnv.EXPECT_CONTENT_URL = contentUrl
    else delete clientEnv.EXPECT_CONTENT_URL
    const peer = output.match(/Development server public key: ([a-f0-9]{64})/)
    if (transport === 'nacl17') clientEnv.SERVER_PUBLIC_KEY = peer[1]
    else delete clientEnv.SERVER_PUBLIC_KEY
    const client = spawn(process.execPath, ['tools/smoke-client.js'], { cwd, env: clientEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    let result = ''
    client.stdout.on('data', data => { result += data })
    client.stderr.on('data', data => { result += data })
    const [code] = await once(client, 'exit')
    if (code !== 0 || !result.includes('PASS:')) throw new Error(result)
    if (mode === 'starter' && !output.includes('"event":"content-file-served"')) throw new Error('Missing HTTP asset response')
    console.log(mode + '/' + transport + ': ' + result.trim())
  } finally {
    clearTimeout(timer)
    if (server.exitCode === null) {
      const stopped = once(server, 'exit')
      server.kill('SIGTERM')
      await stopped
    }
    await fs.rm(directory, { force: true, recursive: true })
  }
}

async function main () {
  await run('starter', 'nacl17')
  await run('disabled', 'nacl17')
  await run('starter', 'plaintext')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
