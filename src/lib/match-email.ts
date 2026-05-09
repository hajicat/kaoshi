/**
 * 匹配结果通知邮件模块
 *
 * 功能：
 *   - 周日晚20:00（北京时间）后，给本周匹配成功的用户发送邮件
 *   - 通过 Brevo API 发送，复用现有 sendViaBrevo 基础设施
 *   - 防重复：settings 表记录已发送状态（notify_sent_{week}_{uid}）
 *   - 速率控制：每封邮件间隔 3 秒，避免触发 Brevo 频率限制
 *
 * 触发方式：
 *   与 auto match 相同的"首位访客触发"模式——
 *   周日 20:00 后第一个打开 /match 的用户触发批量发送。
 */

import { getDb } from './db'
import { getWeekKey, getPrevWeekKey, isRevealWindow } from './week'

// ── 配置常量 ──

/** 每两封邮件之间的间隔（毫秒），防止 Brevo 频率限制 */
const SEND_INTERVAL_MS = 3000

/** 单次执行最大发送数量（安全上限） */
const MAX_SEND_PER_RUN = 50

// Brevo API 复用
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

function getFromEmail(): string {
  return process.env.BREVO_FROM_EMAIL || 'noreply@jaihelp.icu'
}

// ── 邮件模板 ──

/**
 * 构建匹配成功通知邮件 HTML
 *
 * 设计风格：与验证码/重置密码邮件保持一致的渐变 + 圆角风格
 */
