import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { setCsrfCookie, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

/**
 * Combined home data endpoint - single API call for homepage.
 * Returns: public stats + user info (if authenticated)
 * This replaces calling /api/public-stats + /api/auth/me separately,
 * cutting cold-start latency in half.
 */
export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    await initDb()

    // ── 读取算法版本 ──
    let algorithmVersion = 'v1'
    try {
      const verRes = await db.execute({ sql: `SELECT value FROM settings WHERE key = 'algorithm_version'`, args: [] })
      if ((verRes.rows[0] as any)?.value === 'v2') algorithmVersion = 'v2'
    } catch { /* 默认 v1 */ }

    // ── 合并统计查询（3 次 DB 往返 → 1 次）──
    const statsResult = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_admin = 0) as totalUsers,
        (SELECT COUNT(*) FROM users WHERE (survey_completed = 1 OR survey_completed_v2 = 1) AND is_admin = 0) as completedSurvey,
        (SELECT COUNT(*) FROM matches) + (SELECT COUNT(*) FROM matches_v2) as totalMatches
    `)

    const statsRow = statsResult.rows[0] as any
    const publicStats = {
      totalUsers: Number(statsRow.totalUsers),
      completedSurvey: Number(statsRow.completedSurvey),
      totalMatches: Number(statsRow.totalMatches),
    }

    // Check if user is authenticated
    let user = null
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value || null

    if (token) {
      try {
        const decoded = await verifyTokenSafe(token, db)
        if (decoded) {
          // Only fetch essential fields, no invite codes (keep it light)
          const userResult = await db.execute({
            sql: `SELECT id, nickname, email, is_admin, survey_completed, survey_completed_v2
                   FROM users WHERE id = ?`,
            args: [decoded.id],
          })
          const u = userResult.rows[0] as any
          if (u) {
            user = {
              id: Number(u.id),
              nickname: u.nickname,
              isAdmin: !!u.is_admin,
              surveyCompleted: !!u.survey_completed || !!u.survey_completed_v2,
            }
          }
        }
      } catch {
        // Invalid token — treat as not logged in
      }
    }

    const response = NextResponse.json({
      ...publicStats,
      user,
      algorithmVersion,
    }, {
      headers: {
        // 统一用 no-store，避免 CDN 缓存导致用户数据泄露
        'Cache-Control': 'no-store',
        'Vary': 'Cookie',
      },
    })

    // 确保首次访问者也有 CSRF token（否则注册/登录 POST 会 403）
    setCsrfCookie(response)

    // 刷新非 httpOnly 状态 cookie（前端同步读取用）
    if (user) {
      response.cookies.set('logged_in', 'true', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 })
      response.cookies.set('survey_status', user.surveyCompleted ? 'done' : 'pending', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 })
    } else {
      // token 无效时清除状态 cookie
      response.cookies.set('logged_in', '', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
      response.cookies.set('survey_status', '', { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
    }

    return response
  } catch (error) {
    console.error('[home-data]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({
      totalUsers: 0,
      completedSurvey: 0,
      totalMatches: 0,
      user: null,
    }, {
      headers: {
        // 错误响应不缓存，避免认证错误等用户状态信息被 CDN 缓存并跨用户共享
        'Cache-Control': 'no-store',
      },
    })
  }
}
