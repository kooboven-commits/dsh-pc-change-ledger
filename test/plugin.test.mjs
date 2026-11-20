import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// 用临时账本，不碰真实账本
const ROOT = mkdtempSync(join(tmpdir(), 'pcl-test-'))
process.env.LEDGER_ROOT = ROOT
const TEST_KEY = 'HKCU:\\Software\\PcChangeLedgerPluginTest'

const plugin = await import('../lib/index.js')
const store = await import('../lib/store.js')

function fakeCtx() {
  const reg = { tools: new Map(), handlers: {}, sections: [], contexts: [], commands: new Map(), routes: [] }
  const ctx = {
    logger: { info() {}, warn(m) { reg.warn = m } },
    tools: { register: (t) => { reg.tools.set(t.name, t); return () => reg.tools.delete(t.name) } },
    on: (name, fn) => { reg.handlers[name] = fn; return () => {} },
    inject: (deps, cb) => {
      const scope = {
        systemPrompt: {
          section: (s) => { reg.sections.push(s); return () => {} },
          context: (c) => { reg.contexts.push(c); return () => {} },
          getContextOrder: () => 500,
        },
        commands: { register: (c) => { reg.commands.set(c.name, c); return () => {} } },
        webServer: { register: (r) => { reg.routes.push(r); return () => {} } },
      }
      cb(scope)
    },
  }
  return { ctx, reg }
}

before(() => {
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `Remove-Item -LiteralPath '${TEST_KEY}' -Recurse -ErrorAction SilentlyContinue`]) } catch { /* ignore */ }
})
after(() => {
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `Remove-Item -LiteralPath '${TEST_KEY}' -Recurse -ErrorAction SilentlyContinue`]) } catch { /* ignore */ }
  rmSync(ROOT, { recursive: true, force: true })
})

test('装配：工具、确认、提示词、命令、接口都注册上了', () => {
  const { ctx, reg } = fakeCtx()
  plugin.apply(ctx)
  assert.deepEqual([...reg.tools.keys()].sort(), ['ledger_capture', 'ledger_diff', 'ledger_env_set', 'ledger_list', 'ledger_record', 'ledger_reg_set', 'ledger_undo'])
  assert.equal(typeof reg.handlers['tools/pre-execute'], 'function')
  assert.equal(reg.sections.length, 1)
  assert.match(reg.sections[0].text(), /电脑改动账本/)
  assert.equal(reg.contexts.length, 1)
  assert.equal(reg.contexts[0].order, 501)
  assert.deepEqual([...reg.commands.keys()].sort(), ['ledger', 'ledger-undo'])
  assert.equal(reg.routes.length, 1)
  assert.equal(reg.routes[0].path, '/pc-change-ledger')
  assert.equal(reg.warn, undefined)
})

test('执行前确认：高风险命令弹卡片，普通命令放行，关掉拦截后放行', async () => {
  const { ctx, reg } = fakeCtx()
  plugin.apply(ctx)
  const pre = reg.handlers['tools/pre-execute']
  const pass = Symbol('next')
  const next = async () => pass
  const ask = await pre({ name: 'pwsh', arguments: { command: 'powercfg /h off' } }, next)
  assert.equal(ask.kind, 'ask')
  assert.match(ask.displayReason.zh, /关闭休眠/)
  assert.equal(await pre({ name: 'pwsh', arguments: { command: 'git status' } }, next), pass)
  assert.equal(await pre({ name: 'read', arguments: { path: 'a.txt' } }, next), pass)
  // 记高风险账也要确认，记低风险账不用
  assert.equal((await pre({ name: 'ledger_record', arguments: { what: 'x', undo: 'y', why: 'z', risk: 'high' } }, next)).kind, 'ask')
  assert.equal(await pre({ name: 'ledger_record', arguments: { what: 'x', undo: 'y', why: 'z', risk: 'low' } }, next), pass)
  // 撤销一定要确认
  assert.equal((await pre({ name: 'ledger_undo', arguments: { id: 1 } }, next)).kind, 'ask')
  // 关掉拦截
  store.saveSettings({ guard: false })
  assert.equal(await pre({ name: 'pwsh', arguments: { command: 'powercfg /h off' } }, next), pass)
  store.saveSettings({ guard: true })
})

