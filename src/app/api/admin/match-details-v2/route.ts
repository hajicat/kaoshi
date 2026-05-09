import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getCookieName, getClientIp } from '@/lib/csrf'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getWeekKey } from '@/lib/week'
import { calcSafetyV2, calculateMatchV2, getMatchConfigV2, genderCompatibleV2, loadUserForV2Matching } from '@/lib/match-engine-v2'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-match-details-v2')
    if (!rateResult.allowed) return NextResponse.json({ error: '操作太频繁' }, { status: 429 })

    const url = new URL(req.url)
    const weekKey = url.searchParams.get('week') || getWeekKey()

    // 查询已匹配的配对
    const matchedResult = await db.execute({
      sql: `
        SELECT m.score, m.tier,
               u_a.nickname AS a_name, u_a.gender AS a_gender,
               u_b.nickname AS b_name, u_b.gender AS b_gender
        FROM matches_v2 m
        JOIN users u_a ON m.user_a = u_a.id
        JOIN users u_b ON m.user_b = u_b.id
        WHERE m.week_key = ?
        ORDER BY m.score DESC
      `,
      args: [weekKey],
    })

    const config = await getMatchConfigV2()

    const matchedDetails = (matchedResult.rows as any[]).map(r => {
      const score = Number(r.score)
      const tier = score >= config.strongThreshold ? 'strong'
        : score >= config.normalThreshold ? 'normal'
        : score >= config.backupThreshold ? 'backup'
        : 'none'
      return {
        userA: String(r.a_name || '未知'),
        userB: String(r.b_name || '未知'),
        score,
        tier,
      }
    })

    // 查询所有符合条件的用户
    const usersResult = await db.execute({
      sql: `SELECT u.id, u.nickname, u.gender, u.school, u.match_school_prefs,
                   u.safety_level as manual_safety_level,
                   u.survey_completed_v2
            FROM users u
            WHERE (u.survey_completed = 1 OR u.survey_completed_v2 = 1)
              AND u.match_enabled = 1
              AND (u.verification_status IS NULL OR u.verification_status = 'verified_student')`,
      args: [],
    })

    const allUserRows = usersResult.rows as any[]

    // 加载每个用户的 V2 数据
    const allUsers = []
    for (const row of allUserRows) {
      const user = await loadUserForV2Matching(db, Number(row.id))
      if (user) allUsers.push(user)
    }

    // 已匹配的用户 ID 集合
    const matchedIds = new Set<number>()
    const matchedInWeek = await db.execute({
      sql: `SELECT user_a, user_b FROM matches_v2 WHERE week_key = ?`,
      args: [weekKey],
    })
    for (const r of matchedInWeek.rows as any[]) {
      matchedIds.add(Number(r.user_a))
      matchedIds.add(Number(r.user_b))
    }

    const ALL_SCHOOL_NAMES = [
      '吉林大学', '东北师范大学', '吉林动画学院', '长春大学',
      '长春理工大学', '长春工业大学', '吉林建筑大学', '吉林农业大学',
      '长春中医药大学', '吉林工程技术师范学院', '长春师范大学',
      '吉林财经大学', '吉林体育学院', '吉林艺术学院', '吉林工商学院',
      '长春工程学院', '吉林警察学院', '长春汽车职业技术大学', '长春职业技术大学',
      '吉林外国语大学', '长春光华学院', '长春工业大学人文信息学院',
      '长春电子科技学院', '长春财经学院', '吉林建筑科技学院',
      '长春建筑学院', '长春科技学院', '长春大学旅游学院', '长春人文学院',
    ]

    const parsePrefs = (prefsRaw: string | null | undefined): Set<string> => {
      if (!prefsRaw || prefsRaw === 'all') return new Set(ALL_SCHOOL_NAMES)
      try { return new Set(JSON.parse(prefsRaw)) } catch { return new Set(ALL_SCHOOL_NAMES) }
    }

    const unmatchedDetails: Array<{ nickname: string; gender: string; reason: string }> = []

    for (const u of allUsers) {
      if (matchedIds.has(u.id)) continue

      const nickname = u.nickname || '未知'
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
      for (const other of allUsers) {
        if (other.id === u.id) continue
        if (!genderCompatibleV2(u, other)) continue
        hasGenderCompatible = true

        const prefsA = parsePrefs(u.match_school_prefs)
        const prefsB = parsePrefs(other.match_school_prefs)
        if (u.school && other.school) {
          if (!prefsA.has(other.school) || !prefsB.has(u.school)) continue
        }

        const result = calculateMatchV2(u, other, config)
        if (result.score > bestScore) bestScore = result.score
      }

      if (!hasGenderCompatible) {
        unmatchedDetails.push({ nickname, gender, reason: '无性别兼容的候选人' })
      } else if (bestScore < config.backupThreshold) {
        unmatchedDetails.push({ nickname, gender, reason: `最高匹配分${bestScore}分，低于最低阈值${config.backupThreshold}分` })
      } else {
        unmatchedDetails.push({ nickname, gender, reason: `最高匹配分${bestScore}分，但被更高分配对抢占` })
      }
    }

    return NextResponse.json({ weekKey, matchedDetails, unmatchedDetails })
  } catch (error) {
    console.error('[admin/match-details-v2]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取匹配详情失败' }, { status: 500 })
  }
}
