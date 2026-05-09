import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()

    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const availResult = await db.execute({
      sql: 'SELECT code, current_uses, max_uses FROM invite_codes WHERE created_by = ? AND current_uses < max_uses',
      args: [decoded.id],
    })

    const usedResult = await db.execute({
      sql: 'SELECT code, current_uses, max_uses FROM invite_codes WHERE created_by = ? AND current_uses >= max_uses',
      args: [decoded.id],
    })

    return NextResponse.json({
      available: availResult.rows,
      used: usedResult.rows,
    })
  } catch (error) {
    console.error('[invite GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取邀请码失败' }, { status: 500 })
  }
}