function buildMatchEmailHtml(params: {
  nickname: string
  partnerNickname: string
  partnerGender: string | null
  score: number
  weekKey: string
  topReasons: string[]
}): string {
  const { nickname, partnerNickname, partnerGender, score, weekKey, topReasons } = params
  const genderLabel = partnerGender === 'female' ? '女生' : partnerGender === 'male' ? '男生' : ''
  const scoreColor = score >= 86 ? '#10b981' : score >= 76 ? '#f59e0b' : '#ef4444'
  const scoreLabel = score >= 86 ? '非常合拍 🎉' : score >= 76 ? '值得认真了解 💕' : '可以试试聊看 ☕️'

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <span style="font-size: 36px;">💌</span>
        吉我爱
        <p style="color: #888; font-size: 13px; margin: 0;">${weekKey} 匹配周期</p>
      </div>

      <!-- 主卡片 -->
      <div style="background: linear-gradient(135deg, #ec4899, #a855f7); border-radius: 18px; padding: 28px 20px; text-align: center; margin: 20px 0;">
        <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 0 0 12px;">Hi ${nickname} 👋 你本周匹配到了：</p>

        <div style="background: rgba(255,255,255,0.15); border-radius: 14px; padding: 18px; margin: 14px 0;">
          <div style="width: 56px; height: 56px; background: rgba(255,255,255,0.25); border-radius: 50%; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center; font-size: 24px;">
            ${partnerNickname[0]}
          </div>
          <h2 style="color: #fff; margin: 0; font-size: 22px; font-weight: bold;">${partnerNickname}</h2>
          ${genderLabel ? `<span style="color: rgba(255,255,255,0.75); font-size: 13px;">${genderLabel}</span>` : ''}
        </div>

        <div style="margin-top: 16px;">
          <span style="color: rgba(255,255,255,0.8); font-size: 13px;">契合度</span>
          <div style="font-size: 40px; font-weight: bold; color: #fff; letter-spacing: -1px;">${score}<span style="font-size: 20px;">%</span></div>
          <span style="display: inline-block; background: rgba(255,255,255,0.2); color: #fff; padding: 4px 14px; border-radius: 20px; font-size: 12px; margin-top: 6px;">
            ${scoreLabel}
          </span>
        </div>
      </div>

      <!-- 匹配原因 -->
      ${topReasons.length > 0 ? `
      <div style="background: #fefce8; border-radius: 14px; padding: 18px; margin: 16px 0;">
        <h3 style="color: #92400e; margin: 0 0 10px; font-size: 14px;">💡 为什么匹配到 TA？</h3>
        ${topReasons.slice(0, 3).map(r => `
          <div style="color: #78350f; font-size: 13px; line-height: 1.6; padding: 6px 0; border-bottom: 1px solid #fde68a;">
            • ${r}
          </div>
        `).join('')}
      </div>
      ` : ''}

      <!-- 行动提示 -->
      <div style="background: linear-gradient(135deg, #f0fdf4, #ecfdf5); border-radius: 14px; padding: 20px; text-align: center; margin: 20px 0;">
        <p style="color: #166534; font-size: 14px; font-weight: 600; margin: 0 0 8px;">🎉 快去查看你的匹配详情吧！</p>
        <p style="color: #15803d; font-size: 13px; margin: 0 0 14px;">双方确认后可交换联系方式</p>
        <a href="${process.env.APP_URL || 'https://jaihelp.icu'}/match"
           style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #ec4899, #a855f7); color: #fff; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 15px;">
           🔍 前往查看匹配详情 →
        </a>
      </div>

      <div style="background: #f8f8f8; border-radius: 12px; padding: 14px; font-size: 12px; color: #666; line-height: 1.6; text-align: center;">
        <p style="margin: 0 0 6px;">⏰ 匹配结果在每周日 <strong>20:00</strong> 准时揭晓</p>
        <p style="margin: 0 0 6px;">💡 双方确认交换联系方式后即可看到对方的微信/QQ</p>
        <p style="margin: 0;">如果这不是你本人操作或已不需要此服务，请忽略此邮件</p>
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="text-align: center; color: #aaa; font-size: 11px; margin: 0;">
        此邮件由系统自动发送，请勿回复<br />
        吉我爱 &mdash; 发现校园缘分 ✨
      </p>
    </div>
  `
}

// ── 核心发送逻辑 ──

/**
 * 发送单封匹配通知邮件（内部使用，带速率控制）
 *
 * @returns 成功返回 true，用户已发送过/跳过也返回 true（非错误）
 *          仅网络错误/Brevo 错误返回 false
 */
export async function sendOneEmail(
  toEmail: string,
  params: {
    nickname: string
    partnerNickname: string
    partnerGender: string | null
    score: number
    weekKey: string
    topReasons: string[]
  },
): Promise<boolean> {
  try {
    const apiKey = process.env.BREVO_API_KEY
    if (!apiKey) {
      return true // 不算错误，只是静默跳过
    }

    const htmlContent = buildMatchEmailHtml(params)
    const subject = `💌 你的本周匹配结果来了！${params.score}% 契合度`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 秒超时
    let response: Response
    try {
      response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          sender: { name: '吉我爱', email: getFromEmail() },
          to: [{ email: toEmail }],
          subject,
          htmlContent,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * 执行批量匹配通知邮件发送
 *
 * 流程：
 *   1. 检查是否到揭晓时间（周日 20:00 北京时间）
 *   2. 查询当前周所有未发通知的匹配记录
 *   3. 逐个发送（带 3 秒间隔），标记已发送状态
 *   4. 返回统计信息
 *
 * @returns 执行结果统计
 */
export async function sendMatchNotifications(): Promise<{
  status: string
  weekKey?: string
  sent?: number
  skipped?: number
  failed?: number
  error?: string
  message?: string
}> {
  const db = getDb()
  let weekKey = getWeekKey()
  const prevWeekKey = getPrevWeekKey()

  // ── 1. 时间窗口检查 ──
  if (!isRevealWindow()) {
    return { status: 'not_yet', message: '还未到揭晓时间（周日 20:00 北京时间）' }
  }

  // ── 2. 确定正确的 weekKey ──
  // 周一 getWeekKey() 返回新周(W19)，但匹配记录在上一周(W18)
  // 先查哪周有匹配记录，再用正确的 weekKey 抢锁
  const [curWeekCnt, prevWeekCnt] = await Promise.all([
    db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?', args: [weekKey] }),
    db.execute({ sql: 'SELECT COUNT(*) as cnt FROM matches WHERE week_key = ?', args: [prevWeekKey] }),
  ])
  if (Number((curWeekCnt.rows[0] as any).cnt) === 0 && Number((prevWeekCnt.rows[0] as any).cnt) > 0) {
    weekKey = prevWeekKey
  }

  // ── 3. 分布式锁（与 match-engine 共享模式）──
  const lockKey = `notify_lock_${weekKey}`

  // 检查是否已完成
  const doneCheck = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ? AND value = 'done'",
    args: [lockKey],
  })
  if (doneCheck.rows.length > 0) {
    return { status: 'already_done', weekKey }
  }

  // 抢锁
  try {
    await db.execute({
      sql: `INSERT INTO settings (key, value, updated_at)
            SELECT ?, 'running', datetime('now')
            WHERE NOT EXISTS (
              SELECT 1 FROM settings WHERE key = ? AND value IN ('running', 'done')
            )`,
      args: [lockKey, lockKey],
    })
  } catch {
    return { status: 'in_progress', weekKey }
  }

  // 双重检查
  const confirmLock = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [lockKey] })
  if ((confirmLock.rows[0] as any)?.value !== 'running') {
    return { status: 'in_progress', weekKey }
  }

  try {
    // ── 3. 查询本周所有匹配记录 ──
    const matchesResult = await db.execute({
      sql: `
        SELECT m.id, m.user_a, m.user_b, m.score, m.reasons, m.a_revealed, m.b_revealed,
               u_a.email AS a_email, u_a.nickname AS a_nickname, u_a.gender AS a_gender,
               u_b.email AS b_email, u_b.nickname AS b_nickname, u_b.gender AS b_gender
        FROM matches m
        JOIN users u_a ON m.user_a = u_a.id
        JOIN users u_b ON m.user_b = u_b.id
        WHERE m.week_key = ?
          AND (m.source != 'manual' OR m.reveal_at IS NULL OR m.reveal_at <= datetime('now'))
        ORDER BY m.score DESC
      `,
      args: [weekKey],
    })

    const rows = matchesResult.rows as any[]

    if (rows.length === 0) {
      await db.execute({ sql: "UPDATE settings SET value = 'done', updated_at = datetime('now') WHERE key = ?", args: [lockKey] })
      return { status: 'no_matches', weekKey, sent: 0, skipped: 0, failed: 0, message: '本周无匹配记录' }
    }

    // ── 4. 解析 reasons 并逐个发送 ──
    let sent = 0
    let skipped = 0
    let failed = 0

    for (const row of rows) {
      const userIds = [Number(row.user_a), Number(row.user_b)]
      // 用户信息：A 和 B 各自的邮箱、昵称、性别
      const users = [
        { email: row.a_email, name: row.a_nickname, gender: row.a_gender },
        { email: row.b_email, name: row.b_nickname, gender: row.b_gender },
      ]

      let reasons: string[] = []
      try { reasons = JSON.parse(String(row.reasons || '[]')) } catch { /* ignore */ }

      for (let i = 0; i < 2; i++) {
        const uid = userIds[i]
        const me = users[i]           // 当前用户
        const partner = users[1 - i]  // 对方

        // 防重复：检查是否已发送
        const sentKey = `notify_sent_${weekKey}_${uid}`
        const alreadySent = await db.execute({
          sql: "SELECT value FROM settings WHERE key = ?",
          args: [sentKey],
        })

        if (alreadySent.rows.length > 0) {
          skipped++
          continue
        }

        // 发送邮件：收件人是当前用户，内容介绍对方
        const success = await sendOneEmail(me.email, {
          nickname: me.name,
          partnerNickname: partner.name,
          partnerGender: partner.gender,
          score: Number(row.score),
          weekKey,
          topReasons: reasons,
        })

        if (success) {
          // 标记为已发送
          await db.execute({
            sql: "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, 'sent', datetime('now'))",
            args: [sentKey],
          })
          sent++
        } else {
          failed++
        }

        // 速率控制：每封邮件间隔 3 秒（最后一封不需要等）
        const isLastEmail = (i === 1 && row === rows[rows.length - 1])
        if (!isLastEmail) {
          await new Promise(resolve => setTimeout(resolve, SEND_INTERVAL_MS))
        }
      }
    }

    // ── 5. 标记完成 ──
    await db.execute({
      sql: "UPDATE settings SET value = 'done', updated_at = datetime('now') WHERE key = ?",
      args: [lockKey],
    })

    return { status: 'done', weekKey, sent, skipped, failed }

  } catch (err) {
    // 出错释放锁
    await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
    throw err
  }
}
