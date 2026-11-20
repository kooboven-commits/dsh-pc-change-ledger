/**
 * dsh-pc-change-ledger · Host 半边
 *
 *   · AI 工具：ledger_list / ledger_reg_set / ledger_env_set / ledger_record / ledger_undo / ledger_capture / ledger_diff
 *   · tools/pre-execute：AI 执行高风险系统命令、记高风险账、撤销时，弹出 DSH 自带的确认卡片
 *   · systemPrompt：固定规则走 section（不变，利于缓存）；最近的高风险改动走 context（变化不打乱前缀缓存）
 *   · 斜杠命令：/ledger、/ledger-undo
 *   · 本机接口：/pc-change-ledger/api/...（给右侧栏面板）
 */
import { assessCommand, commandOf, describeHits } from './guard.js'
import { handle, PREFIX } from './http.js'
import { ensureRoot, lastEntry, lastJsonLine, listEntries, loadSettings, recentHighRisk, runOrThrow } from './store.js'

export const name = 'dsh-pc-change-ledger'
export const inject = ['tools']

const AGENT = 'deepseek'
const RISK = { type: 'string', enum: ['low', 'medium', 'high'], description: '风险：low 低 / medium 中 / high 高（高风险会先请用户确认）' }
const RISK_ZH = { low: '低', medium: '中', high: '高' }
const text = (t) => [{ type: 'text', text: String(t ?? '') }]

function brief(e) {
  if (!e) return '（没有记录）'
  const state = e.undoneBy ? `（已被 #${e.undoneBy} 撤销）` : ''
  return `#${e.id} ${e.time} ${e.agent} 风险${RISK_ZH[e.risk] || e.risk}：${e.what}${state}`
}

const entrySchema = {
  type: 'object',
  additionalProperties: true,
  properties: { id: { type: 'number' }, what: { type: 'string' } },
}

/* ───────────── AI 工具 ───────────── */

