// src/app/api/match/auto/route.ts
// 用户前端触发的自动匹配端点
//
// 设计思路：
//   Cloudflare Pages 免费版不支持 Cron Worker，
//   所以用"首个访客触发"模式——
//   周日 12:00（北京）之后，第一个打开 /match 页面的已完成问卷用户触发匹配。
//   数据库锁防止重复执行。

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getWeekKey, isMatchingWindow, executeAutoMatchSafe } from '@/lib/match-engine'
import { executeAutoMatchSafeV2 } from '@/lib/match-engine-v2'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'


async function getAlgorithmVersion(db: ReturnType<typeof getDb>): Promise<'v1' | 'v2'> {
  try {
    const res = await db.execute({ sql: `SELECT value FROM settings WHERE key = 'algorithm_version'`, args: [] })
    return (res.rows[0] as any)?.value === 'v2' ? 'v2' : 'v1'
  } catch { return 'v1' }
}

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
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'match-auto')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    // ── 时间窗口检查 ──
    if (!isMatchingWindow()) {
      return NextResponse.json({ status: 'not_yet', message: '还未到匹配时间' })
    }

    // ── 执行带锁的自动匹配（根据算法版本选择引擎）──
    const version = await getAlgorithmVersion(db)
    const result = version === 'v2'
      ? await executeAutoMatchSafeV2(db)
      : await executeAutoMatchSafe(db)

    // ── 记录自动匹配触发信息（管理员可查看）──
    // 仅在真正执行了匹配时写入（跳过/已完成的空结果不写入）
    if (result.status === 'done') {
      const weekKey = getWeekKey()
      const triggerKey = `auto_match_trigger_${weekKey}`
      try {
        await db.execute({
          sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
          args: [triggerKey, JSON.stringify({
            triggeredBy: decoded.id,
            triggeredAt: new Date().toISOString(),
            status: result.status,
            matchedPairs: result.matchedPairs ?? 0,
            totalEligible: result.totalEligible ?? 0,
            unmatchedUsers: result.unmatchedUsers ?? 0,
          })],
        })
      } catch { /* 非关键操作，失败不影响返回 */ }
    }

    return NextResponse.json(result)

  } catch (error) {
    console.error('[match/auto]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '匹配触发失败' }, { status: 500 })
  }
}
