import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'


export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    await initDb()

    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    let userId: number | null = null
    let surveyCompleted = false

    if (token) {
      try {
        const decoded = await verifyTokenSafe(token, db)
        if (decoded) {
          userId = decoded.id
          const userRes = await db.execute({
            sql: 'SELECT survey_completed, survey_completed_v2 FROM users WHERE id = ?',
            args: [userId],
          })
          const u = userRes.rows[0] as any
          if (u) surveyCompleted = !!u.survey_completed || !!u.survey_completed_v2
        }
      } catch { /* 未登录 */ }
    }

    // 查询所有活跃公告
    const allAnnouncements = await db.execute({
      sql: `SELECT id, title, content, audience, dismiss_mode FROM announcements WHERE is_active = 1`,
      args: [],
    })

    const announcements: any[] = []

    for (const row of allAnnouncements.rows as any[]) {
      const audience = row.audience
      const dismissMode = row.dismiss_mode

      // 按 audience 过滤
      if (audience === 'registered' && !userId) continue
      if (audience === 'new' && (!userId || !surveyCompleted)) continue

      // 按 dismiss_mode 过滤已读
      if (dismissMode !== 'always' && userId) {
        const dismissed = await db.execute({
          sql: 'SELECT id FROM announcement_dismissals WHERE announcement_id = ? AND user_id = ?',
          args: [row.id, userId],
        })
        if (dismissed.rows.length > 0) continue
      }

      announcements.push({
        id: Number(row.id),
        title: row.title,
        content: row.content,
        dismissMode: dismissMode,
      })
    }

    return NextResponse.json({ announcements })
  } catch (error) {
    console.error('[announcements GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ announcements: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb()
    await initDb()

    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json()
    const announcementId = Number(body.announcementId)
    if (!Number.isInteger(announcementId) || announcementId <= 0) {
      return NextResponse.json({ error: '无效的公告ID' }, { status: 400 })
    }

    await db.execute({
      sql: `INSERT OR IGNORE INTO announcement_dismissals (announcement_id, user_id) VALUES (?, ?)`,
      args: [announcementId, decoded.id],
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[announcements POST]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