function tools() {
  return [
    {
      name: 'ledger_list',
      description: '查看电脑改动账本：所有 AI 助手（Codex、DeepSeek、Claude 等）最近对这台 Windows 电脑做过的系统改动，含编号、原因、是否已撤销。修改系统设置前先查；用户说电脑出问题时第一件事也是查它。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { limit: { type: 'number', description: '最多几条，默认 20' }, agent: { type: 'string', description: '只看某个助手，如 codex / deepseek / claude' } },
        required: [],
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { count: { type: 'number' }, lines: { type: 'array', items: { type: 'string' } } }, required: ['count', 'lines'] },
        render: (_a, v) => text(v.count === 0 ? '账本是空的：还没有记录任何系统改动。' : v.lines.join('\n')),
      },
      execute: async (args) => {
        const rows = listEntries({ limit: Number(args?.limit) || 20, agent: args?.agent || undefined })
        return { count: rows.length, lines: rows.map(brief) }
      },
    },
    {
      name: 'ledger_reg_set',
      description: '修改一个注册表值并自动记账（自动记下旧值和撤销命令）。改注册表请用它，不要直接用 reg add / Set-ItemProperty。HKLM 下的值需要管理员权限。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', description: "注册表路径，如 HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" },
          name: { type: 'string', description: '值名' },
          value: { type: 'string', description: '新值（数字也用字符串传）' },
          type: { type: 'string', enum: ['String', 'ExpandString', 'DWord', 'QWord', 'MultiString'], description: '值类型，默认 String' },
          why: { type: 'string', description: '为什么改（写给用户看的大白话）' },
          risk: RISK,
        },
        required: ['path', 'name', 'value', 'why'],
      },
      output: { schema: entrySchema, render: (_a, v) => text(`已修改并记账 ${brief(v)}\n原来：${v.before}\n现在：${v.after}\n撤销：在账本里点“撤销”，或说“撤销 ${v.id}”`) },
      execute: async (args, ctx) => {
        await runOrThrow(['reg-set', '-Path', String(args.path), '-Name', String(args.name), '-Value', String(args.value), '-Type', args.type || 'String', '-Why', String(args.why), '-Risk', args.risk || 'medium'], { agent: AGENT, signal: ctx?.signal })
        return lastEntry()
      },
    },
    {
      name: 'ledger_env_set',
      description: '修改一个“用户”环境变量并自动记账（value 传空字符串表示删除）。系统级环境变量不要用它。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { name: { type: 'string' }, value: { type: 'string' }, why: { type: 'string' }, risk: RISK },
        required: ['name', 'value', 'why'],
      },
      output: { schema: entrySchema, render: (_a, v) => text(`已修改并记账 ${brief(v)}（新开的程序才会看到新值）`) },
      execute: async (args, ctx) => {
        await runOrThrow(['env-set', '-Name', String(args.name), '-Value', String(args.value ?? ''), '-Why', String(args.why), '-Risk', args.risk || 'low'], { agent: AGENT, signal: ctx?.signal })
        return lastEntry()
      },
    },
    {
      name: 'ledger_record',
      description: '把其他系统改动记进账本（电源/休眠、服务、计划任务、开机自启、虚拟内存、Windows 更新、防火墙、安装卸载软件、删除项目外文件……）。动手前先读出旧值，改完立刻记；undo 必须是一条能直接运行、能恢复原状的 PowerShell 命令，确实无法撤销就写 NONE 并在 what 里说明。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          what: { type: 'string', description: '改了什么（大白话，含关键数值）' },
          undo: { type: 'string', description: '撤销命令（PowerShell），或 NONE' },
          verify: { type: 'string', description: '可选：查看当前状态的命令' },
          why: { type: 'string', description: '为什么改' },
          risk: RISK,
        },
        required: ['what', 'undo', 'why'],
      },
      output: { schema: entrySchema, render: (_a, v) => text(`已记账 ${brief(v)}`) },
      execute: async (args, ctx) => {
        const argv = ['record', '-What', String(args.what), '-Undo', String(args.undo), '-Why', String(args.why), '-Risk', args.risk || 'medium']
        if (args.verify) argv.push('-Verify', String(args.verify))
        await runOrThrow(argv, { agent: AGENT, signal: ctx?.signal })
        return lastEntry()
      },
    },
    {
      name: 'ledger_undo',
      description: '撤销账本里的某条改动（会先请用户确认）。同一设置改过多次时要从新往旧撤。',
      parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'number', description: '账本编号' } }, required: ['id'] },
      output: { schema: entrySchema, render: (_a, v) => text(`已撤销，记账 ${brief(v)}`) },
      execute: async (args, ctx) => {
        await runOrThrow(['undo', '-Id', String(Math.trunc(Number(args.id))), '-Yes'], { agent: AGENT, signal: ctx?.signal })
        return lastEntry()
      },
    },
    {
      name: 'ledger_capture',
      description: '给常见系统设置拍快照（电源、虚拟内存、开机自启、服务、计划任务、用户环境变量、更新策略、hosts、已安装软件）。一次要改好几项或要装卸软件前先拍。',
      parameters: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', description: '快照名，如 before-清理C盘' } }, required: ['name'] },
      output: { schema: { type: 'object', additionalProperties: true, properties: { name: { type: 'string' } } }, render: (_a, v) => text(`已拍快照：${v.name}`) },
      execute: async (args, ctx) => {
        const out = await runOrThrow(['capture', '-Name', String(args.name || 'snap'), '-Json'], { agent: AGENT, signal: ctx?.signal })
        return lastJsonLine(out) ?? { name: String(args.name) }
      },
    },
    {
      name: 'ledger_diff',
      description: '对比快照和现在（或两张快照），找出系统设置哪里变了。用户问“到底改了什么”、或怀疑有改动没记账时用。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { from: { type: 'string', description: '快照名（前缀即可）' }, to: { type: 'string', description: '可选：另一张快照；不写就和现在比' } },
        required: ['from'],
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { count: { type: 'number' }, lines: { type: 'array', items: { type: 'string' } } }, required: ['count', 'lines'] },
        render: (_a, v) => text(v.count === 0 ? '没有变化。' : v.lines.join('\n')),
      },
      execute: async (args, ctx) => {
        const argv = ['diff', '-From', String(args.from), '-Json']
        if (args.to) argv.push('-To', String(args.to))
        const out = await runOrThrow(argv, { agent: AGENT, signal: ctx?.signal })
        const rows = [].concat(lastJsonLine(out) ?? [])
        return { count: rows.length, lines: rows.map((r) => `${r.change} ${r.item}：${r.before || '（无）'} → ${r.after || '（无）'}`) }
      },
    },
  ]
}

