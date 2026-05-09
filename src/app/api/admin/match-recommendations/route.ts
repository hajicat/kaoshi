// src/app/api/admin/match-recommendations/route.ts
// 管理员推荐匹配：选择一个用户，列出最匹配的候选人（符合该用户的性别要求）
//
// POST { email, limit? } → { recommendations: [...] }
//
// 使用与自动匹配相同的算法，支持 V1/V2 双版本

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import {
  calculateMatch,
  calcSafety,
  type MatchResult,
} from '@/lib/match-engine'
import {
  loadUserForV2Matching,
  calcSafetyV2,
  calculateMatchV2,
  getMatchConfigV2,
  genderCompatibleV2,
} from '@/lib/match-engine-v2'

export const runtime = 'edge'

const DEFAULT_LIMIT = 50

/** 读取当前算法版本 */
async function getAlgorithmVersion(db: ReturnType<typeof getDb>): Promise<'v1' | 'v2'> {
  try {
    const res = await db.execute({ sql: `SELECT value FROM settings WHERE key = 'algorithm_version'`, args: [] })
    return (res.rows[0] as any)?.value === 'v2' ? 'v2' : 'v1'
  } catch { return 'v1' }
}

export async function POST(req: NextRequest) {
  function parsePrefs(raw: string | null): Set<string> {
    if (!raw || raw === 'all') return new Set(['__ALL__'])
    try { return new Set(JSON.parse(raw)) } catch { return new Set(['__ALL__']) }
  }

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

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const email = String(body.email || '').trim()
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), 50)

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: '请输入有效的注册邮箱' }, { status: 400 })
    }

    const version = await getAlgorithmVersion(db)

    // ── 根据邮箱查找用户 ──
    const userLookup = await db.execute({
      sql: `SELECT id FROM users WHERE email = ? LIMIT 1`,
      args: [email],
    })
    if (!userLookup.rows.length) {
      return NextResponse.json({ error: '未找到该邮箱对应的用户' }, { status: 404 })
    }
    const userId = Number(userLookup.rows[0].id)

    // ── 加载选中用户（支持 V1/V2）──
    if (version === 'v2') {
      const selectedUser = await loadUserForV2Matching(db, userId)
      if (!selectedUser) {
        return NextResponse.json({ error: '用户不存在或未完成问卷' }, { status: 404 })
      }

      // ── 批量查询候选人（避免逐个查询超时）──
      const v2Fields = `u.id, u.nickname, u.gender, u.preferred_gender, u.school, u.match_school_prefs,
        u.match_enabled, u.safety_level as manual_safety_level, u.last_active,
        s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
        s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
        s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
        s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37,
        s.q38,s.q39,s.q40,s.q41,s.q42,s.q43,s.q44,s.q45,s.q46,s.q47,
        s.q48,s.q49,s.q50,s.q51,s.q52,s.q53,s.q54,s.q55,s.q56,s.q57,s.q58`

      // 一次查所有 V2 问卷候选人
      const v2Candidates = await db.execute({
        sql: `SELECT ${v2Fields} FROM users u
              JOIN survey_responses_v2 s ON u.id = s.user_id
              WHERE u.survey_completed_v2 = 1 AND u.match_enabled = 1 AND u.id != ?`,
        args: [userId],
      })

      // 收集已有 V2 数据的用户 ID
      const v2Ids = new Set<number>()
      const candidates: any[] = []
      for (const row of v2Candidates.rows as any[]) {
        v2Ids.add(Number(row.id))
        candidates.push(row)
      }

      // 对只有 V1 数据的候选人做第二轮批量查询
      const v1Only = await db.execute({
        sql: `SELECT u.id FROM users u
              WHERE u.survey_completed = 1 AND (u.survey_completed_v2 = 0 OR u.survey_completed_v2 IS NULL)
                AND u.match_enabled = 1 AND u.id != ?`,
        args: [userId],
      })
      const v1Ids = (v1Only.rows as any[]).map(r => Number(r.id)).filter(id => !v2Ids.has(id))

      if (v1Ids.length > 0) {
        const ph = v1Ids.map(() => '?').join(',')
        const v1Data = await db.execute({
          sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender, u.school, u.match_school_prefs,
                  u.match_enabled, u.safety_level as manual_safety_level, u.last_active,
                  s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                  s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                  s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                  s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37
                FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id IN (${ph})`,
          args: v1Ids,
        })
        for (const row of v1Data.rows as any[]) {
          // V1→V2 转换：q38-q58 设为空字符串
          for (let i = 38; i <= 58; i++) row['q' + i] = ''
          candidates.push(row)
        }
      }

      const config = await getMatchConfigV2()

      const results: Array<{
        userId: number; nickname: string; gender: string; school: string
        score: number; dimScores: any[]; reasons: string[]
        safetyLevel: string; lastActive: string | null
      }> = []

      for (const cand of candidates) {
        if (!genderCompatibleV2(selectedUser, cand)) continue

        const selSchool = (selectedUser.school || '') as string
        const candSchool = (cand.school || '') as string
        if (selSchool && candSchool) {
          const prefsA = parsePrefs(selectedUser.match_school_prefs ?? null)
          const prefsB = parsePrefs(cand.match_school_prefs ?? null)
          if (!prefsA.has('__ALL__') && !prefsB.has('__ALL__')) {
            if (!prefsA.has(candSchool) || !prefsB.has(selSchool)) continue
          } else if (!prefsA.has('__ALL__')) {
            if (!prefsA.has(candSchool)) continue
          } else if (!prefsB.has('__ALL__')) {
            if (!prefsB.has(selSchool)) continue
          }
        }

        if (cand.manual_safety_level === 'blocked') continue
        const safety = calcSafetyV2(cand)
        if (safety.level === 'blocked') continue

        const result = calculateMatchV2(selectedUser, cand, config)
        results.push({
          userId: Number(cand.id),
          nickname: cand.nickname || '',
          gender: cand.gender || '',
          school: cand.school || '',
          score: result.score,
          dimScores: result.dimScores,
          reasons: result.reasons,
          safetyLevel: safety.level,
          lastActive: cand.last_active || null,
        })
      }

      results.sort((a, b) => b.score - a.score)
      const topResults = results.slice(0, limit)

      // ── 批量查询候选人历史匹配（两张表）──
      const matchHistoryMap = new Map<number, { total: number; lastWeek: string | null }>()
      if (topResults.length > 0) {
        const ids = topResults.map(r => r.userId)
        const ph = ids.map(() => '?').join(',')
        for (const table of ['matches', 'matches_v2']) {
          const historyResult = await db.execute({
            sql: `SELECT CASE WHEN m.user_a IN (${ph}) THEN m.user_a ELSE m.user_b END as uid, m.week_key
                  FROM ${table} m WHERE m.user_a IN (${ph}) OR m.user_b IN (${ph})`,
            args: [...ids, ...ids, ...ids],
          })
          for (const row of historyResult.rows as any[]) {
            const uid = Number(row.uid)
            const entry = matchHistoryMap.get(uid) || { total: 0, lastWeek: null }
            entry.total++
            if (!entry.lastWeek || String(row.week_key) > entry.lastWeek) {
              entry.lastWeek = String(row.week_key)
            }
            matchHistoryMap.set(uid, entry)
          }
        }
      }

      const recommendations = topResults.map(r => ({
        ...r,
        matchHistory: matchHistoryMap.get(r.userId) || { total: 0, lastWeek: null },
      }))

      return NextResponse.json({
        success: true,
        selectedUser: {
          id: Number(selectedUser.id),
          nickname: selectedUser.nickname || '',
          gender: selectedUser.gender || '',
          preferredGender: selectedUser.preferred_gender || '',
          school: selectedUser.school || '',
        },
        totalCandidates: candidates.length,
        compatibleCount: results.length,
        recommendations,
      })

    } else {
      // ── V1 模式（原逻辑）──
      const selectedRes = await db.execute({
        sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender, u.school, u.match_school_prefs,
                s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37
         FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id = ?`,
        args: [userId],
      })
      const selectedUser = selectedRes.rows[0] as any
      if (!selectedUser) {
        return NextResponse.json({ error: '用户不存在或未完成问卷' }, { status: 404 })
      }

      const candidatesResult = await db.execute({
        sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender, u.school, u.safety_level as manual_safety_level, u.match_school_prefs, u.last_active,
                s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37
         FROM users u
         JOIN survey_responses s ON u.id = s.user_id
         WHERE u.survey_completed = 1 AND u.match_enabled = 1 AND u.id != ?`,
        args: [userId],
      })

      const candidates = candidatesResult.rows as any[]
      const results: Array<{
        userId: number; nickname: string; gender: string; school: string
        score: number; dimScores: any[]; reasons: string[]
        safetyLevel: string; lastActive: string | null
      }> = []

      for (const cand of candidates) {
        const aWantsB = selectedUser.preferred_gender === 'all' || selectedUser.preferred_gender === cand.gender
        const bWantsA = cand.preferred_gender === 'all' || cand.preferred_gender === selectedUser.gender
        if (!aWantsB || !bWantsA) continue

        const selSchool = (selectedUser.school || '') as string
        const candSchool = (cand.school || '') as string
        if (selSchool && candSchool) {
          const prefsA = parsePrefs(selectedUser.match_school_prefs ?? null)
          const prefsB = parsePrefs(cand.match_school_prefs ?? null)
          if (!prefsA.has('__ALL__') && !prefsB.has('__ALL__')) {
            if (!prefsA.has(candSchool) || !prefsB.has(selSchool)) continue
          } else if (!prefsA.has('__ALL__')) {
            if (!prefsA.has(candSchool)) continue
          } else if (!prefsB.has('__ALL__')) {
            if (!prefsB.has(selSchool)) continue
          }
        }

        if (cand.manual_safety_level === 'blocked') continue
        const safety = calcSafety(cand)
        if (safety.level === 'blocked') continue

        const result: MatchResult = calculateMatch(selectedUser, cand)
        results.push({
          userId: Number(cand.id),
          nickname: cand.nickname,
          gender: cand.gender,
          school: cand.school || '',
          score: result.score,
          dimScores: result.dimScores,
          reasons: result.reasons,
          safetyLevel: result.safetyLevel,
          lastActive: cand.last_active || null,
        })
      }

      results.sort((a, b) => b.score - a.score)
      const topResults = results.slice(0, limit)

      const matchHistoryMap = new Map<number, { total: number; lastWeek: string | null }>()
      if (topResults.length > 0) {
        const candidateIds = topResults.map(r => r.userId)
        const placeholders = candidateIds.map(() => '?').join(',')
        const historyResult = await db.execute({
          sql: `SELECT
                  CASE WHEN m.user_a IN (${placeholders}) THEN m.user_a ELSE m.user_b END as uid,
                  m.week_key
                FROM matches m
                WHERE m.user_a IN (${placeholders}) OR m.user_b IN (${placeholders})`,
          args: [...candidateIds, ...candidateIds, ...candidateIds],
        })
        for (const row of historyResult.rows as any[]) {
          const uid = Number(row.uid)
          const entry = matchHistoryMap.get(uid) || { total: 0, lastWeek: null }
          entry.total++
          if (!entry.lastWeek || String(row.week_key) > entry.lastWeek) {
            entry.lastWeek = String(row.week_key)
          }
          matchHistoryMap.set(uid, entry)
        }
      }

      const recommendations = topResults.map(r => ({
        ...r,
        matchHistory: matchHistoryMap.get(r.userId) || { total: 0, lastWeek: null },
      }))

      return NextResponse.json({
        success: true,
        selectedUser: {
          id: Number(selectedUser.id),
          nickname: selectedUser.nickname,
          gender: selectedUser.gender,
          preferredGender: selectedUser.preferred_gender,
          school: selectedUser.school || '',
        },
        totalCandidates: candidates.length,
        compatibleCount: results.length,
        recommendations,
      })
    }
  } catch (error) {
    console.error('[admin/match-recommendations]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取推荐列表失败' }, { status: 500 })
  }
}
