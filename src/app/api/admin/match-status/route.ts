// src/app/api/admin/match-status/route.ts
// 轻量接口：返回本周是否已执行过自动匹配
// 管理后台打开「执行匹配」tab 时调用，用于展示用户端自动触发的结果

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getCookieName, validateCsrfToken } from '@/lib/csrf'
import { getWeekKey, getPrevWeekKey } from '@/lib/week'


// 将数据库 UTC 时间字符串转为北京时间（UTC+8）格式化显示
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

export async function GET(req: NextRequest) {
  try {
    // 从 cookie 取 token（GET 请求无 body）—— 使用 NextRequest 标准 cookie API
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value || ''

    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded || !decoded.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    let weekKey = getWeekKey()
    let triggerKey = `auto_match_trigger_${weekKey}`

    // 查询本周 matches + matches_v2 表中的记录数 + settings 锁状态 + 自动触发记录
    const [matchesResult, matchesV2Result, lockResult, lockV2Result, triggerResult, triggerV2Result] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?`, args: [weekKey] }),
      db.execute({ sql: `SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?`, args: [weekKey] }),
      db.execute({ sql: `SELECT value FROM settings WHERE key = ?`, args: [`matching_lock_${weekKey}`] }),
      db.execute({ sql: `SELECT value FROM settings WHERE key = ?`, args: [`matching_lock_v2_${weekKey}`] }),
      db.execute({ sql: `SELECT value, updated_at FROM settings WHERE key = ?`, args: [triggerKey] }),
      db.execute({ sql: `SELECT value, updated_at FROM settings WHERE key = ?`, args: [`auto_match_trigger_v2_${weekKey}`] }),
    ])

    let matchedPairs = Number((matchesResult.rows[0] as any)?.cnt || 0) + Number((matchesV2Result.rows[0] as any)?.cnt || 0)
    let lockValue = (lockResult.rows[0] as any)?.value || (lockV2Result.rows[0] as any)?.value

    // 揭晓窗口内当前周无匹配时，回退查询上一周
    if (matchedPairs === 0 && !lockValue) {
      const prevWeekKey = getPrevWeekKey()
      const [prevMatchesResult, prevMatchesV2Result, prevLockResult, prevLockV2Result] = await Promise.all([
        db.execute({ sql: `SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?`, args: [prevWeekKey] }),
        db.execute({ sql: `SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?`, args: [prevWeekKey] }),
        db.execute({ sql: `SELECT value FROM settings WHERE key = ?`, args: [`matching_lock_${prevWeekKey}`] }),
        db.execute({ sql: `SELECT value FROM settings WHERE key = ?`, args: [`matching_lock_v2_${prevWeekKey}`] }),
      ])
      const prevCnt = Number((prevMatchesResult.rows[0] as any)?.cnt || 0) + Number((prevMatchesV2Result.rows[0] as any)?.cnt || 0)
      if (prevCnt > 0) {
        matchedPairs = prevCnt
        lockValue = (prevLockResult.rows[0] as any)?.value || (prevLockV2Result.rows[0] as any)?.value
        weekKey = prevWeekKey
        triggerKey = `auto_match_trigger_${prevWeekKey}`
      }
    }

    // 解析自动匹配触发信息（优先 V2 触发记录）
    let autoTriggerInfo: any = null
    const triggerRow = (triggerV2Result.rows[0] as any)?.value ? triggerV2Result.rows[0] : triggerResult.rows[0] as any
    // 检查现有记录是否为空数据（already_done 时写入的无效记录）
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
      } catch { /* ignore */ }
    } else if (lockValue === 'done' && matchedPairs > 0) {
      // 锁已完成且有匹配数据，但缺少触发记录（可能是功能上线前触发的匹配）
      // 从 matches 表 + 锁的时间 补算真实数据，让管理员看到有意义的信息
      const lockRow = lockResult.rows[0] as any
      // 补算数据时，优先使用锁的更新时间
      // 锁无时间时 fallback 到最新一条匹配记录时间（比最早更接近实际触发时间）
      let refTime = (lockRow?.updated_at) || null
      if (!refTime) {
        const latestMatch = await db.execute({
          sql: `SELECT MAX(created_at) as latest FROM matches WHERE week_key = ?`,
          args: [weekKey],
        })
        refTime = ((latestMatch.rows[0] as any)?.latest) || null
      }

      // 查所有参与匹配的候选人数（已完成问卷+开启匹配），而非仅已配对的人
      const eligibleResult = await db.execute({
        sql: `SELECT COUNT(*) as cnt FROM users WHERE (survey_completed = 1 OR survey_completed_v2 = 1) AND match_enabled = 1`,
        args: [],
      })
      const totalEligible = Number((eligibleResult.rows[0] as any)?.cnt || 0)

      autoTriggerInfo = {
        triggeredBy: null,  // 未知（功能上线前无记录）
        triggeredAt: refTime,
        triggeredAtFormatted: formatBeijingTime(refTime),
        status: 'done',
        matchedPairs,
        totalEligible,
        unmatchedUsers: Math.max(0, totalEligible - (matchedPairs * 2)),
        inferred: true,  // 标记为补算数据，前端可据此显示提示
      }
    }

    // 查询总参与人数（已完成问卷+开启匹配）
    const eligibleResult = await db.execute({
      sql: `SELECT COUNT(*) as cnt FROM users WHERE (survey_completed = 1 OR survey_completed_v2 = 1) AND match_enabled = 1`,
      args: [],
    })
    const totalEligible = Number((eligibleResult.rows[0] as any)?.cnt || 0)

    // 查询通知状态
    const notifyLockKey = `notify_lock_${weekKey}`
    const notifyLockResult = await db.execute({
      sql: "SELECT value, updated_at FROM settings WHERE key = ?",
      args: [notifyLockKey],
    })
    const notifyLockRow = notifyLockResult.rows[0] as any
    const notifySentResult = await db.execute({
      sql: "SELECT COUNT(*) as cnt FROM settings WHERE key LIKE ?",
      args: [`notify_sent_${weekKey}_%`],
    })
    const notifySentCount = Number((notifySentResult.rows[0] as any)?.cnt || 0)

    return NextResponse.json({
      matched: lockValue === 'done' || matchedPairs > 0,
      lockStatus: lockValue || null,
      weekKey,
      matchedPairs,
      totalEligible,
      unmatchedUsers: Math.max(0, totalEligible - (matchedPairs * 2)),
      autoTrigger: autoTriggerInfo,
      notifyLockStatus: notifyLockRow?.value || null,   // null / running / done
      notifySentCount,
    })
  } catch (error) {
    console.error('[admin/match-status]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '查询失败' }, { status: 500 })
  }
}
