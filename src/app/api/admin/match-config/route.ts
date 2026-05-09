// src/app/api/admin/match-config/route.ts
// 管理员匹配配置 API（读写）
//
// GET  → 返回当前匹配配置（阈值、概率模式等）
// PUT  → 更新匹配配置

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { getMatchConfig, saveMatchConfig, clearMatchConfigCache } from '@/lib/match-engine'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
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

    const config = await getMatchConfig()

    return NextResponse.json({ success: true, config })
  } catch (error) {
    console.error('[admin/match-config GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '读取配置失败' }, { status: 500 })
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
    if (!decoded?.isAdmin) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))

    // 只允许修改这些字段，其余忽略
    const updates: Record<string, any> = {}
    if (typeof body.threshold === 'number' && body.threshold >= 0 && body.threshold <= 99) {
      updates.threshold = body.threshold
    }
    if (typeof body.softThreshold === 'number' && body.softThreshold >= 0 && body.softThreshold <= 99) {
      updates.softThreshold = body.softThreshold
    }
    if (typeof body.probabilityMode === 'boolean') {
      updates.probabilityMode = body.probabilityMode
    }
    if (typeof body.baseProbability === 'number' && body.baseProbability >= 0 && body.baseProbability <= 100) {
      updates.baseProbability = body.baseProbability
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '没有有效的更新字段' }, { status: 400 })
    }

    // 校验：softThreshold 不能 > threshold
    const current = await getMatchConfig()
    const newThreshold = updates.threshold ?? current.threshold
    const newSoft = updates.softThreshold ?? current.softThreshold
    if (newSoft > newThreshold) {
      return NextResponse.json({
        error: `软门槛(${newSoft})不能大于硬门槛(${newThreshold})`,
        status: 400,
      })
    }

    // 清缓存 → 写入新配置
    clearMatchConfigCache()
    const config = await saveMatchConfig(updates)

    return NextResponse.json({ success: true, config, message: '配置已保存' })
  } catch (error) {
    console.error('[admin/match-config PUT]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '保存配置失败' }, { status: 500 })
  }
}
