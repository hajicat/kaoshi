import { NextRequest, NextResponse } from 'next/server'
import { verifyLocation } from '@/lib/geo'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken } from '@/lib/csrf'
import { detectAttackPatterns } from '@/lib/security'

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    // CSRF 校验（GPS 验证虽然是读操作，但由用户浏览器主动触发）
    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'geo')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '请求太频繁' }, { status: 429 })
    }

    const geoBody = await req.json()
    try { await detectAttackPatterns(req, geoBody) } catch {}
    const { latitude, longitude } = geoBody

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return NextResponse.json({ error: '坐标格式错误' }, { status: 400 })
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: '坐标范围无效' }, { status: 400 })
    }

    const result = verifyLocation(latitude, longitude)

    if (!result.valid) {
      return NextResponse.json({
        withinRange: false,
        message: result.message,
        nearestCampus: result.nearestCampus || undefined,
        nearestDistance: result.nearestDistance || undefined,
      })
    }

    return NextResponse.json({
      withinRange: true,
      location: result.location,
      requiresSchoolEmail: result.requiresSchoolEmail,
      nearestCampus: result.nearestCampus || undefined,
      nearestDistance: result.nearestDistance || undefined,
      nearbyCampuses: result.nearbyCampuses || [],
    })
  } catch {
    return NextResponse.json({ error: '定位验证失败' }, { status: 500 })
  }
}

export async function GET() {
  // 返回所有校区列表（与 geo.ts CAMPUSES 保持一致）
  return NextResponse.json({
    campusName: '长春高校圈',
    campusAddress: '长春市（29 所本科高校）',
    schools: [
      // 985
      '吉林大学',
      // 公办本科（需校内邮箱）
      '长春理工大学', '长春工业大学', '吉林建筑大学',
      // 211
      '东北师范大学',
      // 创始人学校
      '吉林动画学院',
      // 民办（需校内邮箱）
      '吉林外国语大学',
      // 其余公办
      '吉林农业大学','长春中医药大学','吉林工程技术师范学院','长春师范大学',
      '吉林财经大学','吉林体育学院','吉林艺术学院','吉林工商学院',
      '长春工程学院','吉林警察学院','长春大学','长春汽车职业技术大学',
      '长春职业技术大学',
      // 其余民办
      '长春光华学院','长春工业大学人文信息学院','长春电子科技学院',
      '长春财经学院','吉林建筑科技学院','长春建筑学院','长春科技学院',
      '长春大学旅游学院','长春人文学院'
    ],
    campusCount: 29,
  })
}
