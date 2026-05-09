// src/app/api/match/notify/route.ts
// 匹配结果邮件通知端点
//
// 触发模式：与 auto match 完全一致的"首个访客触发"——
//   周日 20:00（北京时间）之后，第一个打开 /match 页面的用户触发邮件发送。
//
// 安全设计：
//   - 需要登录认证
//   - CSRF 校验
//   - IP 限流（防止恶意刷接口）
//   - 分布式锁防止重复执行
//   - 邮件发送间隔 3 秒（防 Brevo 频率限制）
//   - settings 表记录已发送状态（防重复）
//
// 调用方式：POST /api/match/notify （前端 fire-and-forget）

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getWeekKey } from '@/lib/match-engine'
import { sendMatchNotifications } from '@/lib/match-email'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge'

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

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // ── 限流 ──
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'match-notify')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    // ── 执行通知发送 ──
    const result = await sendMatchNotifications()

    // 根据状态返回不同的 HTTP 状态码
    switch (result.status) {
      case 'done':
        return NextResponse.json({
          success: true,
          weekKey: result.weekKey,
          sent: result.sent,
          skipped: result.skipped,
          failed: result.failed,
        })
      case 'already_done':
      case 'in_progress':
        return NextResponse.json({ status: result.status, message: '通知已在处理中' })
      case 'not_yet':
        return NextResponse.json({ status: 'not_yet', message: result.message || '还未到揭晓时间' })
      case 'no_matches':
        return NextResponse.json({ status: 'no_matches', message: '本周无匹配记录' })
      default:
        return NextResponse.json(result, { status: 500 })
    }
  } catch (error) {
    console.error('[match/notify]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '通知发送失败' }, { status: 500 })
  }
}
