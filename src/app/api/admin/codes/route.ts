import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe, generateInviteCode } from '@/lib/auth'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

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
      SELECT ic.id, ic.code, ic.current_uses, ic.max_uses, ic.created_at,
        u.nickname as created_by_name,
        u2.nickname as used_by_name
      FROM invite_codes ic
      JOIN users u ON ic.created_by = u.id
      LEFT JOIN users u2 ON ic.used_by = u2.id
      ORDER BY ic.created_at DESC
    `)

    return NextResponse.json({ codes: result.rows })
  } catch (error) {
    console.error('[admin/codes GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取邀请码失败' }, { status: 500 })
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

    // CSRF validation
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-codes')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json()
    // 严格类型校验：count 必须是正整数
    const rawCount = body.count
    let count = 5 // 默认值
    if (typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount >= 1) {
      count = Math.min(rawCount, 20) // 上限20，防滥用
    } else if (rawCount !== undefined && rawCount !== null) {
      return NextResponse.json({ error: 'count 必须是正整数（1-20）' }, { status: 400 })
    }

    // ── 批量生成邀请码（db.batch 一次提交）──
    const newCodes: string[] = []
    const insertStmts: Array<{ sql: string; args: any[] }> = []
    for (let i = 0; i < count; i++) {
      const code = generateInviteCode()
      newCodes.push(code)
      insertStmts.push({
        sql: 'INSERT INTO invite_codes (code, created_by) VALUES (?, ?)',
        args: [code, decoded.id],
      })
    }
    try { await db.batch(insertStmts) } catch (_) {
      // fallback to individual inserts
      for (const stmt of insertStmts) {
        try { await db.execute(stmt) } catch (__) { /* ignore */ }
      }
    }

    return NextResponse.json({ success: true, codes: newCodes })
  } catch (error) {
    console.error('[admin/codes POST]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '生成邀请码失败' }, { status: 500 })
  }
}
