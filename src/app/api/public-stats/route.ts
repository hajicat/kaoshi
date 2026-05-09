import { NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'



/**
 * Public stats endpoint - no auth required.
 * Used by the homepage to display "X 位吉动人完成测试"
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb()
    await initDb()

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
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    })
  } catch (error) {
    console.error('[public-stats]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ totalUsers: 0, completedSurvey: 0, totalMatches: 0 })
  }
}
