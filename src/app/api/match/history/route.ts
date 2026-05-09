// src/app/api/match/history/route.ts
// 历史匹配记录接口：返回用户所有历史匹配（按周分组）
//
// 安全规则：
//   - 联系方式仅在双方都 revealed 时返回（与 /api/match GET 一致）
//   - 历史周不受 isRevealWindow 限制（已过期的匹配可以查看基本信息）
//   - 当前周的匹配仍受 isRevealWindow 保护
//
// 响应格式：
//   { weeks: [{ weekKey, matches: [...], totalMatches, revealedCount }] }

import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { getClientIp, getCookieName } from '@/lib/csrf'
import { isRevealWindow, getWeekKey, getPrevWeekKey } from '@/lib/week'

/** 读取当前算法版本 */
async function getAlgorithmVersion(db: ReturnType<typeof getDb>): Promise<'v1' | 'v2'> {
  try {
    const res = await db.execute({ sql: `SELECT value FROM settings WHERE key = 'algorithm_version'`, args: [] })
    const val = (res.rows[0] as any)?.value
    return val === 'v2' ? 'v2' : 'v1'
  } catch { return 'v1' }
}

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    
    // 使用 verifyTokenSafe（内部已处理所有异常，失败返回 null）
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const uid = decoded.id
    const currentWeekKey = getWeekKey()
    const prevWeekKey = getPrevWeekKey()
    const isAdmin = !!decoded.isAdmin
    const version = await getAlgorithmVersion(db)

    // ── 同时查两张表，确保 V1/V2 切换不丢历史记录 ──
    const nowIso = new Date().toISOString()
    const inRevealWindow = isRevealWindow()

    const buildQuery = (table: string, isV2: boolean) => {
      let whereClause = '(m.user_a = ? OR m.user_b = ?)'
      const filterArgs: any[] = [uid, uid]

      if (!isAdmin && !isV2) {
        // V1 有 source/reveal_at 列，需要延迟揭晓过滤
        whereClause += ` AND (m.source != 'manual' OR m.reveal_at IS NULL OR m.reveal_at <= ?)`
        filterArgs.push(nowIso)
      }

      const selectCols = isV2
        ? `m.id, m.user_a, m.user_b, m.week_key, m.score, m.dim_scores, m.reasons, m.created_at,
           m.a_revealed, m.b_revealed, NULL as source, NULL as reveal_at`
        : `m.id, m.user_a, m.user_b, m.week_key, m.score, m.dim_scores, m.reasons, m.created_at,
           m.a_revealed, m.b_revealed, m.source, m.reveal_at`

      return {
        sql: `SELECT ${selectCols},
              CASE WHEN m.user_a = ? THEN u2.nickname ELSE u1.nickname END as partner_nickname,
              CASE WHEN m.user_a = ? THEN u2.gender ELSE u1.gender END as partner_gender,
              CASE WHEN m.user_a = ? THEN u2.school ELSE u1.school END as partner_school,
              CASE WHEN m.user_a = ? THEN u2.conflict_type ELSE u1.conflict_type END as partner_conflict_type,
              CASE WHEN m.user_a = ? THEN u2.contact_info ELSE u1.contact_info END as partner_contact_info,
              CASE WHEN m.user_a = ? THEN u2.contact_type ELSE u1.contact_type END as partner_contact_type,
              CASE WHEN m.user_a = ? THEN m.a_revealed ELSE m.b_revealed END as i_revealed,
              CASE WHEN m.user_a = ? THEN m.b_revealed ELSE m.a_revealed END as partner_revealed
              FROM ${table} m
              JOIN users u1 ON m.user_a = u1.id
              JOIN users u2 ON m.user_b = u2.id
              WHERE ${whereClause}`,
        args: [...filterArgs, uid, uid, uid, uid, uid, uid, uid, uid],
      }
    }

    const [v1Res, v2Res] = await Promise.all([
      db.execute(buildQuery('matches', false)),
      db.execute(buildQuery('matches_v2', true)),
    ])

    // 合并去重（同 week_key + 同 pair 只保留一条）
    const seen = new Set<string>()
    const rows: any[] = []
    for (const r of [...v1Res.rows, ...v2Res.rows] as any[]) {
      const key = `${r.week_key}_${Math.min(Number(r.user_a), Number(r.user_b))}_${Math.max(Number(r.user_a), Number(r.user_b))}`
      if (!seen.has(key)) {
        seen.add(key)
        rows.push(r)
      }
    }
    rows.sort((a, b) => {
      if (a.week_key !== b.week_key) return String(b.week_key).localeCompare(String(a.week_key))
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    })

    if (rows.length === 0) {
      return NextResponse.json({ weeks: [], totalWeeks: 0 })
    }

    // ── 按周分组 ──
    const weekMap = new Map<string, any[]>()

    for (const row of rows) {
      const wk = row.week_key
      const iRevealed = !!row.i_revealed
      const partnerRevealed = !!row.partner_revealed
      const bothRevealed = iRevealed && partnerRevealed
      // 揭晓窗口内，上一周的匹配也算"当前周"（周一 getWeekKey() 返回新周，但匹配在上一周）
      const isCurrentWeek = wk === currentWeekKey || (wk === prevWeekKey && isRevealWindow())

      // 联系方式解密：仅双方都确认时返回
      let contact = null
      if (bothRevealed && row.partner_contact_info) {
        try {
          contact = {
            type: row.partner_contact_type,
            info: await decrypt(String(row.partner_contact_info)),
          }
        } catch {
          contact = { type: row.partner_contact_type, info: '[解密失败]', decryptError: true }
          console.warn('[match/history] 历史匹配联系方式解密失败（可能 ENCRYPT_SECRET 配置变更）')
        }
      } else if (bothRevealed && !row.partner_contact_info) {
        contact = { type: null, info: null, empty: true }
      }

      let dimScores = null
      try { dimScores = JSON.parse(String(row.dim_scores || 'null')) } catch { /* ignore */ }

      // 当前周未到揭晓时间 → 非管理员完全跳过该条记录（不返回任何信息）
      // 两种隐藏场景：
      //   1. 当前周 + 不在标准揭晓窗口（自动匹配的常规保护）
      //   2. 手动匹配(source=manual) + 未到 reveal_at 时间（延迟揭晓保护，仅 V1）
      const isManualNotRevealed = row.source === 'manual' && row.reveal_at && (nowIso < String(row.reveal_at))
      const hideDetails = (isCurrentWeek && !isRevealWindow() && !isAdmin) || (isManualNotRevealed && !isAdmin)
      if (hideDetails) continue

      let reasons = []
      try { reasons = JSON.parse(String(row.reasons || '[]')) } catch { /* ignore */ }

      const entry = {
        id: Number(row.id),
        partnerNickname: String(row.partner_nickname || '未知'),
        partnerGender: row.partner_gender || null,
        partnerSchool: String(row.partner_school || ''),
        score: Number(row.score),
        dimScores,
        reasons,
        createdAt: row.created_at,
        iRevealed,
        partnerRevealed,
        bothRevealed,
        contact: bothRevealed ? contact : null,
        hidden: hideDetails,
      }

      if (!weekMap.has(wk)) weekMap.set(wk, [])
      weekMap.get(wk)!.push(entry)
    }

    // ── 构建响应数组（按周倒序）──
    const weeks = Array.from(weekMap.entries()).map(([weekKey, matches]) => {
      const revealedCount = matches.filter(m => m.bothRevealed).length
      const isCurrent = weekKey === currentWeekKey || (weekKey === prevWeekKey && isRevealWindow())
      return {
        weekKey,
        isCurrent,
        totalMatches: matches.length,
        revealedCount,
        matches,
      }
    })

    return NextResponse.json({
      weeks,
      totalWeeks: weeks.length,
    })
  } catch (error) {
    console.error('[match/history]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取历史匹配失败' }, { status: 500 })
  }
}
