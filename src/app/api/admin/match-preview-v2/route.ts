import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { calculateMatchV2, loadUserForV2Matching } from '@/lib/match-engine-v2'

export const runtime = 'edge'

export async function POST(req: NextRequest) {
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
    const userAId = Number(body.userA)
    const userBId = Number(body.userB)

    if (!Number.isInteger(userAId) || !Number.isInteger(userBId) || userAId <= 0 || userBId <= 0) {
      return NextResponse.json({ error: '无效的用户ID' }, { status: 400 })
    }
    if (userAId === userBId) {
      return NextResponse.json({ error: '不能选择同一个用户' }, { status: 400 })
    }

    const [userA, userB] = await Promise.all([
      loadUserForV2Matching(db, userAId),
      loadUserForV2Matching(db, userBId),
    ])

    if (!userA || !userB) {
      return NextResponse.json(
        { error: `用户不存在或未完成问卷 — A: ${!!userA}, B: ${!!userB}` },
        { status: 404 },
      )
    }

    const result = calculateMatchV2(userA, userB)

    return NextResponse.json({
      success: true,
      preview: {
        userA: { id: userAId, nickname: userA.nickname },
        userB: { id: userBId, nickname: userB.nickname },
        score: result.score,
        tier: result.tier,
        dimScores: result.dimScores,
        reasons: result.reasons,
        safetyLevel: result.safetyLevel,
      },
    })
  } catch (error) {
    console.error('[admin/match-preview-v2]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '预览匹配度失败' }, { status: 500 })
  }
}
