import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken } from '@/lib/csrf'
import { verifyTokenSafe, detectAttackPatterns } from '@/lib/security'




export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // CSRF 校验
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'gps-feedback')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '请求太频繁，请稍后再试' }, { status: 429 })
    }

    const body = await req.json()
    try { await detectAttackPatterns(req, body) } catch {}
    const { latitude, longitude, accuracy, detectedSchool, actualSchool } = body

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return NextResponse.json({ error: '坐标格式错误' }, { status: 400 })
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: '坐标范围无效' }, { status: 400 })
    }

    // actualSchool / detectedSchool 白名单校验（防注入任意字符串）
    const VALID_SCHOOLS = [
      '吉林大学','长春理工大学','长春工业大学','吉林建筑大学',
      '东北师范大学','吉林动画学院','吉林外国语大学',
      '吉林农业大学','长春中医药大学','吉林工程技术师范学院','长春师范大学',
      '吉林财经大学','吉林体育学院','吉林艺术学院','吉林工商学院',
      '长春工程学院','吉林警察学院','长春大学','长春汽车职业技术大学',
      '长春职业技术大学',
      '长春光华学院','长春工业大学人文信息学院','长春电子科技学院',
      '长春财经学院','吉林建筑科技学院','长春建筑学院','长春科技学院',
      '长春大学旅游学院','长春人文学院',
    ]
    const safeActual = (typeof actualSchool === 'string' && VALID_SCHOOLS.includes(actualSchool)) ? actualSchool : null
    const safeDetected = (typeof detectedSchool === 'string' && VALID_SCHOOLS.includes(detectedSchool)) ? detectedSchool : (typeof detectedSchool === 'string' ? detectedSchool.slice(0, 100) : null)

    const userAgent = req.headers.get('user-agent') || ''

    const db = getDb()
    await initDb()

    await db.execute({
      sql: `INSERT INTO gps_feedback (latitude, longitude, accuracy, detected_school, actual_school, user_agent, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        latitude,
        longitude,
        accuracy ?? null,
        safeDetected,
        safeActual,
        userAgent.slice(0, 500),
        ip,
      ],
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('GPS feedback error:', msg)
    return NextResponse.json({ error: '提交失败，请稍后重试' }, { status: 500 })
  }
}


export async function GET(req: NextRequest) {
  try {
    // 管理员权限校验
    const token = req.cookies.get(process.env.NODE_ENV === 'production' ? '__Host-token' : 'token')?.value
    if (!token) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const db = getDb()
    await initDb()

    const user = await verifyTokenSafe(token, db)
    if (!user || !user.isAdmin) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 })
    }

    const result = await db.execute({
      sql: `SELECT id, latitude, longitude, accuracy, detected_school, actual_school, user_agent, ip, created_at
            FROM gps_feedback
            ORDER BY created_at DESC
            LIMIT 100`,
      args: [],
    })

    const feedbacks = result.rows.map(row => ({
      id: Number((row as any).id),
      latitude: (row as any).latitude,
      longitude: (row as any).longitude,
      accuracy: (row as any).accuracy,
      detectedSchool: (row as any).detected_school,
      actualSchool: (row as any).actual_school,
      userAgent: (row as any).user_agent,
      ip: (row as any).ip,
      createdAt: (row as any).created_at,
    }))

    return NextResponse.json({ feedbacks })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('GPS feedback list error:', msg)
    return NextResponse.json({ error: '获取失败' }, { status: 500 })
  }
}


export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get(process.env.NODE_ENV === 'production' ? '__Host-token' : 'token')?.value
    if (!token) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const db = getDb()
    await initDb()

    const user = await verifyTokenSafe(token, db)
    if (!user || !user.isAdmin) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 })
    }

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败' }, { status: 403 })
    }

    const delBody = await req.json()
    try { await detectAttackPatterns(req, delBody) } catch {}
    const { id } = delBody
    if (typeof id !== 'number') {
      return NextResponse.json({ error: '参数错误' }, { status: 400 })
    }

    await db.execute({ sql: 'DELETE FROM gps_feedback WHERE id = ?', args: [id] })
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('GPS feedback delete error:', msg)
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }
}
