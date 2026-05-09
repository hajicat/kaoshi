import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { hashPassword, createToken, generateInviteCode } from '@/lib/auth'
import { validateEmail, validateNickname, validateInviteCode, sanitizeString } from '@/lib/validation'
import { nicknameToPinyin } from '@/lib/pinyin'
import { checkRateLimit, REGISTER_LIMITER, checkRateLimitByEmail, EMAIL_REGISTER_LIMITER } from '@/lib/rate-limit'
import { getClientIp, setCsrfCookie, getCookieName, validateCsrfToken } from '@/lib/csrf'
import { haversineDistance, verifyLocation } from '@/lib/geo'
import { verifyCode } from '@/lib/email'
import { logSecurityEvent, detectAttackPatterns } from '@/lib/security'

export const runtime = 'edge'

// 学校邮箱域名白名单（需校内邮箱的学校）
const SCHOOL_EMAIL_DOMAINS = [
  'jlu.edu.cn',           // 吉林大学（教职工/学生）
  'mails.jlu.edu.cn',     // 吉林大学（学生）
  'mails.cust.edu.cn',    // 长春理工大学
  'stu.ccut.edu.cn',      // 长春工业大学
  'jlju.edu.cn',          // 吉林建筑大学
  'nenu.edu.cn',          // 东北师范大学
  'jisu.edu.cn',          // 吉林外国语大学
  'mails.ccu.edu.cn',     // 长春大学
]

/** 检查邮箱是否为学校邮箱 */
function isSchoolEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return !!domain && SCHOOL_EMAIL_DOMAINS.includes(domain)
}

// ── 公共函数：注册成功后的统一处理（消除两个分支的重复代码）──

/** 设置所有认证和状态 cookie（token + logged_in + survey_status） */
function setAuthCookies(response: NextResponse, token: string): void {
  const cookieName = getCookieName('token')
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })
  // 非敏感状态 cookie：前端同步读取，新用户默认 pending
  response.cookies.set('logged_in', 'true', {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })
  response.cookies.set('survey_status', 'pending', {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })
}

/** 构建注册成功的标准响应（JSON + CSRF cookie） */
async function buildSuccessResponse(userId: number, nickname: string, email: string, userInviteCode: string): Promise<NextResponse> {
  const token = await createToken({ id: userId, email, isAdmin: false })
  const response = NextResponse.json({
    success: true,
    user: { id: userId, nickname, email, inviteCode: userInviteCode },
  })
  setAuthCookies(response, token)
  return setCsrfCookie(response)
}

