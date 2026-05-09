/**
 * 邮件验证码模块 — 基于 Brevo（SendinBlue）API
 * 无需额外依赖，纯 fetch 调用，完美兼容 Cloudflare Edge Runtime
 *
 * 安全设计：
 * - 验证码以 SHA-256 哈希存储，不存明文
 * - 6 位数字码，5 分钟过期，最多尝试 5 次
 * - 同一邮箱 60 秒冷却防刷
 */

// ── 配置 ──
const CODE_EXPIRY_MS = 5 * 60 * 1000       // 5 分钟
const CODE_COOLDOWN_MS = 60 * 1000         // 60 秒冷却
const MAX_ATTEMPTS = 5                      // 最大尝试验证次数
const CODE_LENGTH = 6                       // 6 位数字

// Brevo API 配置
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

export interface VerificationCodeResult {
  success: boolean
  message: string
  error?: string
}

/**
 * 获取发件人地址（从环境变量读取）
 * Brevo 需要先在 Dashboard → Senders 中验证发件邮箱
 */
function getFromEmail(): string {
  return process.env.BREVO_FROM_EMAIL || 'noreply@jaihelp.icu'
}

/**
 * 生成随机 6 位数字验证码
 */
function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += String.fromCharCode(48 + (bytes[i] % 10))  // 48 = '0'
  }
  return code
}

/**
 * 用 SHA-256 哈希验证码（存数据库用，永不存明文）
 */
async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(`jlai-verify:${code}`)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 通过 Brevo API 发送邮件（纯 fetch，无外部依赖）
 */
async function sendViaBrevo(
  toEmail: string,
  subject: string,
  htmlContent: string,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    return { success: false, error: '未配置 BREVO_API_KEY' }
  }

  const fromEmail = getFromEmail()
  const fromName = '吉我爱'

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 秒超时
    let response: Response
    try {
      response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: toEmail }],
          subject,
          htmlContent,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const body = await response.text()
      console.error('[brevo] HTTP error:', response.status, body)
      return { success: false, error: `Brevo ${response.status}: ${body}` }
    }

    const data: any = await response.json()
    return { success: true, messageId: data?.messageId }
  } catch (err: any) {
    console.error('[brevo] 异常:', err?.message || err)
    return { success: false, error: err?.message || '网络请求失败' }
  }
}

import { nicknameToPinyin } from '@/lib/pinyin'

/**
 * 构建验证码邮件 HTML（可选显示默认密码提示）
 * @param code 验证码
 * @param nickname 用户昵称（可选，传入时显示默认密码）
 */
