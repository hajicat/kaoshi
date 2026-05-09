// src/app/api/admin/notify/route.ts
// 管理员手动触发匹配通知邮件发送
//
// 功能：
//   - 查询 GET：返回当前通知状态（锁状态、已发送数、跳过数、失败数）
//   - 触发 POST：重置通知锁并重新发送（可选 force 参数清除已发送记录）
//
// 安全：
//   - 需要管理员认证 + CSRF + 限流
//   - 复用 sendMatchNotifications 核心逻辑

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/csrf'
import { getWeekKey, getPrevWeekKey } from '@/lib/week'
import { sendMatchNotifications } from '@/lib/match-email'




export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // ── 管理员认证 ──
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded || !decoded.isAdmin) return NextResponse.json({ error: '无权限' }, { status: 403 })

    let weekKey = getWeekKey()
    const prevWeekKey = getPrevWeekKey()

    // 周一 getWeekKey() 返回新周，但通知状态在上一周 → 回退查询（V1+V2）
    const [curMatchCnt, prevMatchCnt, curMatchV2Cnt, prevMatchV2Cnt] = await Promise.all([
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?', args: [weekKey] }),
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?', args: [prevWeekKey] }),
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?', args: [weekKey] }),
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?', args: [prevWeekKey] }),
    ])
    const curTotal = Number((curMatchCnt.rows[0] as any).cnt) + Number((curMatchV2Cnt.rows[0] as any).cnt)
    const prevTotal = Number((prevMatchCnt.rows[0] as any).cnt) + Number((prevMatchV2Cnt.rows[0] as any).cnt)
    if (curTotal === 0 && prevTotal > 0) {
      weekKey = prevWeekKey
    }

    const lockKey = `notify_lock_${weekKey}`

    // 查锁状态
    const lockResult = await db.execute({
      sql: "SELECT value, updated_at FROM settings WHERE key = ?",
      args: [lockKey],
    })
    const lockRow = lockResult.rows[0] as any
    const lockValue = lockRow?.value || null

    // 查已发送记录数
    const sentCount = await db.execute({
      sql: "SELECT COUNT(*) as cnt FROM settings WHERE key LIKE ?",
      args: [`notify_sent_${weekKey}_%`],
    })
    const sentNum = Number((sentCount.rows[0] as any)?.cnt || 0)

    // 查本周匹配记录数（V1+V2）
    const [matchCount, matchV2Count] = await Promise.all([
      db.execute({ sql: "SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?", args: [weekKey] }),
      db.execute({ sql: "SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?", args: [weekKey] }),
    ])
    const matchNum = Number((matchCount.rows[0] as any)?.cnt || 0) + Number((matchV2Count.rows[0] as any)?.cnt || 0)

    return NextResponse.json({
      notifyLockStatus: lockValue,   // null / running / done
      notifyUpdatedAt: lockRow?.updated_at || null,
      notifySentCount: sentNum,
      matchRecordCount: matchNum,
      weekKey,
    })
  } catch (error) {
    console.error('[admin/notify GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}


export async function POST(req: NextRequest) {
  try {
    // ── 管理员认证 ──
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded || !decoded.isAdmin) return NextResponse.json({ error: '无权限' }, { status: 403 })

    // ── CSRF ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败' }, { status: 403 })
    }

    // ── 限流 ──
    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-notify')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    // ── 解析参数 ──
    const body = await req.json().catch(() => ({}))
    const force = body.force === true  // 是否强制重发（清除已有的发送记录）

    let weekKey = getWeekKey()
    const prevWeekKey = getPrevWeekKey()

    // 周一回退：查哪周有匹配记录（V1+V2）
    const [curMatchCnt, prevMatchCnt, curMatchV2Cnt, prevMatchV2Cnt] = await Promise.all([
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?', args: [weekKey] }),
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?', args: [prevWeekKey] }),
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?', args: [weekKey] }),
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?', args: [prevWeekKey] }),
    ])
    const curTotal = Number((curMatchCnt.rows[0] as any).cnt) + Number((curMatchV2Cnt.rows[0] as any).cnt)
    const prevTotal = Number((prevMatchCnt.rows[0] as any).cnt) + Number((prevMatchV2Cnt.rows[0] as any).cnt)
    if (curTotal === 0 && prevTotal > 0) {
      weekKey = prevWeekKey
    }

    const lockKey = `notify_lock_${weekKey}`

    if (force) {
      // 强制模式：删除锁 + 删除所有已发送记录 → 完全重来
      await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
      await db.execute({ sql: "DELETE FROM settings WHERE key LIKE ?", args: [`notify_sent_${weekKey}_%`] })
    } else {
      // 普通模式：只删锁，保留已发送记录（未发的会补发，已发的会跳过）
      await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
    }

    // 执行发送
    const result = await sendMatchNotifications()

    return NextResponse.json({
      success: true,
      ...result,
      forced: force,
    })
  } catch (error) {
    console.error('[admin/notify POST]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '发送失败', detail: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