/* ───────────── 执行前确认 ───────────── */

/** 返回 null 表示放行，否则返回给 DSH 的 ask 决定。 */
export function decide(exec, settings = loadSettings()) {
  const toolName = String(exec?.name || '')
  const args = exec?.arguments ?? {}
  if (toolName === 'ledger_undo') {
    const id = Math.trunc(Number(args.id))
    const target = listEntries({ limit: 1000 }).find((e) => e.id === id)
    const zh = target ? `AI 想撤销账本 #${id}：${target.what}\n将执行：${target.undo}` : `AI 想撤销账本 #${id}（账本里找不到这一条，执行时会报错）。`
    return { kind: 'ask', reason: zh, displayReason: { zh, en: `Undo ledger entry #${id}` } }
  }
  if (['ledger_reg_set', 'ledger_env_set', 'ledger_record'].includes(toolName) && args.risk === 'high') {
    const what = toolName === 'ledger_reg_set' ? `注册表 ${args.path}\\${args.name} = ${args.value}` : toolName === 'ledger_env_set' ? `用户环境变量 ${args.name} = ${args.value}` : args.what
    const zh = `AI 要做一项高风险系统改动：${what}\n原因：${args.why || '（没写）'}`
    return { kind: 'ask', reason: zh, displayReason: { zh, en: `High-risk system change: ${what}` } }
  }
  if (!settings.guard || toolName.startsWith('ledger_')) return null
  const command = commandOf(args)
  if (!command) return null
  const hits = assessCommand(command)
  if (hits.length === 0) return null
  const zh = describeHits(hits, command)
  return { kind: 'ask', reason: zh, displayReason: { zh, en: `System change: ${hits.map((h) => h.id).join(', ')}` } }
}

/* ───────────── 提示词 ───────────── */

const POLICY = [
  '## 电脑改动账本（插件）',
  '修改这台 Windows 电脑的系统设置（注册表、电源/休眠、虚拟内存、开机自启、计划任务、服务、环境变量、Windows 更新、防火墙/Defender、hosts、安装卸载软件、删除项目以外的文件）时：',
  '1. 先用 ledger_list 看最近其他助手改过什么；用户说电脑出问题，也先查账。',
  '2. 高风险改动先用大白话告诉用户后果，用户同意再做；要执行的高风险命令会被插件拦下请用户确认。',
  '3. 改注册表用 ledger_reg_set，改用户环境变量用 ledger_env_set；其他改动做完立刻 ledger_record（先读旧值，写好能直接运行的撤销命令）。',
  '4. 改完验证实际效果，要重启才生效的告诉用户重启后再检查。',
  '5. 告诉用户改了什么、账本编号，可以在右侧栏“电脑改动账本”里一键撤销。',
].join('\n')

export function recentContext(settings = loadSettings()) {
  const recent = recentHighRisk(settings.remindHours)
  if (recent.length === 0) return ''
  const lines = recent.slice(0, 6).map((e) => `- #${e.id} ${e.time}（${e.agent}）${e.what}`)
  return `## 最近的高风险系统改动（电脑改动账本）\n最近 ${settings.remindHours} 小时内有 ${recent.length} 项还没撤销的高风险改动；用户反映电脑异常时先考虑它们，必要时提醒用户可以撤销：\n${lines.join('\n')}`
}

