// src/app/api/admin/match-preview/route.ts
// 管理员预览两个用户的匹配度（只算分，不写库）
//
// POST { userA, userB } → { score, dimScores, reasons, safetyLevel }
//
// 与 handleManualMatch 的区别：不检查已有匹配、不写入 matches 表

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { calculateMatch } from '@/lib/match-engine'
import { calculateMatchV2, loadUserForV2Matching } from '@/lib/match-engine-v2'




export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // ── 身份验证 ──
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // ── CSRF 校验 ──
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const userAId = Number(body.userA)
    const userBId = Number(body.userB)

    if (!Number.isInteger(userAId) || !Number.isInteger(userBId) || userAId <= 0 || userBId <= 0) {
      return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
    }
    if (userAId === userBId) {
      return NextResponse.json({ error: '不能选择同一个用户' }, { status: 400 })
    }

    // ── 优先用 V1 引擎，任一方无 V1 数据时自动回退 V2 ──
    const [userARes, userBRes] = await Promise.all([
      db.execute({
        sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender,
                s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37
         FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id = ?`,
        args: [userAId],
      }),
      db.execute({
        sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender,
                s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37
         FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id = ?`,
        args: [userBId],
      }),
    ])

    const v1A = userARes.rows[0] as any
    const v1B = userBRes.rows[0] as any

    if (v1A && v1B) {
      // 双方都有 V1 数据，用 V1 引擎
      const result = calculateMatch(v1A, v1B)
      return NextResponse.json({
        success: true,
        preview: {
          userA: { id: userAId, name: v1A.nickname },
          userB: { id: userBId, name: v1B.nickname },
          score: result.score,
          dimScores: result.dimScores,
          reasons: result.reasons,
          safetyLevel: result.safetyLevel,
        },
      })
    }

    // 任一方缺少 V1 数据，回退到 V2 引擎
    const [v2UserA, v2UserB] = await Promise.all([
      loadUserForV2Matching(db, userAId),
      loadUserForV2Matching(db, userBId),
    ])

    if (!v2UserA || !v2UserB) {
      return NextResponse.json(
        { error: `用户不存在或未完成问卷 — A: ${!!v2UserA}, B: ${!!v2UserB}` },
        { status: 404 },
      )
    }

    const result = calculateMatchV2(v2UserA, v2UserB)

    return NextResponse.json({
      success: true,
      preview: {
        userA: { id: userAId, name: v2UserA.nickname },
        userB: { id: userBId, name: v2UserB.nickname },
        score: result.score,
        dimScores: result.dimScores.map(d => ({
          name: d.name, score: d.score, weight: d.weight, compatible: d.compatible,
        })),
        reasons: result.reasons,
        safetyLevel: result.safetyLevel,
      },
    })
  } catch (error) {
    console.error('[admin/match-preview]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '预览匹配度失败' }, { status: 500 })
  }
}
