import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { hashPassword, verifyTokenSafe } from '@/lib/auth'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken } from '@/lib/csrf'
import { detectAttackPatterns } from '@/lib/security'


/**
 * 用 SHA-256 哈希 token（与 forgot-password 保持一致）
 */
async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(`jlai-reset:${token}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function POST(req: NextRequest) {
  try {
    // CSRF 校验
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // 限流
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'reset-password')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁，请稍后再试' }, { status: 429 })
    }

    const body = await req.json()
    try { await detectAttackPatterns(req, body) } catch {}
    const { token, password } = body

    // 参数校验
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: '缺少重置令牌' }, { status: 400 })
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: '密码至少需要 8 个字符' }, { status: 400 })
    }
    if (password.length > 128) {
      return NextResponse.json({ error: '密码过长' }, { status: 400 })
    }
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(password)) {
      return NextResponse.json({ error: '密码需同时包含字母和数字' }, { status: 400 })
    }

    const db = getDb()
    await initDb()

    const tokenHash = await hashToken(token)

    // 查找有效 token
    const nowIso = new Date().toISOString()
    const tokenResult = await db.execute({
      sql: `SELECT id, user_id, used, expires_at FROM password_reset_tokens
            WHERE token_hash = ? AND used = 0 AND expires_at > ?`,
      args: [tokenHash, nowIso],
    })

    const tokenRow = tokenResult.rows[0] as any
    if (!tokenRow) {
      return NextResponse.json({ error: '重置链接无效或已过期，请重新申请' }, { status: 400 })
    }

    // 标记为已使用（防重复使用）
    await db.execute({
      sql: `UPDATE password_reset_tokens SET used = 1 WHERE id = ?`,
      args: [tokenRow.id],
    })

    // 哈希新密码并更新
    const newPasswordHash = await hashPassword(password)
    await db.execute({
      sql: `UPDATE users SET password_hash = ?, password_changed_at = datetime('now'),
            failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
      args: [newPasswordHash, tokenRow.user_id],
    })

    console.log(`[reset-password] 用户 ${tokenRow.user_id} 密码已重置`)
    return NextResponse.json({ message: '密码重置成功，请使用新密码登录' })

  } catch (error) {
    console.error('[reset-password]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '服务器错误，请稍后重试' }, { status: 500 })
  }
}
