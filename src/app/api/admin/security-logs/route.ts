import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getCookieName, validateCsrfToken } from '@/lib/csrf'

export const runtime = 'edge'

// 合法的事件类型白名单（防注入）
const VALID_EVENT_TYPES = [
  'login_fail', 'login_locked', 'rate_limited',
  'csrf_fail', 'admin_auth_fail', 'register_suspicious',
  'xss_attempt', 'sql_injection_attempt', 'path_traversal', 'command_injection',
]
const VALID_SEVERITIES = ['info', 'warning', 'critical']

/**
 * GET /api/admin/security-logs
 * 管理员查看安全日志
 *
 * 查询参数：
 *   page    - 页码（默认 1）
 *   limit   - 每页条数（默认 50，最大 200）
 *   severity  - 按严重程度筛选（info/warning/critical）
 *   eventType - 按事件类型筛选
 *   ip      - 按 IP 搜索
 *   days    - 查询最近 N 天的日志（默认 30）
 */
export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const params = req.nextUrl.searchParams
    const page = Math.max(1, Number(params.get('page')) || 1)
    const limit = Math.min(200, Math.max(1, Number(params.get('limit')) || 50))
    const offset = (page - 1) * limit
    const days = Math.min(90, Math.max(1, Number(params.get('days')) || 30))

    // 构建筛选条件
    const conditions: string[] = [`created_at >= datetime('now', '-${days} days')`]
    const args: (string | number)[] = []

    const severity = params.get('severity')
    if (severity && VALID_SEVERITIES.includes(severity)) {
      conditions.push('severity = ?')
      args.push(severity)
    }

    const eventType = params.get('eventType')
    if (eventType && VALID_EVENT_TYPES.includes(eventType)) {
      conditions.push('event_type = ?')
      args.push(eventType)
    }

    const ip = params.get('ip')
    if (ip && ip.length <= 45) {
      conditions.push('ip LIKE ?')
      args.push(`${ip}%`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // 查询总数
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as total FROM security_logs ${whereClause}`,
      args,
    })
    const total = Number((countResult.rows[0] as any)?.total || 0)

    // 查询日志列表
    const logsResult = await db.execute({
      sql: `SELECT id, event_type, severity, ip, user_agent, path, method,
                   email, user_id, detail, cf_country, cf_region, cf_city, created_at
            FROM security_logs ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?`,
      args: [...args, limit, offset],
    })

    // 统计信息
    const statsResult = await db.execute({
      sql: `SELECT severity, COUNT(*) as count FROM security_logs
            WHERE created_at >= datetime('now', '-${days} days')
            GROUP BY severity`,
      args: [],
    })

    const stats: Record<string, number> = { info: 0, warning: 0, critical: 0 }
    for (const row of statsResult.rows) {
      const r = row as any
      if (r.severity && r.count) stats[r.severity] = Number(r.count)
    }

    const logs = logsResult.rows.map((row: any) => ({
      id: Number(row.id),
      eventType: row.event_type,
      severity: row.severity,
      ip: row.ip,
      userAgent: row.user_agent,
      path: row.path,
      method: row.method,
      email: row.email,
      userId: row.user_id ? Number(row.user_id) : null,
      detail: row.detail ? (() => { try { return JSON.parse(row.detail) } catch { return row.detail } })() : null,
      cfCountry: row.cf_country,
      cfRegion: row.cf_region,
      cfCity: row.cf_city,
      createdAt: row.created_at,
    }))

    return NextResponse.json({ logs, total, page, limit, stats })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[admin/security-logs GET]', errMsg)
    // 表可能还不存在（首次部署后还没触发过 logSecurityEvent），返回空结果而不是 500
    if (errMsg.includes('no such table') || errMsg.includes('does not exist')) {
      return NextResponse.json({ logs: [], total: 0, page: 1, limit: 50, stats: { info: 0, warning: 0, critical: 0 } })
    }
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/security-logs
 * 批量清理旧日志
 *
 * Body: { beforeDays: number } — 删除 N 天前的日志（最小 7 天，防止误删）
 */
export async function DELETE(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败' }, { status: 403 })
    }

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const body = await req.json()
    const beforeDays = Math.max(7, Number(body.beforeDays) || 30)

    const result = await db.execute({
      sql: `DELETE FROM security_logs WHERE created_at < datetime('now', '-${beforeDays} days')`,
      args: [],
    })

    const deleted = Number((result as any).rowsAffected || 0)
    console.log(`[admin/security-logs DELETE] uid=${decoded.id} deleted ${deleted} logs older than ${beforeDays} days`)

    return NextResponse.json({ success: true, deleted, message: `已删除 ${deleted} 条 ${beforeDays} 天前的日志` })
  } catch (error) {
    console.error('[admin/security-logs DELETE]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }
}
