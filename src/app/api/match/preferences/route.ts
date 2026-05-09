import { NextRequest, NextResponse } from 'next/server'
import { verifyTokenSafe } from '@/lib/auth'
import { validateCsrfToken, getCookieName } from '@/lib/csrf'
import { getDb, initDb } from '@/lib/db'

export const runtime = 'edge'

// 所有学校列表（排序：吉大→东师(211)→吉动(创始人)→长大 → 公办其余 → 民办）
const ALL_SCHOOLS = [
  // ── 优先位 ──
  '吉林大学',                // 985
  '东北师范大学',            // 211
  '吉林动画学院',            // 创始人学校
  '长春大学',
  // ── 公办其余（需校内邮箱在前）──
  '长春理工大学',
  '长春工业大学',
  '吉林建筑大学',
  '吉林农业大学',
  '长春中医药大学',
  '吉林工程技术师范学院',
  '长春师范大学',
  '吉林财经大学',
  '吉林体育学院',
  '吉林艺术学院',
  '吉林工商学院',
  '长春工程学院',
  '吉林警察学院',
  '长春汽车职业技术大学',
  '长春职业技术大学',
  // ── 民办（需校内邮箱在前）──
  '吉林外国语大学',
  '长春光华学院',
  '长春工业大学人文信息学院',
  '长春电子科技学院',
  '长春财经学院',
  '吉林建筑科技学院',
  '长春建筑学院',
  '长春科技学院',
  '长春大学旅游学院',
  '长春人文学院',
]

/** GET: 读取当前用户的匹配学校偏好 */
export async function GET(request: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = request.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const db = getDb()
    await initDb()

    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const result = await db.execute({
      sql: "SELECT school, match_school_prefs FROM users WHERE id = ?",
      args: [decoded.id],
    })

    if (result.rows.length === 0) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    const row = result.rows[0] as any
    const prefsRaw = row.match_school_prefs || 'all'
    let prefs: string[]

    if (prefsRaw === 'all') {
      prefs = [...ALL_SCHOOLS] // 全选
    } else {
      try {
        prefs = JSON.parse(prefsRaw)
      } catch {
        // 兼容旧数据：如果解析失败，视为全选
        prefs = [...ALL_SCHOOLS]
      }
    }

    return NextResponse.json({
      school: row.school || null,
      preferences: prefs,           // 用户勾选的学校数组
      allSchools: ALL_SCHOOLS,      // 所有可选学校（供前端渲染）
      isAllSelected: prefs.length === ALL_SCHOOLS.length,
    })
  } catch (error) {
    console.error('[match/preferences]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

/** POST: 保存匹配学校偏好 */
export async function POST(request: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = request.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 })

    const db = getDb()
    await initDb()

    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    // CSRF 校验（validateCsrfToken 返回 boolean：true=安全, false=无效）
    if (!validateCsrfToken(request)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const body = await request.json()
    const { schools } = body

    // 参数校验
    if (!Array.isArray(schools)) {
      return NextResponse.json({ error: '参数格式错误：schools 必须是数组' }, { status: 400 })
    }

    // 过滤掉无效值，只保留合法学校名
    const validSchools = schools.filter(
      (s: any) => typeof s === 'string' && ALL_SCHOOLS.includes(s)
    )

    // 如果全选了，存 'all' 以节省空间；否则存 JSON 数组
    const prefsValue = validSchools.length >= ALL_SCHOOLS.length
      ? 'all'
      : JSON.stringify(validSchools)

    await db.execute({
      sql: "UPDATE users SET match_school_prefs = ? WHERE id = ?",
      args: [prefsValue, decoded.id],
    })

    return NextResponse.json({
      success: true,
      preferences: validSchools.length >= ALL_SCHOOLS.length ? ALL_SCHOOLS : validSchools,
      isAllSelected: validSchools.length >= ALL_SCHOOLS.length,
    })
  } catch (error) {
    console.error('[match/preferences]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