/* ───────────── 斜杠命令 ───────────── */

async function commandLedger() {
  const rows = listEntries({ limit: 15 })
  if (rows.length === 0) return { kind: 'success', text: '电脑改动账本是空的：还没有记录任何系统改动。' }
  return { kind: 'success', text: '电脑改动账本（最近 15 条，详情见右侧栏）：\n' + rows.map(brief).join('\n') }
}

async function commandUndo(invocation) {
  const raw = String(invocation?.rawInput || '').trim()
  const m = /(\d+)\s*(确认|yes|confirm)?\s*$/i.exec(raw)
  if (!m) return { kind: 'error', text: '用法：/ledger-undo 编号（先预览），确认无误后 /ledger-undo 编号 确认' }
  const id = Number(m[1])
  const target = listEntries({ limit: 1000 }).find((e) => e.id === id)
  if (!target) return { kind: 'error', text: `账本里没有 #${id}。` }
  if (!m[2]) return { kind: 'success', text: `要撤销 #${id}：${target.what}\n将执行：${target.undo}\n确认无误请输入：/ledger-undo ${id} 确认` }
  try {
    await runOrThrow(['undo', '-Id', String(id), '-Yes'], { agent: 'user', signal: invocation?.signal })
    return { kind: 'success', text: `已撤销 #${id}：${target.what}（记账 ${brief(lastEntry())}）` }
  } catch (error) {
    return { kind: 'error', text: `撤销失败：${error?.message ?? error}` }
  }
}

/* ───────────── 装配 ───────────── */

export function apply(ctx) {
  ensureRoot()
  const disposers = []
  const keep = (label, fn) => {
    try {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
    } catch (error) {
      ctx.logger?.warn?.(`[pc-change-ledger] ${label} 注册失败：${error?.message ?? error}`)
    }
  }

  for (const tool of tools()) keep(`工具 ${tool.name}`, () => ctx.tools.register(tool))

  keep('执行前确认', () => ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const ask = decide(exec)
      if (ask) return ask
    } catch (error) {
      ctx.logger?.warn?.(`[pc-change-ledger] 确认判断出错：${error?.message ?? error}`)
    }
    return next()
  }))

  ctx.inject?.(['systemPrompt'], (scope) => {
    keep('规则', () => scope.systemPrompt.section({ name: 'pc-change-ledger:policy', order: 860, text: () => POLICY }))
    const order = typeof scope.systemPrompt.getContextOrder === 'function'
      ? (() => { try { return scope.systemPrompt.getContextOrder('APPROVAL_POLICY') + 1 } catch { return 900 } })()
      : 900
    keep('最近改动提醒', () => scope.systemPrompt.context({
      name: 'pc-change-ledger:recent',
      order,
      text: () => { try { return recentContext() } catch { return '' } },
    }))
  })

  ctx.inject?.(['commands'], (scope) => {
    keep('/ledger', () => scope.commands.register({ name: 'ledger', description: '查看电脑改动账本（最近 15 条）', handler: commandLedger }))
    keep('/ledger-undo', () => scope.commands.register({ name: 'ledger-undo', description: '撤销账本里的一条改动：/ledger-undo 编号', handler: commandUndo }))
  })

  ctx.inject?.(['webServer'], (scope) => {
    keep('本机接口', () => scope.webServer.register({
      kind: 'prefix',
      path: PREFIX.replace(/\/api\/$/, ''),
      handler: async (req, res) => {
        const handled = await handle(req, res)
        if (!handled) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"ok":false}') }
      },
    }))
  })

  ctx.on?.('dispose', () => {
    for (const d of disposers.reverse()) { try { d() } catch { /* ignore */ } }
  })
  ctx.logger?.info?.(`[pc-change-ledger] 已就绪：${loadSettings().guard ? '拦截高风险命令' : '不拦截命令'}；账本 ${ensureRoot()}`)
}
