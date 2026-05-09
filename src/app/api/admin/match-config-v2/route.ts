import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { getMatchConfigV2, saveMatchConfigV2, clearMatchConfigV2Cache } from '@/lib/match-engine-v2'


export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const config = await getMatchConfigV2()
    return NextResponse.json({ success: true, config })
  } catch (error) {
    console.error('[admin/match-config-v2 GET]', error instanceof Error ? error.message : String(error))
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
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const updates: Record<string, any> = {}

    // 权重
    const weightFields = ['valuesWeight', 'interactionWeight', 'dailyWeight', 'chatWeight', 'icebreakWeight']
    for (const f of weightFields) {
      if (typeof body[f] === 'number' && body[f] >= 0 && body[f] <= 1) {
        updates[f] = body[f]
      }
    }

    // 阈值
    const thresholdFields = ['strongThreshold', 'normalThreshold', 'backupThreshold']
    for (const f of thresholdFields) {
      if (typeof body[f] === 'number' && body[f] >= 0 && body[f] <= 99) {
        updates[f] = body[f]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '没有有效的更新字段' }, { status: 400 })
    }

    // 校验阈值顺序
    const current = await getMatchConfigV2()
    const newStrong = updates.strongThreshold ?? current.strongThreshold
    const newNormal = updates.normalThreshold ?? current.normalThreshold
    const newBackup = updates.backupThreshold ?? current.backupThreshold
    if (newStrong < newNormal || newNormal < newBackup) {
      return NextResponse.json({ error: '阈值必须满足 strong ≥ normal ≥ backup' }, { status: 400 })
    }

    // 校验权重总和（允许 ±0.01 浮点误差）
    const wV = updates.valuesWeight ?? current.valuesWeight
    const wI = updates.interactionWeight ?? current.interactionWeight
    const wD = updates.dailyWeight ?? current.dailyWeight
    const wC = updates.chatWeight ?? current.chatWeight
    const wB = updates.icebreakWeight ?? current.icebreakWeight
    const weightSum = wV + wI + wD + wC + wB
    if (Math.abs(weightSum - 1) > 0.01) {
      return NextResponse.json({ error: `权重总和必须为 1.0，当前为 ${weightSum.toFixed(2)}` }, { status: 400 })
    }

    clearMatchConfigV2Cache()
    const config = await saveMatchConfigV2(updates)
    return NextResponse.json({ success: true, config, message: 'V2 配置已保存' })
  } catch (error) {
    console.error('[admin/match-config-v2 PUT]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '保存配置失败' }, { status: 500 })
  }
}
