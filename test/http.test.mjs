import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'pcl-http-'))
process.env.LEDGER_ROOT = ROOT
const { handle } = await import('../lib/http.js')
const store = await import('../lib/store.js')

let server
let base
before(async () => {
  server = createServer(async (req, res) => {
    const handled = await handle(req, res)
    if (!handled) { res.writeHead(404); res.end() }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => { server.close(); rmSync(ROOT, { recursive: true, force: true }) })

test('同源读取正常', async () => {
  const r = await fetch(base + '/pc-change-ledger/api/entries')
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.equal(body.ok, true)
  assert.deepEqual(body.value.entries, [])
  assert.equal(body.value.settings.guard, true)
})

test('跨站请求被拒绝', async () => {
  const r = await fetch(base + '/pc-change-ledger/api/entries', { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(r.status, 403)
  const r2 = await fetch(base + '/pc-change-ledger/api/undo', {
    method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"id":1}',
  })
  assert.equal(r2.status, 403)
})

test('非本机主机名被拒绝（防 DNS 重绑定）', async () => {
  const { request } = await import('node:http')
  const status = await new Promise((resolve, reject) => {
    const req = request(base + '/pc-change-ledger/api/entries', { headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject)
    req.end()
  })
  assert.equal(status, 403)
})

test('写操作必须是 JSON', async () => {
  const r = await fetch(base + '/pc-change-ledger/api/undo', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'id=1' })
  assert.equal(r.status, 415)
})

test('撤销只接受编号，不存在的编号报清楚的错', async () => {
  const bad = await fetch(base + '/pc-change-ledger/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":"rm -rf"}' })
  assert.equal(bad.status, 400)
  const missing = await fetch(base + '/pc-change-ledger/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":99}' })
  const body = await missing.json()
  assert.equal(body.ok, false)
  assert.match(body.error.message, /没有 #99/)
})

test('撤销按钮能真的撤销', async () => {
  await store.runOrThrow(['record', '-What', '接口测试', '-Undo', "Write-Output 'ok'", '-Why', '测试', '-Risk', 'low'], { agent: 'test' })
  const r = await fetch(base + '/pc-change-ledger/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":1}' })
  const body = await r.json()
  assert.equal(body.ok, true, JSON.stringify(body))
  assert.equal(body.value.kind, 'undo')
  assert.equal(body.value.agent, 'user')
})

test('设置开关和快照名校验', async () => {
  const s = await fetch(base + '/pc-change-ledger/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"guard":false}' })
  assert.equal((await s.json()).value.guard, false)
  const bad = await fetch(base + '/pc-change-ledger/api/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"../../x"}' })
  assert.equal(bad.status, 400)
})
