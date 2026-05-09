import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenSafe } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'

export const runtime = 'edge';

// CF Workers 多 isolate 各自独立内存，不使用模块级缓存
// 每次请求直接查询数据库，确保多 isolate 间数据一致

// GET 响应只暴露前端需要的公共设置，不泄露业务内部状态（匹配锁、通知锁、计数器等）
const PUBLIC_SETTINGS = ['gpsRequired', 'inviteRequired'] as const
const ADMIN_SETTINGS = ['gpsRequired', 'inviteRequired', 'algorithm_version'] as const

async function loadSettings(db: ReturnType<typeof getDb>, publicOnly = false) {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    )`)
  } catch { /* ignore */ }

  const row = await db.execute("SELECT key, value FROM settings")
  const rawSettings: Record<string, any> = {}
  if (row.rows.length > 0) {
    for (const r of row.rows as any[]) {
      rawSettings[r.key] = r.value === '1' || r.value === 'true' ? true :
                           r.value === '0' || r.value === 'false' ? false : r.value
    }
  }

  // 公共模式：仅返回白名单 key
  const settings: Record<string, any> = {}
  const keys = publicOnly ? PUBLIC_SETTINGS : Object.keys(rawSettings)
  for (const k of keys) {
    if (k in rawSettings) {
      settings[k] = rawSettings[k]
    }
  }

  // 默认设置
  if (settings.gpsRequired === undefined) settings.gpsRequired = true
  if (settings.inviteRequired === undefined) settings.inviteRequired = true

  return settings
}

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token!, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    const settings = await loadSettings(db, false)

    // 管理员返回扩展设置
    const adminSettings: Record<string, any> = {}
    for (const k of ADMIN_SETTINGS) {
      if (k in settings) adminSettings[k] = settings[k]
    }
    // 默认值
    if (adminSettings.gpsRequired === undefined) adminSettings.gpsRequired = true
    if (adminSettings.inviteRequired === undefined) adminSettings.inviteRequired = true
    if (adminSettings.algorithm_version === undefined) adminSettings.algorithm_version = 'v1'

    return NextResponse.json(adminSettings)
  } catch (error) {
    console.error('[admin/settings GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取设置失败' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    const decoded = await verifyTokenSafe(token!, db)
    if (!decoded?.isAdmin) return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await req.json()

    if (typeof body.gpsRequired === 'boolean') {
      await db.execute({
        sql: `INSERT INTO settings (key, value, updated_at) VALUES ('gpsRequired', ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        args: [body.gpsRequired ? '1' : '0'],
      })
      // 不再使用缓存，重新查询数据库获取最新值
      const settings = await loadSettings(db, true)
      return NextResponse.json({ success: true, ...settings })
    }

    if (typeof body.inviteRequired === 'boolean') {
      await db.execute({
        sql: `INSERT INTO settings (key, value, updated_at) VALUES ('inviteRequired', ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        args: [body.inviteRequired ? '1' : '0'],
      })
      const settings = await loadSettings(db, true)
      return NextResponse.json({ success: true, ...settings })
    }

    if (typeof body.algorithm_version === 'string' && ['v1', 'v2'].includes(body.algorithm_version)) {
      await db.execute({
        sql: `INSERT INTO settings (key, value, updated_at) VALUES ('algorithm_version', ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        args: [body.algorithm_version],
      })
      return NextResponse.json({ success: true, algorithm_version: body.algorithm_version })
    }

    return NextResponse.json({ error: '无效的设置项' }, { status: 400 })
  } catch (error) {
    console.error('[admin/settings POST]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '更新设置失败' }, { status: 500 })
  }
}