function buildEmailHtml(code: string, nickname?: string): string {
  const defaultPassword = nickname ? nicknameToPinyin(nickname) : ''
  const passwordSection = defaultPassword ? `
      <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 16px; margin: 16px 0; text-align: center;">
        <p style="color: #c2410c; font-size: 13px; font-weight: bold; margin: 0 0 8px;">🔑 你的默认登录密码</p>
        <div style="font-size: 22px; font-weight: bold; letter-spacing: 2px; color: #ea580c; background: #fff; padding: 10px 16px; border-radius: 8px; display: inline-block;">
          ${defaultPassword}
        </div>
        <p style="color: #9a3412; font-size: 11px; margin: 10px 0 0;">注册成功后可用此密码登录，建议登录后修改</p>
      </div>
    ` : ''

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px;">🎁</span>
        <h1 style="color: #333; margin: 12px 0 4px; font-size: 20px;">吉我爱</h1>
        <p style="color: #888; font-size: 14px; margin: 0;">邮箱验证码</p>
      </div>

      <div style="background: linear-gradient(135deg, #ec4899, #a855f7); border-radius: 16px; padding: 32px; text-align: center; margin: 24px 0;">
        <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 0 0 12px;">你的验证码是</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #fff;">
          ${code.split('').join(' ')}
        </div>
        <p style="color: rgba(255,255,255,0.7); font-size: 12px; margin: 16px 0 0;">有效期 5 分钟</p>
      </div>

      ${passwordSection}

      <div style="background: #f8f8f8; border-radius: 12px; padding: 16px; font-size: 13px; color: #666; line-height: 1.6;">
        <p style="margin: 0 0 8px;">⏰ 验证码 <strong>5 分钟</strong>内有效</p>
        <p style="margin: 0 0 8px;">🔒 请勿将验证码告诉他人</p>
        <p style="margin: 0;">如果不是你本人操作，请忽略此邮件</p>
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="text-align: center; color: #aaa; font-size: 12px; margin: 0;">
        此邮件由系统自动发送，请勿回复<br />
        吉我爱 &mdash; 发现校园缘分 ✨
      </p>
    </div>
  `
}

/**
 * 发送邮箱验证码邮件
 *
 * @param email 目标邮箱
 * @param db 数据库客户端（用于存储哈希后的验证码）
 * @param ip 请求者 IP（用于限流）
 *
 * @returns 成功时 success=true；失败时返回错误信息
 */
export async function sendVerificationEmail(
  email: string,
  db: any,
  ip: string,
  nickname?: string,
): Promise<VerificationCodeResult> {
  const now = new Date()

  // ── 1. 冷却检查：同一邮箱 60 秒内不能重发 ──
  try {
    const recentResult = await db.execute({
      sql: `SELECT created_at FROM verification_codes
            WHERE email = ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [email.toLowerCase()],
    })
    if (recentResult.rows.length > 0) {
      const lastSent = new Date((recentResult.rows[0] as any).created_at)
      const elapsed = now.getTime() - lastSent.getTime()
      if (elapsed < CODE_COOLDOWN_MS) {
        const remainingSec = Math.ceil((CODE_COOLDOWN_MS - elapsed) / 1000)
        return {
          success: false,
          error: `请等待 ${remainingSec} 秒后再发送`,
          message: `操作太频繁，请 ${remainingSec} 秒后再试`,
        }
      }
    }
  } catch (_) {
    /* 表可能还不存在，继续执行 */
  }

  // ── 2. 清理过期记录 ──
  try {
    const expiryCutoff = new Date(now.getTime() - CODE_EXPIRY_MS).toISOString()
    await db.execute({
      sql: `DELETE FROM verification_codes WHERE created_at < ? OR attempts >= ?`,
      args: [expiryCutoff, MAX_ATTEMPTS],
    })
  } catch (_) {
    /* 忽略清理错误 */
  }

  // ── 3. 生成验证码并哈希 ──
  const plainCode = generateCode()
  const codeHash = await hashCode(plainCode)

  // ── 4. 存储到数据库 ──
  const expiresAt = new Date(now.getTime() + CODE_EXPIRY_MS).toISOString()
  try {
    await db.execute({
      sql: `INSERT INTO verification_codes (email, code_hash, expires_at, ip, attempts, created_at)
            VALUES (?, ?, ?, ?, 0, ?)`,
      args: [email.toLowerCase(), codeHash, expiresAt, ip, now.toISOString()],
    })
  } catch (err: any) {
    console.error('[email] 存储验证码失败:', err?.message || err)
    return {
      success: false,
      error: '系统错误，请稍后重试',
      message: '验证码生成失败',
    }
  }

  // ── 5. 通过 Brevo API 发送邮件 ──
  const result = await sendViaBrevo(
    email,
    '你的验证码',
    buildEmailHtml(plainCode, nickname),
  )

  if (!result.success) {
    // 邮件发送失败 → 回滚刚插入的验证码记录，让用户可以立即重发
    try {
      await db.execute({
        sql: `DELETE FROM verification_codes WHERE code_hash = ?`,
        args: [codeHash],
      })
    } catch (_) { /* 回滚失败不影响返回 */ }
    return {
      success: false,
      error: `邮件发送失败（${result.error}）`,
      message: `验证码发送失败，请稍后重试`,
    }
  }

  return {
    success: true,
    message: '验证码已发送，请查收邮箱',
  }
}

/**
 * 验证用户提交的验证码是否正确
 *
 * @param email 用户邮箱
 * @param userInput 用户输入的验证码
 * @param db 数据库客户端
 *
 * @returns valid=true 表示验证通过
 */
export async function verifyCode(
  email: string,
  userInput: string,
  db: any
): Promise<{ valid: boolean; error?: string }> {
  if (!userInput || typeof userInput !== 'string' || !/^\d{6}$/.test(userInput)) {
    return { valid: false, error: '验证码格式不正确' }
  }

  const inputHash = await hashCode(userInput)
  const emailLower = email.toLowerCase()
  const nowIso = new Date().toISOString()

  try {
    // ── 先递增 attempts（不论验证码是否正确），防止暴力破解 ──
    // 原方案 WHERE 含 code_hash，错误验证码不会递增 attempts，限流形同虚设
    const incrementResult = await db.execute({
      sql: `UPDATE verification_codes
            SET attempts = attempts + 1
            WHERE email = ? AND expires_at > ? AND attempts < ?
            RETURNING id, attempts, code_hash`,
      args: [emailLower, nowIso, MAX_ATTEMPTS],
    })

    const incRow = incrementResult.rows[0] as any

    if (!incRow) {
      // 无有效验证码记录（已过期 / 尝试次数耗尽 / 不存在）
      return { valid: false, error: '验证码已过期或尝试次数过多，请重新获取' }
    }

    // 检查哈希是否匹配
    const storedHash = String(incRow.code_hash)
    if (storedHash !== inputHash) {
      if (Number(incRow.attempts) >= MAX_ATTEMPTS) {
        // 次数耗尽，删除验证码
        await db.execute({ sql: `DELETE FROM verification_codes WHERE id = ?`, args: [incRow.id] })
        return { valid: false, error: '验证码尝试次数过多，请重新获取' }
      }
      return { valid: false, error: '验证码错误，请重新输入' }
    }

    // 验证成功，立即删除防止重复使用
    await db.execute({ sql: `DELETE FROM verification_codes WHERE id = ?`, args: [incRow.id] })
    return { valid: true }
  } catch (err: any) {
    console.error('[verify-code]', err?.message || err)
    return { valid: false, error: '验证失败，请稍后重试' }
  }
}