test('工具真的能记账、撤销，并且最近高风险改动会进提示词', async () => {
  const { ctx, reg } = fakeCtx()
  plugin.apply(ctx)
  const t = (n) => reg.tools.get(n)

  const set = await t('ledger_reg_set').execute({ path: TEST_KEY, name: 'Demo', value: '7', type: 'DWord', why: '插件测试', risk: 'low' })
  assert.equal(set.id, 1)
  assert.equal(set.agent, 'deepseek')
  assert.match(set.after, /DWord = 7/)
  assert.ok(set.canUndo)

  const env = await t('ledger_env_set').execute({ name: 'PCL_PLUGIN_TEST', value: '你好 "quoted"', why: '插件测试' })
  assert.equal(env.id, 2)

  const rec = await t('ledger_record').execute({ what: '测试：关闭某功能', undo: "Write-Output 'restored'", why: '插件测试', risk: 'high' })
  assert.equal(rec.risk, 'high')

  // 最近高风险改动进入 context
  assert.match(reg.contexts[0].text(), /#3/)

  const list = await t('ledger_list').execute({})
  assert.equal(list.count, 3)
  assert.match(list.lines[0], /^#3/)

  // 撤销（从新往旧）
  const u3 = await t('ledger_undo').execute({ id: 3 })
  assert.equal(u3.kind, 'undo')
  assert.equal(reg.contexts[0].text(), '') // 撤销后不再提醒
  await t('ledger_undo').execute({ id: 2 })
  await t('ledger_undo').execute({ id: 1 })
  const rows = store.listEntries({ limit: 50 })
  assert.equal(rows.filter((e) => e.kind !== 'undo' && !e.undoneBy).length, 0)
  const envNow = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('PCL_PLUGIN_TEST','User')"]).toString().trim()
  assert.equal(envNow, '')

  // 重复撤销会报清楚的错
  await assert.rejects(() => t('ledger_undo').execute({ id: 1 }), /已经被/)
})

test('斜杠命令：先预览，加“确认”才执行', async () => {
  const { ctx, reg } = fakeCtx()
  plugin.apply(ctx)
  const t = (n) => reg.tools.get(n)
  const rec = await t('ledger_record').execute({ what: '命令测试', undo: "Write-Output 'ok'", why: '测试', risk: 'low' })
  const preview = await reg.commands.get('ledger-undo').handler({ rawInput: String(rec.id) })
  assert.equal(preview.kind, 'success')
  assert.match(preview.text, /确认无误/)
  assert.equal(store.listEntries({ limit: 1 })[0].id, rec.id) // 还没执行
  const done = await reg.commands.get('ledger-undo').handler({ rawInput: `${rec.id} 确认` })
  assert.equal(done.kind, 'success')
  assert.match(done.text, /已撤销/)
  const ledger = await reg.commands.get('ledger').handler({ rawInput: '' })
  assert.match(ledger.text, /命令测试/)
})

test('快照和对比', async () => {
  const { ctx, reg } = fakeCtx()
  plugin.apply(ctx)
  const t = (n) => reg.tools.get(n)
  const snap = await t('ledger_capture').execute({ name: 'plugin-test' })
  assert.match(snap.name, /^plugin-test_/)
  await t('ledger_env_set').execute({ name: 'PCL_DIFF_TEST', value: 'x', why: '对比测试' })
  const diff = await t('ledger_diff').execute({ from: 'plugin-test' })
  assert.ok(diff.lines.some((l) => l.includes('PCL_DIFF_TEST')), diff.lines.join('\n'))
  const last = store.listEntries({ limit: 1 })[0]
  await t('ledger_undo').execute({ id: last.id })
})
