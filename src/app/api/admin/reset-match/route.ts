// src/app/api/admin/reset-match/route.ts
// 管理员重置本周匹配（清除锁 + 删除匹配记录）

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getCookieName, validateCsrfToken, getClientIp } from '@/lib/csrf'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { resetWeekMatchLock } from '@/lib/match-engine'
import { resetWeekMatchLockV2 } from '@/lib/match-engine-v2'

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
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    // ── 限流 ──
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-reset-match')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    // ── 执行重置（删除锁 + 匹配记录）──
    const versionRes = await db.execute({ sql: `SELECT value FROM settings WHERE key = 'algorithm_version'`, args: [] })
    const version = (versionRes.rows[0] as any)?.value === 'v2' ? 'v2' : 'v1'
    const success = version === 'v2' ? await resetWeekMatchLockV2() : await resetWeekMatchLock()

    if (!success) {
      return NextResponse.json({ error: '重置失败，请稍后重试' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/reset-match]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '重置失败' }, { status: 500 })
  }
}