export async function POST(req: NextRequest) {
  try {
    // CSRF protection
    if (!validateCsrfToken(req)) {
      try { await logSecurityEvent(req, { eventType: 'csrf_fail', severity: 'critical', detail: { endpoint: 'register' } }) } catch {}
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, REGISTER_LIMITER, 'register')
    if (!rateResult.allowed) {
      try { await logSecurityEvent(req, { eventType: 'rate_limited', severity: 'warning', detail: { action: 'register', retryAfter: rateResult.retryAfter } }) } catch {}
      return NextResponse.json(
        { error: '注册太频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(rateResult.retryAfter) } }
      )
    }

    const body = await req.json()
    try { await detectAttackPatterns(req, body) } catch {}
    const nickname = sanitizeString(body.nickname || '', 20)
    const email = sanitizeString(body.email || '', 254).toLowerCase()
    const password = body.password || ''
    const inviteCode = (typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '').toUpperCase()
    const gender = sanitizeString(body.gender || '', 10)
    const preferredGender = sanitizeString(body.preferredGender || '', 20)
    const latitude = body.latitude
    const longitude = body.longitude
    const selectedCampus = typeof body.selectedCampus === 'string' ? body.selectedCampus.trim() : ''

    // --- GPS Verification (可由管理员在后台开关) ---
    const db = getDb()
    await initDb()

    // 检查 GPS 是否必需
    let gpsEnabled = true
    try {
      const settingsRow = await db.execute("SELECT value FROM settings WHERE key = 'gpsRequired'")
      if (settingsRow.rows.length > 0) {
        gpsEnabled = settingsRow.rows[0].value !== '0' && settingsRow.rows[0].value !== 'false'
      }
    } catch {
      /* 表不存在则默认开启 */
    }

    let requiresSchoolEmail = false
    let geoResult: Awaited<ReturnType<typeof verifyLocation>> | null = null
    if (gpsEnabled) {
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return NextResponse.json({ error: '请先在页面上完成GPS校内验证（点击"点击验证位置"按钮）' }, { status: 400 })
      }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return NextResponse.json({ error: '坐标范围无效' }, { status: 400 })
      }
      geoResult = verifyLocation(latitude, longitude)
      if (!geoResult.valid) {
        return NextResponse.json({ error: geoResult.message }, { status: 403 })
      }

      // 如果用户在前端选择了校区（多校区重叠时），以选择为准
      // 否则使用默认的最近校区
      let chosenRequiresSchoolEmail: boolean
      if (selectedCampus && geoResult.nearbyCampuses && geoResult.nearbyCampuses.length > 1) {
        const chosen = geoResult.nearbyCampuses.find(c => c.name === selectedCampus)
        if (!chosen) {
          return NextResponse.json({ error: '选择的校区无效，请重新验证位置' }, { status: 400 })
        }
        chosenRequiresSchoolEmail = chosen.requiresSchoolEmail
      } else {
        chosenRequiresSchoolEmail = geoResult.requiresSchoolEmail
      }
      requiresSchoolEmail = chosenRequiresSchoolEmail

      // ── 学校邮箱验证（非吉林动画学院/长春大学区域需要校内邮箱）──
      if (requiresSchoolEmail && !isSchoolEmail(email)) {
          return NextResponse.json({
            error: '你所在的高校需要使用校内邮箱注册（@jlu.edu.cn / @mails.jlu.edu.cn / @mails.cust.edu.cn / @stu.ccut.edu.cn / @jlju.edu.cn / @nenu.edu.cn / @jisu.edu.cn）',
          }, { status: 400 })
        }
    }

    // 不管 GPS 定位到哪个学校，只要邮箱是校内邮箱域名就自动通过认证
    if (isSchoolEmail(email)) {
      requiresSchoolEmail = true
    }

    // --- Input Validation ---
    const nicknameCheck = validateNickname(nickname)
    if (!nicknameCheck.valid) return NextResponse.json({ error: nicknameCheck.error }, { status: 400 })

    const emailCheck = validateEmail(email)
    if (!emailCheck.valid) return NextResponse.json({ error: emailCheck.error }, { status: 400 })

    // Validate gender（无论是否需要邀请码都必填）
    if (!['male', 'female', 'other'].includes(gender)) {
      return NextResponse.json({ error: '请选择你的性别' }, { status: 400 })
    }
    if (!['male', 'female', 'all'].includes(preferredGender)) {
      return NextResponse.json({ error: '请选择你想匹配的性别' }, { status: 400 })
    }

    // ── 邀请码系统（可由管理员在后台开关）──
    // 检查是否需要邀请码
    let inviteRequired = true
    try {
      const inviteSetting = await db.execute("SELECT value FROM settings WHERE key = 'inviteRequired'")
      if (inviteSetting.rows.length > 0) {
        inviteRequired = inviteSetting.rows[0].value !== '0' && inviteSetting.rows[0].value !== 'false'
      }
    } catch {
      /* 表不存在则默认开启 */
    }

    if (inviteRequired) {
      const codeCheck = validateInviteCode(inviteCode)
      if (!codeCheck.valid) return NextResponse.json({ error: codeCheck.error }, { status: 400 })

      // ── 先完成所有校验（不消耗使用次数）──
      // 获取完整的邀请码记录
      const codeResult = await db.execute({
        sql: 'SELECT * FROM invite_codes WHERE code = ?',
        args: [inviteCode],
      })
      const codeRow = codeResult.rows[0] as any
      if (!codeRow) {
        return NextResponse.json({ error: '邀请码无效或已用完' }, { status: 400 })
      }

      // 检查是否已达上限（预检查，最终由原子 UPDATE 保证）
      if (Number(codeRow.current_uses) >= Number(codeRow.max_uses)) {
        return NextResponse.json({ error: '邀请码已用完' }, { status: 400 })
      }

      // 验证 created_by 对应的用户是否存在（防止 FK 约束失败）
      const createdBy = Number(codeRow.created_by)
      if (!createdBy || createdBy <= 0 || isNaN(createdBy)) {
        return NextResponse.json({ error: '邀请码数据异常，请联系管理员' }, { status: 400 })
      }
      const creatorCheck = await db.execute({
        sql: 'SELECT id FROM users WHERE id = ?',
        args: [createdBy],
      })
      if (creatorCheck.rows.length === 0) {
        console.error('[register] 邀邀码 created_by 指向不存在的用户:', { code: inviteCode, createdBy })
        return NextResponse.json({ error: '邀请码无效（关联用户不存在），请联系管理员' }, { status: 400 })
      }

      // 防自邀注册：不能使用自己的邀请码注册新账号
      const creatorResult = await db.execute({
        sql: 'SELECT email FROM users WHERE id = ?',
        args: [Number(codeRow.created_by)],
      })
      if (creatorResult.rows.length > 0) {
        const creatorEmail = ((creatorResult.rows[0] as any).email || '').toLowerCase()
        if (creatorEmail === email) {
          return NextResponse.json({ error: '不能使用自己的邀请码注册' }, { status: 400 })
        }
      }

      // 检查邮箱是否已注册（防止 UNIQUE 冲突返回通用错误）
      const existingCheck = await db.execute({
        sql: "SELECT id FROM users WHERE LOWER(email) = ?",
        args: [email],
      })
      if (existingCheck.rows.length > 0) {
        return NextResponse.json({ error: '该邮箱已注册' }, { status: 400 })
      }

      // 邮箱验证码校验（注册必须先验证邮箱）
      const verificationCode = body.verificationCode || ''
      if (!verificationCode || typeof verificationCode !== 'string') {
        return NextResponse.json({ error: '请先获取并输入邮箱验证码' }, { status: 400 })
      }
      const verifyResult = await verifyCode(email, verificationCode, db)
      if (!verifyResult.valid) {
        return NextResponse.json({ error: verifyResult.error }, { status: 400 })
      }

      // ── 所有校验通过，原子递增使用次数（防止并发竞态）──
      const updateResult = await db.execute({
        sql: `UPDATE invite_codes SET current_uses = current_uses + 1
              WHERE code = ? AND current_uses < max_uses`,
        args: [inviteCode],
      })
      if (!updateResult.rowsAffected || (updateResult as any).rowsAffected === 0) {
        return NextResponse.json({ error: '邀请码无效或已用完（并发耗尽）' }, { status: 400 })
      }

      // 确定用户选择的学校名称
      let userSchool: string | null = null
      if (gpsEnabled && geoResult?.valid) {
        if (selectedCampus) {
          const chosen = geoResult.nearbyCampuses?.find(c => c.name === selectedCampus)
          userSchool = chosen?.schoolName || null
        } else {
          userSchool = geoResult.nearestCampus || null
        }
      }

      // Create user (with invited_by from invite code)
      const defaultPassword = nicknameToPinyin(nickname)
      const passwordHash = await hashPassword(defaultPassword)
      const userInviteCode = generateInviteCode()

      const insertResult = await db.execute({
        sql: `INSERT INTO users (nickname, email, password_hash, invite_code, invited_by, gender, preferred_gender, school, email_verified, verification_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        args: [nickname, email, passwordHash, userInviteCode, Number(codeRow.created_by), gender, preferredGender,
          userSchool, requiresSchoolEmail ? 'verified_student' : 'pending_verification'],
      })

      const newUserId = Number(insertResult.lastInsertRowid)

      // Update invite code: set used_by to new user (current_uses already atomically incremented)
      await db.execute({
        sql: 'UPDATE invite_codes SET used_by = ? WHERE id = ?',
        args: [newUserId, Number(codeRow.id)],
      })

      // Give new user 3 invite codes (batch insert)
      const newUserCodes: Array<{ sql: string; args: any[] }> = []
      for (let i = 0; i < 3; i++) {
        const code = generateInviteCode()
        newUserCodes.push({
          sql: 'INSERT INTO invite_codes (code, created_by) VALUES (?, ?)',
          args: [code, newUserId],
        })
      }
      try { await db.batch(newUserCodes) } catch (_) {
        // fallback to individual inserts if batch not supported
        for (const stmt of newUserCodes) {
          try { await db.execute(stmt) } catch (__) { /* ignore */ }
        }
      }

      return await buildSuccessResponse(newUserId, nickname, email, userInviteCode)
    }

    // ════════════════════════════════════════════
    // 以下为「不需要邀请码」的注册流程
    // ════════════════════════════════════════════

    // 邮箱验证码校验（无论是否需要邀请码都需要）
    const verificationCode = body.verificationCode || ''
    if (!verificationCode || typeof verificationCode !== 'string') {
      return NextResponse.json({ error: '请先获取并输入邮箱验证码' }, { status: 400 })
    }
    const verifyResult = await verifyCode(email, verificationCode, db)
    if (!verifyResult.valid) {
      return NextResponse.json({ error: verifyResult.error }, { status: 400 })
    }

    // Check email exists (case-insensitive) — 必须在 INSERT 之前！
    const existingResult = await db.execute({
      sql: "SELECT id FROM users WHERE LOWER(email) = ?",
      args: [email],
    })
    if (existingResult.rows.length > 0) {
      return NextResponse.json({ error: '该邮箱已注册' }, { status: 400 })
    }

    // 邮箱维度限流
    const emailRateResult = await checkRateLimitByEmail(email, EMAIL_REGISTER_LIMITER, 'register')
    if (!emailRateResult.allowed) {
      return NextResponse.json(
        { error: '该邮箱今日注册次数已达上限' },
        { status: 429, headers: { 'Retry-After': String(emailRateResult.retryAfter) } }
      )
    }

    // 确定用户选择的学校名称
    let userSchool: string | null = null
    if (gpsEnabled && geoResult?.valid) {
      if (selectedCampus) {
        const chosen = geoResult.nearbyCampuses?.find(c => c.name === selectedCampus)
        userSchool = chosen?.schoolName || null
      } else {
        userSchool = geoResult.nearestCampus || null
      }
    }

    // Create user (no invited_by — open registration)
    const defaultPassword = nicknameToPinyin(nickname)
    const passwordHash = await hashPassword(defaultPassword)
    const userInviteCode = generateInviteCode()

    const insertResult = await db.execute({
      sql: `INSERT INTO users (nickname, email, password_hash, invite_code, gender, preferred_gender, school, email_verified, verification_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      args: [nickname, email, passwordHash, userInviteCode, gender, preferredGender,
        userSchool, requiresSchoolEmail ? 'verified_student' : 'pending_verification'],
    })

    const newUserId = Number(insertResult.lastInsertRowid)

    return await buildSuccessResponse(newUserId, nickname, email, userInviteCode)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[register]', errMsg)
    return NextResponse.json(
      { error: '注册失败，请稍后重试' },
      { status: 500 }
    )
  }
}
