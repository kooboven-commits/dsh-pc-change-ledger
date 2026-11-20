/**
 * 账本读写。
 *
 * 账本和“电脑改动账本”技能共用同一个目录（默认 %USERPROFILE%\.agents\change-ledger），
 * 所以 Codex、Claude 用技能记的账，这里也看得到，反过来也一样。
 *   · 读：直接解析 ledger.jsonl（快，不起进程）
 *   · 写 / 撤销 / 快照：调用随插件附带的 scripts/ledger.ps1，和技能走同一套逻辑
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ledger.ps1')

export function ledgerRoot() {
  return process.env.LEDGER_ROOT || join(homedir(), '.agents', 'change-ledger')
}

const ledgerFile = () => join(ledgerRoot(), 'ledger.jsonl')
const settingsFile = () => join(ledgerRoot(), 'dsh-plugin-settings.json')

export const DEFAULT_SETTINGS = Object.freeze({
  /** 拦截 AI 执行的高风险系统命令，弹出确认卡片 */
  guard: true,
  /** 新对话提醒最近多少小时内的高风险改动 */
  remindHours: 24,
})

export function loadSettings() {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    return {
      guard: typeof raw.guard === 'boolean' ? raw.guard : DEFAULT_SETTINGS.guard,
      remindHours: Number.isFinite(raw.remindHours) && raw.remindHours >= 0 && raw.remindHours <= 24 * 30 ? raw.remindHours : DEFAULT_SETTINGS.remindHours,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings() }
  if (typeof patch?.guard === 'boolean') next.guard = patch.guard
  if (Number.isFinite(patch?.remindHours) && patch.remindHours >= 0 && patch.remindHours <= 24 * 30) next.remindHours = patch.remindHours
  mkdirSync(ledgerRoot(), { recursive: true })
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/** 读出全部记录，坏行跳过。 */
export function readEntries() {
  const file = ledgerFile()
  if (!existsSync(file)) return []
  const rows = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { /* 坏行跳过 */ }
  }
  return rows
}

/** 被撤销的记录：原记录 id → 撤销记录 id */
export function undoneMap(rows) {
  const map = new Map()
  for (const r of rows) if (r.kind === 'undo' && r.of != null) map.set(Number(r.of), Number(r.id))
  return map
}

function parseTime(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(text || ''))
  if (!m) return NaN
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
}

/** 给界面和 AI 用的整理后的列表（新的在前）。 */
export function listEntries({ limit = 100, agent } = {}) {
  const rows = readEntries()
  const undone = undoneMap(rows)
  const out = rows.map((r) => ({
    id: Number(r.id),
    time: String(r.time || ''),
    ts: parseTime(r.time),
    agent: String(r.agent || 'unknown'),
    risk: ['low', 'medium', 'high'].includes(r.risk) ? r.risk : 'medium',
    kind: String(r.kind || 'manual'),
    what: String(r.what || ''),
    why: String(r.why || ''),
    before: r.before == null ? '' : String(r.before),
    after: r.after == null ? '' : String(r.after),
    undo: String(r.undo || ''),
    verify: r.verify ? String(r.verify) : '',
    of: r.of == null ? null : Number(r.of),
    undoneBy: undone.get(Number(r.id)) ?? null,
    canUndo: r.kind !== 'undo' && !!r.undo && r.undo !== 'NONE' && !undone.has(Number(r.id)),
  }))
  const filtered = agent ? out.filter((e) => e.agent === agent) : out
  return filtered.reverse().slice(0, Math.max(1, Math.min(1000, limit)))
}

/** 最近 hours 小时内、还没撤销的高风险改动。 */
export function recentHighRisk(hours, now = Date.now()) {
  if (!hours) return []
  const since = now - hours * 3600 * 1000
  return listEntries({ limit: 1000 }).filter((e) => e.kind !== 'undo' && e.risk === 'high' && !e.undoneBy && e.ts >= since)
}

/**
 * 调用 ledger.ps1。
 * @returns {Promise<{ code: number, out: string }>}
 */
export function runLedger(args, { agent = 'deepseek', timeoutMs = 180000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('电脑改动账本目前只支持 Windows。'))
      return
    }
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], {
      env: { ...process.env, LEDGER_AGENT: agent },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks = []
    child.stdout.on('data', (d) => chunks.push(d))
    child.stderr.on('data', (d) => chunks.push(d))
    const timer = setTimeout(() => { child.kill(); reject(new Error('账本脚本超时')) }, timeoutMs)
    timer.unref?.()
    const onAbort = () => { child.kill(); reject(new Error('已取消')) }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve({ code: code ?? 1, out: Buffer.concat(chunks).toString('utf8').trim() })
    })
  })
}

/** 跑脚本，失败时抛出脚本给的中文原因。 */
export async function runOrThrow(args, opts) {
  const { code, out } = await runLedger(args, opts)
  if (code !== 0) {
    const reason = (out.split(/\r?\n/).find((l) => l.startsWith('出错：')) || out.split(/\r?\n/).pop() || '').replace(/^出错：/, '')
    throw new Error(reason || `账本脚本出错（退出码 ${code}）`)
  }
  return out
}

/** 最近一条记录（脚本写完后用它拿到结构化结果）。 */
export function lastEntry() {
  const rows = listEntries({ limit: 1 })
  return rows[0] ?? null
}

export function lastJsonLine(out) {
  const line = String(out).split(/\r?\n/).reverse().find((l) => /^[[{]/.test(l.trim()))
  if (!line) return null
  try { return JSON.parse(line) } catch { return null }
}

export function ensureRoot() {
  mkdirSync(ledgerRoot(), { recursive: true })
  return ledgerRoot()
}
