// src/app/api/admin/matches/route.ts
// 管理员查看本周所有匹配配对（V1 + V2 合并）

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { getWeekKey } from '@/lib/week'




export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const url = new URL(req.url)
    const weekKey = url.searchParams.get('week') || getWeekKey()
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10) || 10))
    const offset = (page - 1) * limit

    // 同时查 V1 + V2 匹配记录
    const matchQuery = `SELECT m.id, m.score, m.dim_scores, m.reasons, m.week_key,
            m.a_revealed, m.b_revealed, m.created_at, m.source,
            u1.id AS user_a_id, u1.nickname AS user_a_name, u1.gender AS user_a_gender,
            u2.id AS user_b_id, u2.nickname AS user_b_name, u2.gender AS user_b_gender
          FROM %TABLE% m
          JOIN users u1 ON m.user_a = u1.id
          JOIN users u2 ON m.user_b = u2.id
          WHERE m.week_key = ?`

    const [v1Result, v2Result, v1Count, v2Count] = await Promise.all([
      db.execute({ sql: matchQuery.replace('%TABLE%', 'matches'), args: [weekKey] }),
      db.execute({ sql: matchQuery.replace('%TABLE%', 'matches_v2'), args: [weekKey] }),
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?', args: [weekKey] }),
      db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches_v2 WHERE week_key = ?', args: [weekKey] }),
    ])

    // 合并、去重（同一对可能在两张表都有）
    const pairMap = new Map<string, any>()
    for (const r of [...v1Result.rows, ...v2Result.rows] as any[]) {
      const aId = Number(r.user_a_id)
      const bId = Number(r.user_b_id)
      const key = aId < bId ? `${aId}_${bId}` : `${bId}_${aId}`
      const existing = pairMap.get(key)
      if (!existing || Number(r.score) > Number(existing.score)) {
        pairMap.set(key, r)
      }
    }

    const allPairs = Array.from(pairMap.values())
      .sort((a: any, b: any) => Number(b.score) - Number(a.score))

    const totalPairs = allPairs.length
    const pagePairs = allPairs.slice(offset, offset + limit)

    // 可选周列表（合并两张表）
    const [v1Weeks, v2Weeks] = await Promise.all([
      db.execute({ sql: 'SELECT DISTINCT week_key FROM matches ORDER BY week_key DESC', args: [] }),
      db.execute({ sql: 'SELECT DISTINCT week_key FROM matches_v2 ORDER BY week_key DESC', args: [] }),
    ])
    const weekSet = new Set<string>()
    for (const r of [...v1Weeks.rows, ...v2Weeks.rows] as any[]) weekSet.add(String(r.week_key))
    const availableWeeks = Array.from(weekSet).sort().reverse()

    // 匹配状态（检查两个锁）
    const [lockV1, lockV2] = await Promise.all([
      db.execute({ sql: "SELECT value, updated_at FROM settings WHERE key = ?", args: [`matching_lock_${weekKey}`] }),
      db.execute({ sql: "SELECT value, updated_at FROM settings WHERE key = ?", args: [`matching_lock_v2_${weekKey}`] }),
    ])
    const lockV1Val = (lockV1.rows[0] as any)?.value
    const lockV2Val = (lockV2.rows[0] as any)?.value
    const matchStatus = (lockV1Val === 'done' || lockV2Val === 'done') ? 'done'
      : (lockV1Val === 'running' || lockV2Val === 'running') ? 'running'
      : 'not_started'

    // 未匹配用户（第一页）
    let unmatchedRows: any[] = []
    let unmatchedCount = 0
    if (page === 1) {
      const unmatchedResult = await db.execute({
        sql: `SELECT u.id, u.nickname, u.gender
              FROM users u
              WHERE (u.survey_completed = 1 OR u.survey_completed_v2 = 1) AND u.match_enabled = 1 AND u.is_admin = 0
                AND u.id NOT IN (
                  SELECT user_a FROM matches WHERE week_key = ?
                  UNION SELECT user_b FROM matches WHERE week_key = ?
                  UNION SELECT user_a FROM matches_v2 WHERE week_key = ?
                  UNION SELECT user_b FROM matches_v2 WHERE week_key = ?
                )`,
        args: [weekKey, weekKey, weekKey, weekKey],
      })
      unmatchedRows = unmatchedResult.rows
      unmatchedCount = unmatchedRows.length
    }

    const pairs = pagePairs.map((r: any) => {
      let dimScores = null
      try { dimScores = JSON.parse(String(r.dim_scores || 'null')) } catch {}
      let reasons: string[] = []
      try { reasons = JSON.parse(String(r.reasons || '[]')) } catch {}
      return {
        id: Number(r.id),
        userA: { id: Number(r.user_a_id), name: r.user_a_name, gender: r.user_a_gender },
        userB: { id: Number(r.user_b_id), name: r.user_b_name, gender: r.user_b_gender },
        score: Number(r.score),
        dimScores,
        reasons,
        aRevealed: !!r.a_revealed,
        bRevealed: !!r.b_revealed,
        createdAt: r.created_at,
        source: r.source || 'auto',
      }
    })

    return NextResponse.json({
      weekKey,
      status: matchStatus,
      pairs,
      page,
      limit,
      totalPairs,
      totalPages: Math.ceil(totalPairs / limit),
      unmatched: unmatchedRows.map((r: any) => ({ id: Number(r.id), name: r.nickname, gender: r.gender })),
      unmatchedCount,
      availableWeeks,
    })
  } catch (error) {
    console.error('[admin/matches GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取匹配列表失败' }, { status: 500 })
  }
}
