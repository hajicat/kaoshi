import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { checkRateLimit, API_LIMITER } from '@/lib/rate-limit'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'
import { isRevealWindow, getWeekKey, getPrevWeekKey, isMatchingWindow } from '@/lib/week'



const CONFLICT_NAMES: Record<string, string> = {
  dolphin: '🐬 海豚型（回避冲突）',
  cat: '🐱 猫型（焦虑敏感）',
  dog: '🐕 犬型（讨好和解）',
  shark: '🦈 鲨鱼型（强势进攻）',
}

/** 读取当前算法版本 */
async function getAlgorithmVersion(db: ReturnType<typeof getDb>): Promise<'v1' | 'v2'> {
  try {
    const res = await db.execute({ sql: `SELECT value FROM settings WHERE key = 'algorithm_version'`, args: [] })
    const val = (res.rows[0] as any)?.value
    return val === 'v2' ? 'v2' : 'v1'
  } catch { return 'v1' }
}


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const weekKey = getWeekKey()
    const uid = decoded.id
    const version = await getAlgorithmVersion(db)
    const surveyTable = version === 'v2' ? 'survey_responses_v2' : 'survey_responses'
    const prevWeekKey = getPrevWeekKey()

    // ── 主查询：同时查两张表，确保 V1/V2 切换不丢匹配记录 ──
    const baseSql = (table: string) => `SELECT m.*,
      CASE WHEN m.user_a = ? THEN u2.nickname ELSE u1.nickname END as partner_nickname,
      CASE WHEN m.user_a = ? THEN u2.id ELSE u1.id END as partner_id,
      CASE WHEN m.user_a = ? THEN m.a_revealed ELSE m.b_revealed END as i_revealed,
      CASE WHEN m.user_a = ? THEN m.b_revealed ELSE m.a_revealed END as partner_revealed,
      CASE WHEN m.user_a = ? THEN u2.conflict_type ELSE u1.conflict_type END as partner_conflict_type,
      CASE WHEN m.user_a = ? THEN u2.school ELSE u1.school END as partner_school,
      CASE WHEN m.user_a = ? THEN u2.contact_info ELSE u1.contact_info END as partner_contact_info,
      CASE WHEN m.user_a = ? THEN u2.contact_type ELSE u1.contact_type END as partner_contact_type,
      CASE WHEN m.user_a = ? THEN u1.contact_info ELSE u2.contact_info END as self_contact_info
      FROM ${table} m
      JOIN users u1 ON m.user_a = u1.id
      JOIN users u2 ON m.user_b = u2.id
      WHERE (m.user_a = ? OR m.user_b = ?) AND m.week_key IN (?, ?)`

    const queryParams = [uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, weekKey, prevWeekKey]
    const [v1Res, v2Res] = await Promise.all([
      db.execute({ sql: baseSql('matches'), args: queryParams }),
      db.execute({ sql: baseSql('matches_v2'), args: queryParams }),
    ])
    // 合并去重（同 week_key + 同 pair 只保留一条，优先当前版本）
    const seenPairs = new Set<string>()
    const allRows: any[] = []
    const primaryRows = version === 'v2' ? v2Res.rows : v1Res.rows
    const secondaryRows = version === 'v2' ? v1Res.rows : v2Res.rows
    for (const r of [...primaryRows, ...secondaryRows] as any[]) {
      const pairKey = `${r.week_key}_${Math.min(Number(r.user_a), Number(r.user_b))}_${Math.max(Number(r.user_a), Number(r.user_b))}`
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey)
        allRows.push(r)
      }
    }
    allRows.sort((a, b) => {
      if (a.week_key !== b.week_key) return String(b.week_key).localeCompare(String(a.week_key))
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    })

    // 未到揭晓时间 → 非管理员用户看不到任何匹配信息
    if (!isRevealWindow() && !decoded.isAdmin) {
      return NextResponse.json({ match: null, message: '本周匹配尚未完成，请耐心等待' })
    }

    const nowIso = new Date().toISOString()
    let match: any = null
    for (const row of allRows) {
      const r = row as any
      if (r.source === 'manual' && r.reveal_at && !decoded.isAdmin) {
        if (nowIso < String(r.reveal_at)) continue
      }
      match = r
      break
    }

    if (!match) {
      // 检查所有版本的锁（V1 切 V2 后，V1 的锁仍可能存在）
      const lockKeys = [
        `matching_lock_${weekKey}`, `matching_lock_${prevWeekKey}`,
        `matching_lock_v2_${weekKey}`, `matching_lock_v2_${prevWeekKey}`,
      ]
      const [lockRes, surveyRes] = await Promise.all([
        db.execute({
          sql: `SELECT key, value, updated_at FROM settings WHERE key IN (?, ?, ?, ?)`,
          args: lockKeys,
        }),
        db.execute({
          sql: `SELECT updated_at FROM ${surveyTable} WHERE user_id = ? LIMIT 1`,
          args: [uid],
        }),
      ])
      // 找到最新的 done 锁（跨版本）
      let matchedDone = false
      let lockUpdatedAt = ''
      for (const lr of lockRes.rows as any[]) {
        if (lr.value === 'done') {
          matchedDone = true
          if (!lockUpdatedAt || String(lr.updated_at) > lockUpdatedAt) {
            lockUpdatedAt = String(lr.updated_at || '')
          }
        }
      }
      const canSeeStatus = isRevealWindow() || !!decoded.isAdmin

      if (!matchedDone || !canSeeStatus) {
        return NextResponse.json({ match: null, message: '本周匹配尚未完成，请耐心等待', matchedDone: false })
      }

      const surveyRow = surveyRes.rows[0] as any
      const surveyUpdatedAt = surveyRow?.updated_at || ''
      const hasSurvey = !!surveyRow

      if (!hasSurvey) {
        return NextResponse.json({ match: null, message: '本周匹配尚未完成，请耐心等待', matchedDone: false })
      }

      const participatedInThisRound = lockUpdatedAt && surveyUpdatedAt && (surveyUpdatedAt <= lockUpdatedAt)

      if (participatedInThisRound) {
        return NextResponse.json({
          match: null,
          message: '本周暂未匹配到合适的搭档',
          matchedDone: true,
        })
      } else {
        return NextResponse.json({ match: null, message: '本周匹配尚未完成，请耐心等待', matchedDone: false })
      }
    }

    // ── 有可见匹配记录，处理详情 ──
    let partnerContact = null
    let partnerSurvey: any = null

    if (match.i_revealed && match.partner_revealed) {
      if (match.partner_contact_info) {
        try {
          partnerContact = {
            type: match.partner_contact_type,
            info: await decrypt(String(match.partner_contact_info)),
          }
        } catch {
          partnerContact = {
            type: match.partner_contact_type,
            info: '[解密失败]',
            decryptError: true,
          }
        }
      } else {
        partnerContact = { type: null, info: null, empty: true }
      }

      // 获取对方的问卷回答 — 优先当前版本表，无数据时回退另一张表
      const surveyResult = await db.execute({
        sql: `SELECT * FROM ${surveyTable} s WHERE s.user_id = ?`,
        args: [match.partner_id],
      })
      if (surveyResult.rows.length > 0) {
        partnerSurvey = surveyResult.rows[0] as any
      } else {
        const altSurveyTable = version === 'v2' ? 'survey_responses' : 'survey_responses_v2'
        const altResult = await db.execute({
          sql: `SELECT * FROM ${altSurveyTable} s WHERE s.user_id = ?`,
          args: [match.partner_id],
        })
        partnerSurvey = altResult.rows[0] as any || null
      }
    }

    const selfHasContact = !!match.self_contact_info

    // 剥离内部字段，不暴露给前端
    if (partnerSurvey) {
      const { user_id, ...rest } = partnerSurvey
      partnerSurvey = rest
    }

    let dimScores = null
    try {
      dimScores = JSON.parse(String(match.dim_scores || 'null'))
    } catch (e) { /* ignore */ }

    let reasons = []
    try {
      reasons = JSON.parse(String(match.reasons || '[]'))
    } catch (e) { /* ignore */ }

    return NextResponse.json({
      match: {
        id: Number(match.id),
        partnerId: Number(match.partner_id),
        partnerNickname: String(match.partner_nickname),
        partnerSchool: String(match.partner_school || ''),
        score: Number(match.score),
        dimScores: dimScores,
        reasons,
        weekKey: String(match.week_key),
        iRevealed: !!match.i_revealed,
        partnerRevealed: !!match.partner_revealed,
        contact: partnerContact,
        selfHasContact,
        partnerSurvey,
        algorithmVersion: version,
      },
    })
  } catch (error) {
    console.error('[match GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取匹配失败' }, { status: 500 })
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
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    if (!validateCsrfToken(req)) {
      return NextResponse.json({ error: '安全验证失败，请刷新页面重试' }, { status: 403 })
    }

    if (!isRevealWindow() && !decoded.isAdmin) {
      return NextResponse.json({ error: '匹配结果尚未揭晓，请等待周日20:00' }, { status: 403 })
    }

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, API_LIMITER, 'match-reveal')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '操作太频繁' }, { status: 429 })
    }

    const body = await req.json()
    const matchId = body.matchId
    const id = Number(matchId)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: '无效的匹配ID' }, { status: 400 })
    }

    const version = await getAlgorithmVersion(db)

    // 同时查两张表，找到匹配记录
    const matchTable = version === 'v2' ? 'matches_v2' : 'matches'
    const matchResult = await db.execute({
      sql: `SELECT id, user_a, user_b, source, reveal_at FROM ${matchTable} WHERE id = ? AND (user_a = ? OR user_b = ?)`,
      args: [id, decoded.id, decoded.id],
    })
    let match = matchResult.rows[0] as any

    // 如果当前版本表没找到，尝试另一张表
    if (!match) {
      const altTable = version === 'v2' ? 'matches' : 'matches_v2'
      const altResult = await db.execute({
        sql: `SELECT id, user_a, user_b, source, reveal_at FROM ${altTable} WHERE id = ? AND (user_a = ? OR user_b = ?)`,
        args: [id, decoded.id, decoded.id],
      })
      match = altResult.rows[0] as any
      if (match) {
        // 匹配记录在另一张表，用那个表来更新
        if (match.source === 'manual' && match.reveal_at && !decoded.isAdmin) {
          const nowIso = new Date().toISOString()
          if (nowIso < String(match.reveal_at)) {
            return NextResponse.json({ error: '匹配结果尚未揭晓，请等待周日20:00' }, { status: 403 })
          }
        }
        const altUpdate = Number(match.user_a) === decoded.id
          ? await db.execute({ sql: `UPDATE ${altTable} SET a_revealed = 1 WHERE id = ?`, args: [id] })
          : await db.execute({ sql: `UPDATE ${altTable} SET b_revealed = 1 WHERE id = ?`, args: [id] })
        if ((altUpdate as any).rowsAffected === 0) {
          return NextResponse.json({ error: '揭晓失败，请重试' }, { status: 500 })
        }
        return NextResponse.json({ success: true })
      }
    }

    if (!match) return NextResponse.json({ error: '匹配不存在或无权操作' }, { status: 404 })

    if (match.source === 'manual' && match.reveal_at && !decoded.isAdmin) {
      const nowIso = new Date().toISOString()
      if (nowIso < String(match.reveal_at)) {
        return NextResponse.json({ error: '匹配结果尚未揭晓，请等待周日20:00' }, { status: 403 })
      }
    }

    const updateResult = Number(match.user_a) === decoded.id
      ? await db.execute({ sql: `UPDATE ${matchTable} SET a_revealed = 1 WHERE id = ?`, args: [id] })
      : await db.execute({ sql: `UPDATE ${matchTable} SET b_revealed = 1 WHERE id = ?`, args: [id] })
    if ((updateResult as any).rowsAffected === 0) {
      return NextResponse.json({ error: '揭晓失败，请重试' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[match POST]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
