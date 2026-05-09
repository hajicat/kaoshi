import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe, hashPassword, verifyPassword as verifyAdminPassword } from '@/lib/auth'
import { validatePassword as validatePw } from '@/lib/validation'
import { getCookieName, validateCsrfToken, getClientIp } from '@/lib/csrf'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { logSecurityEvent } from '@/lib/security'

export const runtime = 'edge'

/**
 * POST /api/admin/reset-user-password
 * Body: { userId: number, newPassword: string, confirmPassword: string }
 *
 * 管理员重置指定用户的登录密码。
 * 安全措施：
 *   - 管理员身份认证 (verifyTokenSafe + isAdmin)
 *   - CSRF 校验
 *   - 二级密码确认（防止 cookie 被盗后批量重置）
 *   - 限流
 *   - 新密码强度校验（与 change-password 一致）
 *   - 不允许重置自己的密码（应走正常改密流程）
 */
export async function POST(req: NextRequest) {
  try {
    // ── 身份验证 ──
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })
    if (!decoded.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // ── 解析参数（二级密码 + 新密码）──
    const body = await req.json()
    const adminPassword = body.adminPassword as string | undefined
    if (!adminPassword || typeof adminPassword !== 'string') {
      return NextResponse.json({ error: '请输入管理员密码以确认操作' }, { status: 400 })
    }
    try {
      const pwResult = await db.execute({
        sql: "SELECT value FROM settings WHERE key = 'admin_view_password_hash'",
        args: [],
      })
      const pwRow = pwResult.rows[0] as any
      if (pwRow?.value && !(await verifyAdminPassword(adminPassword, String(pwRow.value)))) {
        try { await logSecurityEvent(req, { eventType: 'admin_auth_fail', severity: 'critical', userId: decoded.id, detail: { endpoint: 'reset-user-password' } }) } catch {}
        return NextResponse.json({ error: '管理员密码错误' }, { status: 403 })
      }
      // 如果还没设置过二级密码则放行（兼容旧部署）
    } catch (_) { /* 查询失败时继续 */ }

    // ── 限流 ──
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-reset-pw')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁，请稍后再试' }, { status: 429 })
    }

    const userId = Number(body.userId)
    const newPassword = (body.newPassword || '').trim()
    const confirmPassword = (body.confirmPassword || '').trim()

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
    }
    if (!newPassword) {
      return NextResponse.json({ error: '请输入新密码' }, { status: 400 })
    }
    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: '两次输入的密码不一致' }, { status: 400 })
    }

    // 密码强度校验
    const pwCheck = validatePw(newPassword)
    if (!pwCheck.valid) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 })
    }

    // ── 不允许重置自己的密码 ──
    if (userId === decoded.id) {
      return NextResponse.json({ error: '不能重置自己的密码，请使用修改密码功能' }, { status: 400 })
    }

    // ── 检查目标用户是否存在 ──
    const userResult = await db.execute({
      sql: `SELECT id, nickname FROM users WHERE id = ?`,
      args: [userId],
    })
    const targetUser = userResult.rows[0] as any
    if (!targetUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // ── 哈希新密码并更新 ──
    const newHash = await hashPassword(newPassword)
    const changedAt = new Date().toISOString()

    await db.execute({
      sql: `UPDATE users SET password_hash = ?, password_changed_at = ?,
            failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
      args: [newHash, changedAt, userId],
    })

    console.log(`[admin/reset-user-password] uid=${userId}(${targetUser.nickname}) password reset by admin uid=${decoded.id}`)

    return NextResponse.json({
      success: true,
      message: `已重置用户「${targetUser.nickname}」的密码`,
    })
  } catch (error) {
    console.error('[admin/reset-user-password]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '重置密码失败' }, { status: 500 })
  }
}
