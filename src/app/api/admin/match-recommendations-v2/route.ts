import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { calculateMatchV2, calcSafetyV2, loadUserForV2Matching, type V2MatchResult } from '@/lib/match-engine-v2'


const DEFAULT_LIMIT = 20

export async function POST(req: NextRequest) {
  const parsePrefs = (raw: string | null | undefined): Set<string> => {
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
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const email = String(body.email || '').trim()
    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), 50)

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: '请输入有效的注册邮箱' }, { status: 400 })
    }

    const userLookup = await db.execute({
      sql: `SELECT id FROM users WHERE email = ? LIMIT 1`,
      args: [email],
    })
    if (!userLookup.rows.length) {
      return NextResponse.json({ error: '未找到该邮箱对应的用户' }, { status: 404 })
    }
    const userId = Number(userLookup.rows[0].id)

    const selectedUser = await loadUserForV2Matching(db, userId)
    if (!selectedUser) {
      return NextResponse.json({ error: '用户不存在或未完成问卷' }, { status: 404 })
    }

    // 查询所有候选用户
    const candidatesResult = await db.execute({
      sql: `SELECT u.id FROM users u
            WHERE (u.survey_completed = 1 OR u.survey_completed_v2 = 1)
              AND u.match_enabled = 1 AND u.id != ?`,
      args: [userId],
    })

    const results: Array<{
      userId: number; nickname: string; gender: string; school: string
      score: number; tier: string; dimScores: any[]; reasons: string[]
      safetyLevel: string; lastActive: string | null
    }> = []

    for (const row of candidatesResult.rows as any[]) {
      const cand = await loadUserForV2Matching(db, Number(row.id))
      if (!cand) continue

      const aWantsB = selectedUser.preferred_gender === 'all' || selectedUser.preferred_gender === cand.gender
      const bWantsA = cand.preferred_gender === 'all' || cand.preferred_gender === selectedUser.gender
      if (!aWantsB || !bWantsA) continue

      if (selectedUser.school && cand.school) {
        const prefsA = parsePrefs(selectedUser.match_school_prefs)
        const prefsB = parsePrefs(cand.match_school_prefs)
        if (!prefsA.has('__ALL__') && !prefsB.has('__ALL__')) {
          if (!prefsA.has(cand.school) || !prefsB.has(selectedUser.school)) continue
        } else if (!prefsA.has('__ALL__')) {
          if (!prefsA.has(cand.school)) continue
        } else if (!prefsB.has('__ALL__')) {
          if (!prefsB.has(selectedUser.school)) continue
        }
      }

      if (cand.manual_safety_level === 'blocked') continue
      const candSafety = calcSafetyV2(cand)
      if (candSafety.level === 'blocked') continue

      const result: V2MatchResult = calculateMatchV2(selectedUser, cand)
      results.push({
        userId: cand.id,
        nickname: cand.nickname || '未知',
        gender: cand.gender,
        school: cand.school || '',
        score: result.score,
        tier: result.tier,
        dimScores: result.dimScores,
        reasons: result.reasons,
        safetyLevel: result.safetyLevel,
        lastActive: null,
      })
    }

    results.sort((a, b) => b.score - a.score)
    const topResults = results.slice(0, limit)

    // 批量查询候选人历史匹配记录
    const matchHistoryMap = new Map<number, { total: number; lastWeek: string | null }>()
    if (topResults.length > 0) {
      const candidateIds = topResults.map(r => r.userId)
      const placeholders = candidateIds.map(() => '?').join(',')
      const historyResult = await db.execute({
        sql: `SELECT
                CASE WHEN m.user_a IN (${placeholders}) THEN m.user_a ELSE m.user_b END as uid,
                m.week_key
              FROM matches_v2 m
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
        id: selectedUser.id,
        nickname: selectedUser.nickname,
        gender: selectedUser.gender,
        preferredGender: selectedUser.preferred_gender,
        school: selectedUser.school || '',
      },
      totalCandidates: candidatesResult.rows.length,
      compatibleCount: results.length,
      recommendations,
    })
  } catch (error) {
    console.error('[admin/match-recommendations-v2]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取推荐列表失败' }, { status: 500 })
  }
}
