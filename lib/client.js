/**
 * dsh-pc-change-ledger · Client 半边（右侧栏“电脑改动账本”）
 *
 *   · 往右侧栏注册 tab 类型 `pc-change-ledger`（引导页里有入口）
 *   · 在 `sidebar.right.pane.tab` 里渲染账本面板
 * 数据全部来自 Host 的 /pc-change-ledger/api/；纯 JS、零构建、只 require('react')。
 */
;(function () {
  'use strict'

  var loader = typeof window !== 'undefined' ? window.__ModuleLoader__ : undefined
  if (!loader || typeof loader.load !== 'function') return

  loader.load({
    id: 'dsh-pc-change-ledger',
    factory: function (require) {
      var module = { exports: {} }
      var exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

      var React = require('react')
      var h = React.createElement
      var useState = React.useState
      var useEffect = React.useEffect
      var useCallback = React.useCallback

      var KIND = 'pc-change-ledger'
      var API = '/pc-change-ledger/api/'
      var RISK = { high: { dot: '🔴', label: '高' }, medium: { dot: '🟡', label: '中' }, low: { dot: '🟢', label: '低' } }

      var CSS = [
        '.pcl{display:flex;flex-direction:column;height:100%;min-height:0;width:100%;max-width:100%;box-sizing:border-box;overflow-x:hidden;color:var(--dsw-alias-label-primary);font-size:13px}',
        '.pcl *{box-sizing:border-box;min-width:0}',
        '.pcl-top{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap}',
        '.pcl-top b{font-size:14px;margin-right:auto;white-space:nowrap}',
        '.pcl-btn{white-space:nowrap;flex:none}',
        '.pcl-btn{border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 9px;font-size:12px;cursor:pointer}',
        '.pcl-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
        '.pcl-btn[disabled]{opacity:.5;cursor:default}',
        '.pcl-btn.danger{color:var(--dsw-alias-label-danger);border-color:var(--dsw-alias-label-danger)}',
        '.pcl-btn.on{background:var(--dsw-alias-bg-layer-3)}',
        '.pcl-bar{display:flex;align-items:center;gap:6px;padding:8px 12px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
        '.pcl-bar select{font-size:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);border-radius:6px;padding:2px 4px}',
        '.pcl-warn{margin:8px 12px 0;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-label-danger);color:var(--dsw-alias-label-danger);font-size:12px;line-height:1.5}',
        '.pcl-err{margin:8px 12px 0;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-danger);font-size:12px}',
        '.pcl-note{margin:8px 12px 0;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px}',
        '.pcl-list{flex:1;min-height:0;overflow:auto;padding:4px 0 12px}',
        '.pcl-item{margin:6px 12px;padding:8px 10px;overflow-wrap:anywhere;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
        '.pcl-item.undone{opacity:.55}',
        '.pcl-meta{display:flex;gap:6px;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:11.5px}',
        '.pcl-what{margin:4px 0 2px;line-height:1.5;word-break:break-word}',
        '.pcl-why{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}',
        '.pcl-acts{display:flex;gap:6px;justify-content:flex-end;margin-top:6px}',
        '.pcl-detail{margin-top:6px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}',
        '.pcl-detail code,.pcl-confirm code{display:block;margin-top:2px;padding:4px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:11.5px;white-space:pre-wrap;word-break:break-all}',
        '.pcl-confirm{margin-top:8px;padding:8px;border-radius:8px;border:1px dashed var(--dsw-alias-label-danger);font-size:12px}',
        '.pcl-empty{padding:28px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);line-height:1.7;white-space:pre-line}',
        '.pcl-sheet{margin:8px 12px 0;padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px}',
        '.pcl-sheet input{width:100%;box-sizing:border-box;margin:6px 0;padding:4px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
        '.pcl-diff{max-height:260px;overflow:auto;margin-top:6px}',
        '.pcl-diff div{padding:3px 0;border-bottom:1px dashed var(--dsw-alias-border-l2);word-break:break-all}',
      ].join('\n')

      function getJson(path) {
        return fetch(API + path, { headers: { accept: 'application/json' } }).then(unwrap)
      }
      function postJson(path, body) {
        return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(unwrap)
      }
      function unwrap(response) {
        return response.json().then(function (payload) {
          if (!payload || payload.ok !== true) {
            throw new Error(payload && payload.error && payload.error.message ? payload.error.message : 'HTTP ' + response.status)
          }
          return payload.value
        })
      }

      function Item(props) {
        var e = props.entry
        var open = useState(false)
        var confirming = useState(false)
        var r = RISK[e.risk] || RISK.medium
        var undone = !!e.undoneBy
        var isUndo = e.kind === 'undo'
        return h('div', { className: 'pcl-item' + (undone || isUndo ? ' undone' : '') },
          h('div', { className: 'pcl-meta' },
            h('span', null, r.dot),
            h('span', null, '#' + e.id),
            h('span', null, e.time),
            h('span', null, e.agent),
            h('span', null, '风险' + r.label)),
          h('div', { className: 'pcl-what' }, e.what + (undone ? '（已被 #' + e.undoneBy + ' 撤销）' : '')),
          e.why && !isUndo ? h('div', { className: 'pcl-why' }, '原因：' + e.why) : null,
          open[0] ? h('div', { className: 'pcl-detail' },
            e.before ? h('div', null, '原来：', h('code', null, e.before)) : null,
            e.after ? h('div', null, '现在：', h('code', null, e.after)) : null,
            e.undo && e.undo !== 'NONE' ? h('div', null, '撤销命令：', h('code', null, e.undo)) : h('div', null, '这条改动无法撤销。'),
            e.verify ? h('div', null, '查看命令：', h('code', null, e.verify)) : null) : null,
          confirming[0] ? h('div', { className: 'pcl-confirm' },
            h('div', null, '确定要撤销 #' + e.id + ' 吗？将在这台电脑上执行：'),
            h('code', null, e.undo),
            h('div', { className: 'pcl-acts' },
              h('button', { type: 'button', className: 'pcl-btn', onClick: function () { confirming[1](false) } }, '取消'),
              h('button', {
                type: 'button', className: 'pcl-btn danger', disabled: props.busy,
                onClick: function () { props.onUndo(e.id).then(function () { confirming[1](false) }) },
              }, props.busy ? '撤销中…' : '确认撤销'))) : null,
          h('div', { className: 'pcl-acts' },
            h('button', { type: 'button', className: 'pcl-btn', onClick: function () { open[1](!open[0]) } }, open[0] ? '收起' : '详情'),
            e.canUndo && !confirming[0] ? h('button', { type: 'button', className: 'pcl-btn danger', onClick: function () { confirming[1](true) } }, '撤销') : null))
      }

      function Panel() {
        var data = useState(null)
        var err = useState('')
        var note = useState('')
        var busy = useState(false)
        var agent = useState('')
        var risk = useState('')
        var sheet = useState('')            // '' | 'capture' | 'diff'
        var snapName = useState('')
        var snaps = useState([])
        var diff = useState(null)

        var load = useCallback(function () {
          return getJson('entries').then(function (v) { data[1](v); err[1]('') }, function (e) { err[1]('读取账本失败：' + e.message) })
        }, [])

        useEffect(function () {
          load()
          var t = setInterval(load, 5000)
          return function () { clearInterval(t) }
        }, [load])

        function onUndo(id) {
          busy[1](true)
          return postJson('undo', { id: id }).then(function (v) {
            note[1]('已撤销 #' + id + (v && v.id ? '（记账 #' + v.id + '）' : ''))
            err[1]('')
            return load()
          }, function (e) { err[1]('撤销失败：' + e.message) }).then(function () { busy[1](false) })
        }

        function toggleGuard() {
          var cur = data[0] && data[0].settings
          if (!cur) return
          postJson('settings', { guard: !cur.guard }).then(load, function (e) { err[1](e.message) })
        }

        function openDiff() {
          sheet[1]('diff'); diff[1](null)
          getJson('snapshots').then(function (v) { snaps[1](v || []) }, function (e) { err[1]('读取快照失败：' + e.message) })
        }

        function doCapture() {
          var name = (snapName[0] || '').trim() || ('快照-' + new Date().toISOString().slice(0, 10))
          busy[1](true)
          postJson('capture', { name: name }).then(function (v) {
            note[1]('已拍快照：' + (v && v.name ? v.name : name) + '。以后点“对比”就能看出哪里变了。')
            sheet[1](''); snapName[1]('')
          }, function (e) { err[1]('拍快照失败：' + e.message) }).then(function () { busy[1](false) })
        }

        function doDiff(name) {
          busy[1](true); diff[1](null)
          getJson('diff?from=' + encodeURIComponent(name)).then(function (v) { diff[1]({ name: name, rows: v || [] }) }, function (e) { err[1]('对比失败：' + e.message) })
            .then(function () { busy[1](false) })
        }

        var d = data[0]
        var entries = d ? d.entries : []
        var agents = []
        entries.forEach(function (e) { if (agents.indexOf(e.agent) < 0) agents.push(e.agent) })
        var shown = entries.filter(function (e) {
          return (!agent[0] || e.agent === agent[0]) && (!risk[0] || e.risk === risk[0])
        })
        var recent = d ? d.recent || [] : []
        var guard = d && d.settings ? d.settings.guard : true

        return h('div', { className: 'pcl' },
          h('style', null, CSS),
          h('div', { className: 'pcl-top' },
            h('b', null, '电脑改动账本'),
            h('button', { type: 'button', className: 'pcl-btn', onClick: function () { sheet[1](sheet[0] === 'capture' ? '' : 'capture') } }, '拍快照'),
            h('button', { type: 'button', className: 'pcl-btn', onClick: function () { sheet[0] === 'diff' ? sheet[1]('') : openDiff() } }, '对比'),
            h('button', { type: 'button', className: 'pcl-btn', onClick: load }, '刷新')),
          h('div', { className: 'pcl-bar' },
            h('span', null, '助手'),
            h('select', { value: agent[0], onChange: function (ev) { agent[1](ev.target.value) } },
              h('option', { value: '' }, '全部'),
              agents.map(function (a) { return h('option', { key: a, value: a }, a) })),
            h('span', null, '风险'),
            h('select', { value: risk[0], onChange: function (ev) { risk[1](ev.target.value) } },
              h('option', { value: '' }, '全部'),
              h('option', { value: 'high' }, '🔴 高'),
              h('option', { value: 'medium' }, '🟡 中'),
              h('option', { value: 'low' }, '🟢 低')),
            h('span', { style: { marginLeft: 'auto' } }),
            h('button', {
              type: 'button', className: 'pcl-btn' + (guard ? ' on' : ''), onClick: toggleGuard,
              title: '开启后，AI 执行关休眠、删还原点、改系统注册表等高风险命令前会先弹卡片问你',
            }, guard ? '🛡 拦截：开' : '🛡 拦截：关')),
          recent.length > 0 ? h('div', { className: 'pcl-warn' },
            '最近 ' + (d.settings.remindHours || 24) + ' 小时内有 ' + recent.length + ' 项高风险改动还没撤销（#' + recent.join('、#') + '）。电脑如果出现异常，可以先从这里排查、撤销。') : null,
          err[0] ? h('div', { className: 'pcl-err' }, err[0]) : null,
          note[0] ? h('div', { className: 'pcl-note' }, note[0]) : null,
          sheet[0] === 'capture' ? h('div', { className: 'pcl-sheet' },
            h('div', null, '给现在的系统设置拍张快照（电源、虚拟内存、开机自启、服务、计划任务、环境变量、更新策略、hosts、已装软件）。'),
            h('input', { placeholder: '快照名，例如 清理前', value: snapName[0], onChange: function (ev) { snapName[1](ev.target.value) } }),
            h('div', { className: 'pcl-acts' },
              h('button', { type: 'button', className: 'pcl-btn', onClick: function () { sheet[1]('') } }, '取消'),
              h('button', { type: 'button', className: 'pcl-btn', disabled: busy[0], onClick: doCapture }, busy[0] ? '拍摄中…' : '拍快照'))) : null,
          sheet[0] === 'diff' ? h('div', { className: 'pcl-sheet' },
            snaps[0].length === 0 ? h('div', null, '还没有快照。先点“拍快照”。') : h('div', null,
              h('div', null, '选一张快照，和现在对比：'),
              h('div', { className: 'pcl-acts', style: { justifyContent: 'flex-start', flexWrap: 'wrap' } },
                snaps[0].slice(-8).reverse().map(function (s) {
                  return h('button', { key: s.name, type: 'button', className: 'pcl-btn', disabled: busy[0], onClick: function () { doDiff(s.name) } }, s.name.replace(/_\d{8}-\d{6}$/, '') + ' · ' + s.time.slice(5, 16))
                }))),
            busy[0] ? h('div', null, '对比中…（要读一遍系统设置，大约十几秒）') : null,
            diff[0] ? h('div', { className: 'pcl-diff' },
              diff[0].rows.length === 0 ? h('div', null, '和快照相比，没有变化。') : diff[0].rows.map(function (r, i) {
                return h('div', { key: i }, (r.change === '新增' ? '➕ ' : r.change === '删除' ? '➖ ' : '✏️ ') + r.item + '：' + (r.before || '（无）') + ' → ' + (r.after || '（无）'))
              })) : null) : null,
          h('div', { className: 'pcl-list' },
            !d ? h('div', { className: 'pcl-empty' }, '加载中…') :
              shown.length === 0 ? h('div', { className: 'pcl-empty' }, entries.length === 0
                ? '账本是空的。\nAI 修改电脑系统设置时会自动记在这里，每条都能一键撤销。'
                : '没有符合筛选条件的记录。') :
                shown.map(function (e) { return h(Item, { key: e.id + '-' + e.time, entry: e, onUndo: onUndo, busy: busy[0] }) })))
      }

      function LedgerIcon() {
        return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 2 }),
          h('path', { d: 'M8 8h8M8 12h8M8 16h4' }),
          h('path', { d: 'M15 17.5l1.5 1.5 3-3' }))
      }

      function apply(ctx) {
        ctx.effect(function () {
          return ctx.sidebarRightTabs.register({
            id: KIND,
            kind: KIND,
            title: function () { return '电脑改动账本' },
            guide: [{
              id: KIND,
              order: 2450,
              title: function () { return '电脑改动账本' },
              description: function () { return 'AI 对这台电脑做过的系统改动，每条都能一键撤销' },
              icon: LedgerIcon,
            }],
          })
        }, 'dsh-pc-change-ledger: tab type')

        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: KIND }, Panel)
          })
        }, 'dsh-pc-change-ledger: pane body')
      }

      exports.name = 'dsh-pc-change-ledger'
      exports.inject = ['slots', 'sidebarRightTabs']
      exports.apply = apply
      exports.Panel = Panel
      return module.exports
    },
  })
})()
