import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenSafe } from '@/lib/auth'
import { getDb, initDb } from '@/lib/db'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { sanitizeForStorage } from '@/lib/validation'



const VALID_AUDIENCE = ['all', 'registered', 'new'] as const
const VALID_DISMISS = ['once', 'confirm', 'always'] as const


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const result = await db.execute(`
      SELECT a.*,
        (SELECT COUNT(*) FROM announcement_dismissals d WHERE d.announcement_id = a.id) as dismiss_count
      FROM announcements a
      ORDER BY a.created_at DESC
    `)

    return NextResponse.json({ announcements: result.rows })
  } catch (error) {
    console.error('[admin/announcements GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取公告失败' }, { status: 500 })
  }
}


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

    const body = await req.json()
    const title = typeof body.title === 'string' ? sanitizeForStorage(body.title, 100) : ''
    const content = typeof body.content === 'string' ? sanitizeForStorage(body.content, 2000) : ''
    const audience = VALID_AUDIENCE.includes(body.audience) ? body.audience : 'all'
    const dismissMode = VALID_DISMISS.includes(body.dismiss_mode) ? body.dismiss_mode : 'once'
    const isActive = body.is_active === false ? 0 : 1

    if (!title) return NextResponse.json({ error: '标题不能为空' }, { status: 400 })
    if (!content) return NextResponse.json({ error: '内容不能为空' }, { status: 400 })

    await db.execute({
      sql: `INSERT INTO announcements (title, content, audience, dismiss_mode, is_active)
            VALUES (?, ?, ?, ?, ?)`,
      args: [title, content, audience, dismissMode, isActive],
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/announcements POST]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '创建公告失败' }, { status: 500 })
  }
}


export async function PUT(req: NextRequest) {
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

    const body = await req.json()
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: '无效的公告ID' }, { status: 400 })

    const fields: string[] = []
    const args: any[] = []

    if (typeof body.title === 'string') {
      const v = sanitizeForStorage(body.title, 100)
      if (!v) return NextResponse.json({ error: '标题不能为空' }, { status: 400 })
      fields.push('title = ?')
      args.push(v)
    }
    if (typeof body.content === 'string') {
      const v = sanitizeForStorage(body.content, 2000)
      if (!v) return NextResponse.json({ error: '内容不能为空' }, { status: 400 })
      fields.push('content = ?')
      args.push(v)
    }
    if (typeof body.audience === 'string') {
      if (!VALID_AUDIENCE.includes(body.audience)) return NextResponse.json({ error: '无效的展示对象' }, { status: 400 })
      fields.push('audience = ?')
      args.push(body.audience)
    }
    if (typeof body.dismiss_mode === 'string') {
      if (!VALID_DISMISS.includes(body.dismiss_mode)) return NextResponse.json({ error: '无效的关闭方式' }, { status: 400 })
      fields.push('dismiss_mode = ?')
      args.push(body.dismiss_mode)
    }
    if (typeof body.is_active === 'boolean') {
      fields.push('is_active = ?')
      args.push(body.is_active ? 1 : 0)
    }

    if (fields.length === 0) return NextResponse.json({ error: '没有要更新的字段' }, { status: 400 })

    fields.push("updated_at = datetime('now')")
    args.push(id)

    await db.execute({
      sql: `UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`,
      args,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/announcements PUT]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '更新公告失败' }, { status: 500 })
  }
}


export async function DELETE(req: NextRequest) {
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

    const body = await req.json()
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: '无效的公告ID' }, { status: 400 })

    await db.execute({ sql: 'DELETE FROM announcement_dismissals WHERE announcement_id = ?', args: [id] })
    await db.execute({ sql: 'DELETE FROM announcements WHERE id = ?', args: [id] })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/announcements DELETE]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '删除公告失败' }, { status: 500 })
  }
}
