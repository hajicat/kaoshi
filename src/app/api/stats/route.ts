import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getCookieName } from '@/lib/csrf'


export async function GET(req: NextRequest) {
  try {
    // Auth check - only admins can view stats
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value

    if (!token) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const db = getDb()
    await initDb()

    const decoded = await verifyTokenSafe(token, db)
    if (!decoded || !decoded.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    // ── 合并统计查询（3 次 DB 往返 → 1 次）──
    const result = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_admin = 0) as totalUsers,
        (SELECT COUNT(*) FROM users WHERE (survey_completed = 1 OR survey_completed_v2 = 1) AND is_admin = 0) as completedSurvey,
        (SELECT COUNT(*) FROM matches) + (SELECT COUNT(*) FROM matches_v2) as totalMatches
    `)
    const row = result.rows[0] as any

    return NextResponse.json({
      totalUsers: Number(row.totalUsers),
      completedSurvey: Number(row.completedSurvey),
      totalMatches: Number(row.totalMatches),
    })
  } catch (error) {
    console.error('[stats]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ totalUsers: 0, completedSurvey: 0, totalMatches: 0 })
  }
}
