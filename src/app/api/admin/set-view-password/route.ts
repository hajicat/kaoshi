import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe, hashPassword, verifyPassword } from '@/lib/auth'
import { validatePassword } from '@/lib/validation'
import { getCookieName, validateCsrfToken } from '@/lib/csrf'
import { logSecurityEvent } from '@/lib/security'



/**
 * POST /api/admin/set-view-password
 * Body: { password: string }
 *
 * 设置/修改管理员查看详情的独立二级密码
 * 存储在 settings 表 admin_view_password_hash 键中
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

    // CSRF check — 使用统一的 validateCsrfToken（恒定时间比较 + 正确的 cookie 名）
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: 'CSRF验证失败' }, { status: 403 })
    }

    const body = await req.json()
    const newPassword = (body.password || '').trim()

    if (!newPassword) {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 })
    }

    // 校验新密码格式
    const pwCheck = validatePassword(newPassword)
    if (!pwCheck.valid) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 })
    }

    await initDb()

    // 查询是否已有密码
    const existing = await db.execute({
      sql: "SELECT value FROM settings WHERE key = 'admin_view_password_hash'",
      args: [],
    })
    const existingHash = (existing.rows[0] as any)?.value

    // 已有密码 → 需要验证原密码
    if (existingHash) {
      const currentPw = (body.currentPassword || '').trim()
      if (!currentPw) {
        return NextResponse.json({ error: '修改密码需要输入当前密码', needCurrent: true }, { status: 400 })
      }
      const valid = await verifyPassword(currentPw, existingHash)
      if (!valid) {
        try { await logSecurityEvent(req, { eventType: 'admin_auth_fail', severity: 'critical', userId: decoded.id, detail: { endpoint: 'set-view-password' } }) } catch {}
        return NextResponse.json({ error: '当前密码错误', needCurrent: true }, { status: 403 })
      }
    }

    // 哈希并存储新密码
    const hashed = await hashPassword(newPassword)
    const now = new Date().toISOString()

    await db.execute({
      sql: `INSERT INTO settings (key, value, updated_at) VALUES ('admin_view_password_hash', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [hashed, now],
    })

    const msg = existingHash ? '二级密码已更新' : '二级密码已设置'
    return NextResponse.json({ success: true, message: msg })
  } catch (error) {
    console.error('[admin set-view-password]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '设置失败', success: false }, { status: 500 })
  }
}

/**
 * GET /api/admin/set-view-password
 *
 * 检查是否已设置过二级密码
 */

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '无权限' }, { status: 403 })

    await initDb()

    const result = await db.execute({
      sql: "SELECT value FROM settings WHERE key = 'admin_view_password_hash'",
      args: [],
    })
    const row = result.rows[0] as any

    return NextResponse.json({
      hasPassword: !!row?.value,
    })
  } catch (error) {
    return NextResponse.json({ hasPassword: false }, { status: 500 })
  }
}
