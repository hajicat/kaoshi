import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe, verifyPassword } from '@/lib/auth'
import { getCookieName, validateCsrfToken } from '@/lib/csrf'
import { logSecurityEvent } from '@/lib/security'



/**
 * POST /api/admin/verify-password
 * Body: { password: string }
 *
 * 验证管理员"查看详情二级密码"（独立于登录密码）
 * 密码存储在 settings 表的 admin_view_password_hash 键中
 */

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '未登录' }, { status: 401 })
    if (!decoded.isAdmin) return NextResponse.json({ error: '无权限' }, { status: 403 })

    // CSRF 校验
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json()
    const password = (body.password || '').trim()
    if (!password) return NextResponse.json({ valid: false, needSetup: false }, { status: 400 })

    await initDb()

    // 查询独立的查看详情密码哈希
    const result = await db.execute({
      sql: "SELECT value FROM settings WHERE key = 'admin_view_password_hash'",
      args: [],
    })
    const row = result.rows[0] as any

    // 还没设置过二级密码 → 返回提示前端让用户去设置
    if (!row?.value) {
      return NextResponse.json({
        valid: false,
        needSetup: true,
        message: '尚未设置查看详情密码，请先在系统设置中设置',
      })
    }

    // 比对（用 verifyPassword 正确提取盐值再哈希）
    const valid = await verifyPassword(password, row.value)
    if (valid) {
      return NextResponse.json({ valid: true })
    }

    try { await logSecurityEvent(req, { eventType: 'admin_auth_fail', severity: 'critical', userId: decoded.id, detail: { endpoint: 'verify-password' } }) } catch {}
    return NextResponse.json({ valid: false, needSetup: false, message: '密码错误' })
  } catch (error) {
    console.error('[admin verify-password]', (error as any)?.message || error)
    return NextResponse.json({ error: '验证失败', valid: false }, { status: 500 })
  }
}
