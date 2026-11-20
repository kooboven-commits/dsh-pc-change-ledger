/**
 * 侧边栏用的本机接口：/pc-change-ledger/api/...
 *
 * 安全：撤销会在电脑上执行命令，所以防的是“浏览器里别的网页冒充用户打本机接口”：
 *   1. Host 只认 localhost / 127.0.0.1 / ::1；
 *   2. 有 Origin 时必须和 Host 一致；Sec-Fetch-Site 为 cross-site 一律拒绝；
 *   3. 写操作只接受 POST + application/json（跨站表单发不出这个类型）；
 *   4. 撤销只按账本编号执行账本里记好的命令，不接受任意命令文本。
 */
import { listEntries, loadSettings, saveSettings, runOrThrow, lastEntry, lastJsonLine, recentHighRisk } from './store.js'

export const PREFIX = '/pc-change-ledger/api/'
const MAX_BODY = 64 * 1024

function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(payload))
}
const ok = (res, value) => send(res, 200, { ok: true, value })
const fail = (res, status, message) => send(res, status, { ok: false, error: { message } })

function hostName(value) {
  const v = String(value || '').trim().toLowerCase()
  if (v.startsWith('[')) return v.slice(1, v.indexOf(']'))
  return v.split(':')[0]
}

/** 只允许本机、同源。返回拒绝原因，通过返回 null。 */
export function rejectReason(req) {
  const host = hostName(req.headers.host)
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) return '只接受本机访问'
  const site = String(req.headers['sec-fetch-site'] || '')
  if (site === 'cross-site') return '拒绝跨站请求'
  const origin = req.headers.origin
  if (origin && origin !== 'null') {
    try {
      const o = new URL(origin)
      if (o.host.toLowerCase() !== String(req.headers.host || '').toLowerCase()) return '来源与主机不一致'
    } catch { return '来源无效' }
  } else if (origin === 'null') {
    return '拒绝无来源的请求'
  }
  return null
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').toLowerCase()
    if (!type.startsWith('application/json')) { reject(Object.assign(new Error('只接受 JSON'), { status: 415 })); return }
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { reject(Object.assign(new Error('请求太大'), { status: 413 })); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch { reject(Object.assign(new Error('JSON 格式不对'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

const SNAP_NAME = /^[\w一-鿿.-]{1,60}$/

/**
 * 处理一个请求。返回 false 表示路径不归我们管。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  if (!url.pathname.startsWith(PREFIX)) return false
  const route = url.pathname.slice(PREFIX.length)
  const why = rejectReason(req)
  if (why) { fail(res, 403, why); return true }
  try {
    if (req.method === 'GET') {
      if (route === 'entries') {
        const agent = url.searchParams.get('agent') || undefined
        const settings = loadSettings()
        ok(res, { entries: listEntries({ limit: 300, agent }), settings, recent: recentHighRisk(settings.remindHours).map((e) => e.id) })
        return true
      }
      if (route === 'snapshots') {
        const out = await runOrThrow(['snapshots', '-Json'], { agent: 'ui' })
        ok(res, [].concat(lastJsonLine(out) ?? []))
        return true
      }
      if (route === 'diff') {
        const from = url.searchParams.get('from') || ''
        if (!SNAP_NAME.test(from)) { fail(res, 400, '快照名不对'); return true }
        const out = await runOrThrow(['diff', '-From', from, '-Json'], { agent: 'ui' })
        ok(res, [].concat(lastJsonLine(out) ?? []))
        return true
      }
      fail(res, 404, '没有这个接口')
      return true
    }
    if (req.method === 'POST') {
      const body = await readJson(req)
      if (route === 'undo') {
        const id = Number(body.id)
        if (!Number.isInteger(id) || id <= 0) { fail(res, 400, '编号不对'); return true }
        await runOrThrow(['undo', '-Id', String(id), '-Yes'], { agent: 'user' })
        ok(res, lastEntry())
        return true
      }
      if (route === 'capture') {
        const name = String(body.name || 'snap')
        if (!SNAP_NAME.test(name)) { fail(res, 400, '快照名只能用中文、字母、数字、点、横线和下划线'); return true }
        const out = await runOrThrow(['capture', '-Name', name, '-Json'], { agent: 'user' })
        ok(res, lastJsonLine(out))
        return true
      }
      if (route === 'settings') {
        ok(res, saveSettings(body))
        return true
      }
      fail(res, 404, '没有这个接口')
      return true
    }
    fail(res, 405, '不支持的请求方法')
    return true
  } catch (error) {
    fail(res, error?.status || 500, String(error?.message ?? error))
    return true
  }
}
