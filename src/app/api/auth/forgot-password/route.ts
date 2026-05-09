import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'
import { logSecurityEvent, detectAttackPatterns } from '@/lib/security'


// Token 有效期 30 分钟
const TOKEN_EXPIRY_MS = 30 * 60 * 1000
// 同一邮箱冷却时间（防刷）
const EMAIL_COOLDOWN_MS = 60 * 1000

/**
 * 生成安全的随机 token（32 字节 = 64 hex 字符）
 */
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 用 SHA-256 哈希 token（存数据库用）
 */
async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(`jlai-reset:${token}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * HTML entity 转义，防止嵌入邮件模板时被注入
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 校验重置 URL 是否属于预期域名（防止 NEXT_PUBLIC_APP_URL 被污染时的注入风险）
 * 允许的域名列表：从环境变量 ALLOWED_RESET_DOMAINS 读取，逗号分隔
 * 默认允许 jaihelp.icu 和 localhost（开发用）
 */
function validateResetDomain(resetUrl: string): boolean {
  try {
    const url = new URL(resetUrl)
    // 只允许 http/https 协议
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

    // 域名白名单检查
    const allowedDomains = (process.env.ALLOWED_RESET_DOMAINS || 'jaihelp.icu,localhost')
      .split(',')
      .map(d => d.trim().toLowerCase())
      .filter(Boolean)
    const host = url.hostname.toLowerCase()
    return allowedDomains.includes(host)
  } catch {
    // 无效 URL（构造失败）
    return false
  }
}

/**
 * 构建重置密码邮件 HTML
 */
function buildResetEmailHtml(resetUrl: string): string {
  // 安全：先校验域名合法性，再做 HTML 转义后嵌入模板
  const safeUrl = escapeHtml(resetUrl)
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px;">🎁</span>
        <h1 style="color: #333; margin: 12px 0 4px; font-size: 20px;">吉我爱</h1>
        <p style="color: #888; font-size: 14px; margin: 0;">重置密码</p>
      </div>

      <div style="background: linear-gradient(135deg, #ec4899, #a855f7); border-radius: 16px; padding: 28px; text-align: center; margin: 24px 0;">
        <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 0 0 12px;">我们收到了你的密码重置请求</p>
        <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 0;">点击下方按钮设置新密码（30 分钟内有效）</p>
      </div>

      <a href="${safeUrl}"
         style="display: block; width: 100%; padding: 14px; background: #333; color: #fff; text-align: center; text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 600; margin: 20px 0;">
         🔑 重置密码
      </a>

      <div style="background: #f8f8f8; border-radius: 12px; padding: 16px; font-size: 13px; color: #666; line-height: 1.6;">
        <p style="margin: 0 0 8px;">⏰ 链接 <strong>30 分钟</strong>内有效</p>
        <p style="margin: 0 0 8px;">🔒 如果这不是你本人操作，请忽略此邮件</p>
        <p style="margin: 0; word-break: break-all; font-size: 11px; color: #999;">如果按钮无法点击，请复制此链接到浏览器打开：<br />${safeUrl}</p>
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="text-align: center; color: #aaa; font-size: 12px; margin: 0;">
        此邮件由系统自动发送，请勿回复<br />
        吉我爱 &mdash; 发现校园缘分 ✨
      </p>
    </div>
  `
}

