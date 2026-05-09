// src/app/api/admin/delete-match/route.ts
// 管理员删除单条匹配记录（用于清理测试数据/误操作）

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName, getClientIp } from '@/lib/csrf'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'

export const runtime = 'edge'

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'admin-delete-match')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json().catch(() => ({}))
    const matchId = Number(body.matchId)
    if (!Number.isInteger(matchId) || matchId <= 0) {
      return NextResponse.json({ error: '无效的匹配ID' }, { status: 400 })
    }

    // 查询要删除的记录信息（用于日志和确认）— 先查主版本表，再查备用表
    const versionRes = await db.execute({ sql: `SELECT value FROM settings WHERE key = 'algorithm_version'`, args: [] })
    const version = (versionRes.rows[0] as any)?.value === 'v2' ? 'v2' : 'v1'
    const primaryTable = version === 'v2' ? 'matches_v2' : 'matches'
    const altTable = version === 'v2' ? 'matches' : 'matches_v2'

    const findRes = await db.execute({
      sql: `SELECT m.id, m.user_a, m.user_b, m.week_key,
                    u1.nickname as name_a, u2.nickname as name_b
             FROM ${primaryTable} m
             JOIN users u1 ON m.user_a = u1.id
             JOIN users u2 ON m.user_b = u2.id
             WHERE m.id = ?`,
      args: [matchId],
    })
    let target = findRes.rows[0] as any
    let deleteTable = primaryTable

    if (!target) {
      const altRes = await db.execute({
        sql: `SELECT m.id, m.user_a, m.user_b, m.week_key,
                      u1.nickname as name_a, u2.nickname as name_b
               FROM ${altTable} m
               JOIN users u1 ON m.user_a = u1.id
               JOIN users u2 ON m.user_b = u2.id
               WHERE m.id = ?`,
        args: [matchId],
      })
      target = altRes.rows[0] as any
      deleteTable = altTable
    }

    if (!target) {
      return NextResponse.json({ error: '匹配记录不存在' }, { status: 404 })
    }

    // 执行删除
    await db.execute({
      sql: `DELETE FROM ${deleteTable} WHERE id = ?`,
      args: [matchId],
    })

    console.log(`[admin/delete-match] 管理员 ${decoded.id} 删除了匹配 #${matchId}: ${target.name_a} ↔ ${target.name_b} (${target.week_key}, ${target.source || 'auto'})`)

    return NextResponse.json({
      success: true,
      deleted: {
        id: matchId,
        weekKey: target.week_key,
        users: `${target.name_a} ↔ ${target.name_b}`,
        source: target.source || 'auto',
      },
    })
  } catch (error) {
    console.error('[admin/delete-match]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }
}
