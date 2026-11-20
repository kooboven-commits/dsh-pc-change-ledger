import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/** 用假的 __ModuleLoader__ 和假的 React 装配一遍客户端，检查注册了正确的 tab 与 slot。 */
function loadClient() {
  let loaded
  const window = { __ModuleLoader__: { load: (spec) => { loaded = spec } } }
  const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (v) => [v, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window, Symbol, Object })
  assert.equal(loaded.id, 'dsh-pc-change-ledger')
  return loaded.factory((name) => { assert.equal(name, 'react'); return fakeReact })
}

test('客户端注册右侧栏 tab 类型和面板', () => {
  const mod = loadClient()
  assert.deepEqual([...mod.inject], ['slots', 'sidebarRightTabs'])  // 数组来自另一个 vm 上下文，先拷贝再比
  const calls = { tabs: [], slots: [] }
  const ctx = {
    effect: (fn) => fn(),
    sidebarRightTabs: { register: (spec) => { calls.tabs.push(spec); return () => {} } },
    slots: {
      inject: (name, fn) => { calls.injected = name; return fn() },
      register: (spec, comp) => { calls.slots.push({ spec, comp }); return () => {} },
    },
  }
  mod.apply(ctx)
  assert.equal(calls.tabs.length, 1)
  assert.equal(calls.tabs[0].kind, 'pc-change-ledger')
  assert.equal(calls.tabs[0].title(), '电脑改动账本')
  assert.equal(calls.tabs[0].guide[0].id, 'pc-change-ledger')
  assert.equal(calls.injected, 'sidebar.right.pane.tab')
  assert.equal(calls.slots[0].spec.key, 'pc-change-ledger')
  assert.equal(calls.slots[0].comp, mod.Panel)
})

test('面板能渲染（加载中状态）', () => {
  const mod = loadClient()
  const tree = mod.Panel()
  assert.equal(tree.props.className, 'pcl')
  const text = JSON.stringify(tree)
  assert.match(text, /电脑改动账本/)
  assert.match(text, /加载中/)
})

test('客户端不用 window.open（Desktop 会静默拦截）', () => {
  const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(/window\.open\(/.test(src), false)
})
