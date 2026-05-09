// src/app/api/admin/match-details/route.ts
// 管理员查看某周匹配详情（成功配对 + 未匹配原因）
//
// GET 参数：
//   ?week=2026-W15   指定周（默认当前周）
//
// 返回：
//   matchedDetails: 成功配对列表
//   unmatchedDetails: 未匹配用户列表（含原因）

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName, getClientIp } from '@/lib/csrf'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getWeekKey } from '@/lib/week'
import { calcSafety, calculateMatch, getMatchConfig, clearMatchConfigCache, genderCompatible } from '@/lib/match-engine'
import { calcSafetyV2, calculateMatchV2, loadUserForV2Matching, getMatchConfigV2, clearMatchConfigV2Cache, genderCompatibleV2 } from '@/lib/match-engine-v2'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-match-details')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const url = new URL(req.url)
    const weekKey = url.searchParams.get('week') || getWeekKey()

    // ── 1. 查询已匹配的配对（V1 + V2 合并去重）──
    const matchQuery = `SELECT m.user_a AS a_id, m.user_b AS b_id, m.score,
             u_a.nickname AS a_name, u_a.gender AS a_gender,
             u_b.nickname AS b_name, u_b.gender AS b_gender
      FROM %TABLE% m
      JOIN users u_a ON m.user_a = u_a.id
      JOIN users u_b ON m.user_b = u_b.id
      WHERE m.week_key = ?
      ORDER BY m.score DESC`
    const [v1Matched, v2Matched] = await Promise.all([
      db.execute({ sql: matchQuery.replace('%TABLE%', 'matches'), args: [weekKey] }),
      db.execute({ sql: matchQuery.replace('%TABLE%', 'matches_v2'), args: [weekKey] }),
    ])

    const pairMap = new Map<string, { userA: string; userB: string; score: number }>()
    for (const r of [...v1Matched.rows, ...v2Matched.rows] as any[]) {
      const aId = Number(r.a_id)
      const bId = Number(r.b_id)
      const key = aId < bId ? `${aId}_${bId}` : `${bId}_${aId}`
      const score = Number(r.score)
      const existing = pairMap.get(key)
      if (!existing || score > existing.score) {
        pairMap.set(key, { userA: String(r.a_name || '未知'), userB: String(r.b_name || '未知'), score })
      }
    }
    const matchedDetails = Array.from(pairMap.values()).sort((a, b) => b.score - a.score)

    // ── 2. 查询所有符合条件的用户（V2 引擎，支持 V1+V2 用户）──
    const usersResult = await db.execute({
      sql: `SELECT u.id FROM users u
            WHERE (u.survey_completed = 1 OR u.survey_completed_v2 = 1) AND u.match_enabled = 1`,
      args: [],
    })

    // 加载完整用户数据
    const allV2Users: any[] = []
    for (const row of usersResult.rows as any[]) {
      const u = await loadUserForV2Matching(db, Number(row.id))
      if (u) allV2Users.push(u)
    }

    // 已匹配的用户 ID 集合（V1 + V2）
    const matchedIds = new Set<number>()
    const [matchedInWeek, matchedInWeekV2] = await Promise.all([
      db.execute({ sql: `SELECT user_a, user_b FROM matches WHERE week_key = ?`, args: [weekKey] }),
      db.execute({ sql: `SELECT user_a, user_b FROM matches_v2 WHERE week_key = ?`, args: [weekKey] }),
    ])
    for (const r of [...matchedInWeek.rows, ...matchedInWeekV2.rows] as any[]) {
      matchedIds.add(Number(r.user_a))
      matchedIds.add(Number(r.user_b))
    }

    // ── 3. 计算未匹配原因（用 V2 引擎）──
    const matchConfig = await getMatchConfigV2()
    clearMatchConfigV2Cache()

    const unmatchedDetails: Array<{ nickname: string; gender: string; reason: string }> = []

    for (const u of allV2Users) {
      if (matchedIds.has(Number(u.id))) continue

      const nickname = String(u.nickname || '未知')
      const gender = u.gender || ''

      if (u.manual_safety_level === 'blocked') {
        unmatchedDetails.push({ nickname, gender, reason: '管理员手动封禁' })
        continue
      }

      const safety = calcSafetyV2(u)
      if (safety.level === 'blocked') {
        unmatchedDetails.push({ nickname, gender, reason: `安全筛查未通过（风险分${safety.riskScore}）` })
        continue
      }

      let bestScore = 0
      let hasGenderCompatible = false
      for (const other of allV2Users) {
        if (Number(other.id) === Number(u.id)) continue
        if (!genderCompatibleV2(u, other)) continue
        hasGenderCompatible = true
        const result = calculateMatchV2(u, other, matchConfig)
        if (result.score > bestScore) bestScore = result.score
      }

      if (!hasGenderCompatible) {
        unmatchedDetails.push({ nickname, gender, reason: '无性别兼容的候选人' })
      } else if (bestScore < matchConfig.backupThreshold) {
        unmatchedDetails.push({ nickname, gender, reason: `最高匹配分${bestScore}分，低于最低阈值${matchConfig.backupThreshold}分` })
      } else {
        unmatchedDetails.push({ nickname, gender, reason: `最高匹配分${bestScore}分，未满足匹配条件` })
      }
    }

    return NextResponse.json({ weekKey, matchedDetails, unmatchedDetails })
  } catch (error) {
    console.error('[admin/match-details]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取匹配详情失败' }, { status: 500 })
  }
}