export async function POST(req: NextRequest) {
  try {
    // CSRF 校验
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // 限流
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'forgot-password')
    if (!rateResult.allowed) {
      try { await logSecurityEvent(req, { eventType: 'rate_limited', severity: 'warning', detail: { action: 'forgot-password', retryAfter: rateResult.retryAfter } }) } catch {}
      return NextResponse.json({ error: '操作太频繁，请稍后再试' }, { status: 429 })
    }

    const body = await req.json()
    try { await detectAttackPatterns(req, body) } catch {}
    const { email } = body
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 })
    }

    const db = getDb()
    await initDb()

    // 查找用户
    const userResult = await db.execute({
      sql: 'SELECT id, email FROM users WHERE email = ?',
      args: [email.toLowerCase().trim()],
    })

      // 无论用户是否存在都返回成功（防止邮箱枚举攻击）
      // 但只有存在时才真正发邮件
      if (userResult.rows.length === 0) {
        return NextResponse.json({ message: '如果该邮箱已注册，重置链接已发送' })
      }

    const userId = (userResult.rows[0] as any).id
    const userEmail = (userResult.rows[0] as any).email

    // 冷却检查：同一邮箱 60 秒内不能重发
    try {
      const recentResult = await db.execute({
        sql: `SELECT created_at FROM password_reset_tokens
              WHERE user_id = ? AND used = 0
              ORDER BY created_at DESC LIMIT 1`,
        args: [userId],
      })
      if (recentResult.rows.length > 0) {
        const lastSent = new Date((recentResult.rows[0] as any).created_at)
        const elapsed = Date.now() - lastSent.getTime()
        if (elapsed < EMAIL_COOLDOWN_MS) {
          const remainingSec = Math.ceil((EMAIL_COOLDOWN_MS - elapsed) / 1000)
          return NextResponse.json({
            error: `操作太频繁，请 ${remainingSec} 秒后再试`,
            message: `请等待 ${remainingSec} 秒后重试`,
          })
        }
      }
    } catch (_) { /* 表可能还不存在 */ }

    // 清理过期/已使用的旧 token
    const expiryCutoff = new Date(Date.now() - TOKEN_EXPIRY_MS).toISOString()
    try {
      await db.execute({
        sql: `DELETE FROM password_reset_tokens WHERE expires_at < ? OR used = 1`,
        args: [expiryCutoff],
      })
    } catch (_) { /* ignore */ }

    // 生成 token 并哈希存储
    const plainToken = generateToken()
    const tokenHash = await hashToken(plainToken)
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString()

    await db.execute({
      sql: `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used, created_at)
            VALUES (?, ?, ?, 0, datetime('now'))`,
      args: [userId, tokenHash, expiresAt],
    })

    // 发送邮件（使用配置的公开 URL，避免 CF Pages 内部域名问题）
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL || (new URL(req.url).origin)
    const resetUrl = `${appOrigin}/reset-password?token=${plainToken}`

    // 安全校验：确保 URL 合法（防止环境变量污染导致注入）
    if (!validateResetDomain(resetUrl)) {
      console.error('[forgot-password] resetUrl 域名校验失败:', appOrigin)
      return NextResponse.json({ error: '服务器配置错误' }, { status: 500 })
    }

    const apiKey = process.env.BREVO_API_KEY
    if (!apiKey) {
      console.error('[forgot-password] 未配置 BREVO_API_KEY')
      return NextResponse.json({ error: '邮件服务暂时不可用' }, { status: 500 })
    }

    const brevoController = new AbortController()
    const brevoTimeoutId = setTimeout(() => brevoController.abort(), 10000)
    let brevoRes: Response
    try {
      brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          sender: { name: '吉我爱', email: process.env.BREVO_FROM_EMAIL || 'noreply@jaihelp.icu' },
          to: [{ email: userEmail }],
          subject: '重置你的密码',
          htmlContent: buildResetEmailHtml(resetUrl),
        }),
        signal: brevoController.signal,
      })
    } finally {
      clearTimeout(brevoTimeoutId)
    }

    if (!brevoRes.ok) {
      const body = await brevoRes.text()
      console.error('[forgot-password] Brevo error:', brevoRes.status, body)
      return NextResponse.json({ error: '邮件发送失败，请稍后重试' }, { status: 500 })
    }

    return NextResponse.json({ message: '重置链接已发送，请查收邮箱' })

  } catch (error) {
    console.error('[forgot-password]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '服务器错误，请稍后重试' }, { status: 500 })
  }
}
