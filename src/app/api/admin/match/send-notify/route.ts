// src/app/api/admin/match/send-notify/route.ts
// 管理员手动发送匹配通知邮件（支持发给 A / B / 双方）

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName, getClientIp } from '@/lib/csrf'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { sendOneEmail } from '@/lib/match-email'


export async function POST(req: NextRequest) {
  try {
    // ── 管理员认证 ──
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    // ── CSRF ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // ── 限流 ──
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-send-notify')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    // ── 解析参数 ──
    const body = await req.json().catch(() => ({}))
    const matchId = Number(body.matchId)
    const target = body.target // 'a' | 'b' | 'both'

    if (!matchId || !Number.isInteger(matchId)) {
      return NextResponse.json({ error: '缺少匹配记录 ID' }, { status: 400 })
    }
    if (!['a', 'b', 'both'].includes(target)) {
      return NextResponse.json({ error: 'target 必须是 a、b 或 both' }, { status: 400 })
    }

    // ── 查询匹配记录（版本感知）──
    const versionRes = await db.execute({ sql: `SELECT value FROM settings WHERE key = 'algorithm_version'`, args: [] })
    const version = (versionRes.rows[0] as any)?.value === 'v2' ? 'v2' : 'v1'
    const primaryTable = version === 'v2' ? 'matches_v2' : 'matches'
    const altTable = version === 'v2' ? 'matches' : 'matches_v2'

    let matchRes = await db.execute({
      sql: `SELECT id, user_a, user_b, score, week_key, reasons FROM ${primaryTable} WHERE id = ?`,
      args: [matchId],
    })
    if (matchRes.rows.length === 0) {
      matchRes = await db.execute({
        sql: `SELECT id, user_a, user_b, score, week_key, reasons FROM ${altTable} WHERE id = ?`,
        args: [matchId],
      })
    }
    if (matchRes.rows.length === 0) {
      return NextResponse.json({ error: '匹配记录不存在' }, { status: 404 })
    }
    const match = matchRes.rows[0] as any

    // ── 查询双方用户信息 ──
    const [userARes, userBRes] = await Promise.all([
      db.execute({
        sql: 'SELECT id, nickname, gender, email FROM users WHERE id = ?',
        args: [Number(match.user_a)],
      }),
      db.execute({
        sql: 'SELECT id, nickname, gender, email FROM users WHERE id = ?',
        args: [Number(match.user_b)],
      }),
    ])
    const userA = userARes.rows[0] as any
    const userB = userBRes.rows[0] as any
    if (!userA || !userB) {
      return NextResponse.json({ error: '用户数据不完整' }, { status: 500 })
    }

    // ── 解析匹配原因 ──
    let reasons: string[] = []
    try { reasons = JSON.parse(String(match.reasons || '[]')) } catch { /* ignore */ }

    // ── 按 target 发送邮件 ──
    const users = [
      { email: userA.email, name: userA.nickname, gender: userA.gender },
      { email: userB.email, name: userB.nickname, gender: userB.gender },
    ]
    const targets = target === 'both' ? [0, 1] : target === 'a' ? [0] : [1]

    let sent = 0
    let failed = 0
    for (const i of targets) {
      const me = users[i]
      const partner = users[1 - i]
      const success = await sendOneEmail(me.email, {
        nickname: me.name,
        partnerNickname: partner.name,
        partnerGender: partner.gender,
        score: Number(match.score),
        weekKey: String(match.week_key),
        topReasons: reasons,
      })
      if (success) sent++
      else failed++
    }

    return NextResponse.json({ success: true, sent, failed })
  } catch (error) {
    console.error('[admin/match/send-notify]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '发送失败' }, { status: 500 })
  }
}
