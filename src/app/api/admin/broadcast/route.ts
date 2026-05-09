// src/app/api/admin/broadcast/route.ts
// 管理员群发邮件接口
//
// 功能：
//   - POST：向选定用户批量发送自定义邮件
//   - 可指定用户ID列表（不传或空数组=全部用户）
//   - 可配置发送间隔（默认5秒），防止邮件商拉黑
//   - 实时返回发送进度（Streaming/轮询模式）
//
// 安全：
//   - 管理员 JWT 认证 + CSRF + 限流
//   - 复用 email.ts 的 sendViaBrevo 基础设施

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/csrf'

export const runtime = 'edge'

// Brevo API 配置（与 email.ts 保持一致）
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

function getFromEmail(): string {
  return process.env.BREVO_FROM_EMAIL || 'noreply@jaihelp.icu'
}

/**
 * 发送单封邮件（内部函数）
 */
async function sendOneEmail(
  toEmail: string,
  subject: string,
  htmlContent: string,
): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    return { success: false, error: '未配置 BREVO_API_KEY' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)
  let response: Response
  try {
    response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: { name: '吉我爱', email: getFromEmail() },
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
    const body = await response.text().catch(() => '')
    return { success: false, error: `Brevo ${response.status}: ${body}` }
  }

  return { success: true }
}

/**
 * POST /api/admin/broadcast
 *
 * Body:
 *   userIds?: number[]    // 目标用户ID列表，空/不传=全部用户
 *   subject: string       // 邮件标题（必填）
 *   htmlContent: string   // 邮件HTML内容（必填）
 *   intervalMs?: number   // 发送间隔毫秒，默认5000（5秒）
 *
 * 返回：
 *   { total, sent, failed, results: [{ id, nickname, email, ok, error? }] }
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
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // ── 限流 ──
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-broadcast')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁，请稍后再试' }, { status: 429 })
    }

    // ── 解析请求体 ──
    const body = await req.json() as {
      userIds?: number[]
      subject?: string
      htmlContent?: string
      intervalMs?: number
    }

    const { userIds, subject, htmlContent, intervalMs = 0 } = body

    // 参数校验
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return NextResponse.json({ error: '邮件标题不能为空' }, { status: 400 })
    }
    if (!htmlContent || typeof htmlContent !== 'string' || htmlContent.trim().length === 0) {
      return NextResponse.json({ error: '邮件内容不能为空' }, { status: 400 })
    }
    if (subject.length > 200) {
      return NextResponse.json({ error: '邮件标题过长（最多200字）' }, { status: 400 })
    }
    if (htmlContent.length > 100000) {
      return NextResponse.json({ error: '邮件内容过长（最大100KB）' }, { status: 400 })
    }
    // Brevo 发送速度快，不需要间隔；保留参数兼容但默认 0
    const interval = Math.max(0, Math.min(intervalMs, 30000))

    // 查询目标用户
    let targetUsers: any[]

    if (userIds && Array.isArray(userIds) && userIds.length > 0) {
      // 指定用户列表
      if (userIds.length > 500) {
        return NextResponse.json({ error: '单次最多选择500个用户' }, { status: 400 })
      }
      const placeholders = userIds.map(() => '?').join(',')
      const result = await db.execute({
        sql: `SELECT id, nickname, email FROM users WHERE id IN (${placeholders}) ORDER BY id`,
        args: [...userIds],
      })
      targetUsers = result.rows
    } else {
      // 全部用户（排除管理员自己，避免给自己发）
      const result = await db.execute({
        sql: `SELECT id, nickname, email FROM users WHERE is_admin = 0 OR id != ? ORDER BY id`,
        args: [decoded.id],
      })
      targetUsers = result.rows
    }

    if (targetUsers.length === 0) {
      return NextResponse.json({ error: '没有可发送的目标用户', }, { status: 400 })
    }

    // ── 逐个发送（带间隔）──
    let sent = 0
    let failed = 0
    const results: Array<{ id: number; nickname: string; email: string; ok: boolean; error?: string }> = []

    for (let i = 0; i < targetUsers.length; i++) {
      const user = targetUsers[i] as any
      const uid = Number(user.id)
      const email = String(user.email || '')
      const nickname = String(user.nickname || '')

      if (!email || !email.includes('@')) {
        results.push({ id: uid, nickname, email, ok: false, error: '无有效邮箱' })
        failed++
        continue
      }

      const result = await sendOneEmail(email, subject.trim(), htmlContent.trim())
      if (result.success) {
        results.push({ id: uid, nickname, email, ok: true })
        sent++
      } else {
        results.push({ id: uid, nickname, email, ok: false, error: result.error })
        failed++
      }

      // 最后一封不需要等待
      if (i < targetUsers.length - 1) {
        await new Promise(resolve => setTimeout(resolve, interval))
      }
    }

    console.log(`[admin/broadcast] by=${decoded.id} total=${targetUsers.length} sent=${sent} failed=${failed}`)

    return NextResponse.json({
      total: targetUsers.length,
      sent,
      failed,
      results,
    })
  } catch (error) {
    console.error('[admin/broadcast]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '群发邮件失败' }, { status: 500 })
  }
}
