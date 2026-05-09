import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getCookieName } from '@/lib/csrf'
import { getWeekKey, getPrevWeekKey } from '@/lib/week'



function formatBeijingTime(utcStr: string | null | undefined): string {
  if (!utcStr) return '-'
  try {
    const d = new Date(utcStr + (utcStr.endsWith('Z') ? '' : 'Z'))
    if (isNaN(d.getTime())) return String(utcStr)
    const pad = (n: number) => String(n).padStart(2, '0')
    const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000)
    return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`
  } catch { return String(utcStr) }
}


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value || ''
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    let weekKey = getWeekKey()
    let triggerKey = `auto_match_v2_trigger_${weekKey}`

    const [matchesResult, lockResult, triggerResult] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?`,
        args: [weekKey],
      }),
      db.execute({
        sql: `SELECT value FROM settings WHERE key = ?`,
        args: [`matching_lock_v2_${weekKey}`],
      }),
      db.execute({
        sql: `SELECT value, updated_at FROM settings WHERE key = ?`,
        args: [triggerKey],
      }),
    ])

    let matchedPairs = Number((matchesResult.rows[0] as any)?.cnt || 0)
    let lockValue = (lockResult.rows[0] as any)?.value

    if (matchedPairs === 0 && !lockValue) {
      const prevWeekKey = getPrevWeekKey()
      const [prevMatchesResult, prevLockResult] = await Promise.all([
        db.execute({ sql: `SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?`, args: [prevWeekKey] }),
        db.execute({ sql: `SELECT value FROM settings WHERE key = ?`, args: [`matching_lock_v2_${prevWeekKey}`] }),
      ])
      const prevCnt = Number((prevMatchesResult.rows[0] as any)?.cnt || 0)
      if (prevCnt > 0) {
        matchedPairs = prevCnt
        lockValue = (prevLockResult.rows[0] as any)?.value
        weekKey = prevWeekKey
        triggerKey = `auto_match_v2_trigger_${prevWeekKey}`
      }
    }

    let autoTriggerInfo: any = null
    const triggerRow = triggerResult.rows[0] as any
    const isEmptyRecord = triggerRow?.value && (() => {
      try {
        const d = JSON.parse(triggerRow.value)
        return (d.matchedPairs ?? 0) === 0 && (d.totalEligible ?? 0) === 0
      } catch { return false }
    })()

    if (triggerRow?.value && !isEmptyRecord) {
      try {
        autoTriggerInfo = JSON.parse(triggerRow.value)
        autoTriggerInfo.triggeredAtFormatted = formatBeijingTime(triggerRow.updated_at)
      } catch {}
    } else if (lockValue === 'done' && matchedPairs > 0) {
      const lockRow = lockResult.rows[0] as any
      let refTime = lockRow?.updated_at || null
      if (!refTime) {
        const latestMatch = await db.execute({
          sql: `SELECT MAX(created_at) as latest FROM matches_v2 WHERE week_key = ?`,
          args: [weekKey],
        })
        refTime = (latestMatch.rows[0] as any)?.latest || null
      }

      const eligibleResult = await db.execute({
        sql: `SELECT COUNT(*) as cnt FROM users WHERE (survey_completed = 1 OR survey_completed_v2 = 1) AND match_enabled = 1`,
        args: [],
      })
      const totalEligible = Number((eligibleResult.rows[0] as any)?.cnt || 0)

      autoTriggerInfo = {
        triggeredBy: null,
        triggeredAt: refTime,
        triggeredAtFormatted: formatBeijingTime(refTime),
        status: 'done',
        matchedPairs,
        totalEligible,
        unmatchedUsers: Math.max(0, totalEligible - (matchedPairs * 2)),
        inferred: true,
      }
    }

    const eligibleResult = await db.execute({
      sql: `SELECT COUNT(*) as cnt FROM users WHERE (survey_completed = 1 OR survey_completed_v2 = 1) AND match_enabled = 1`,
      args: [],
    })
    const totalEligible = Number((eligibleResult.rows[0] as any)?.cnt || 0)

    return NextResponse.json({
      matched: lockValue === 'done' || matchedPairs > 0,
      lockStatus: lockValue || null,
      weekKey,
      matchedPairs,
      totalEligible,
      unmatchedUsers: Math.max(0, totalEligible - (matchedPairs * 2)),
      autoTrigger: autoTriggerInfo,
    })
  } catch (error) {
    console.error('[admin/match-status-v2]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
