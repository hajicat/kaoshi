// src/lib/week.ts
// 周期管理：自定义周边界（周日 12:00 北京时间 = 周日 04:00 UTC）
//
// 设计：
//   - 匹配触发窗口：北京时间周日 12:00 之后（UTC 周日 04:00+）
//   - 周日 12:00 之前完成问卷的人 → 进入当周匹配池
//   - 周日 12:00 之后完成问卷的人 → 进入下一周匹配池（因为本周已开始匹配）

/**
 * 计算某一天的 ISO 8601 周数（纯 UTC，无时区依赖）
 * ISO 定义：含周四的那一周属于该年，周一为周首
 */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayOfWeek = d.getUTCDay() || 7         // 周日=7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek)  // 找到本周四
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  )
  return { year: d.getUTCFullYear(), week: weekNum }
}

/**
 * 获取当前匹配周期的 week_key
 *
 * 自定义周边界：周一 00:00 北京时间 ~ 周日 12:00 北京时间 = 同一个周期
 * 北京时间周日 12:00（UTC 周日 04:00）之后 → 算"下一周"
 *
 * 为什么用 UTC 而不是本地时间？
 *   Cloudflare Edge Runtime 分布在全球各地运行，
 *   本地时间 (getDay/getDate) 在不同 edge node 上结果不同。
 *   UTC 是唯一可靠的跨地域基准。
 */
export function getWeekKey(): string {
  const now = new Date()
  const utcDay = now.getUTCDay()
  const utcHours = now.getUTCHours()

  // 北京时间周日 12:00 之后（UTC 周日 04:00+）
  // 此时本周匹配已经开始/完成，新填问卷的人应该进下一周的池子
  if (utcDay === 0 && utcHours >= 4) {
    // 用昨天（周六）的日期来算 ISO 周 → 得到"上一周"的 key
    const saturday = new Date(now)
    saturday.setUTCDate(saturday.getUTCDate() - 1)
    const { year, week } = getISOWeek(saturday)
    return `${year}-W${String(week).padStart(2, '0')}`
  }

  const { year, week } = getISOWeek(now)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * 判断当前是否在匹配窗口内（北京时间周日 12:00 ~ 下周一 12:00 前）
 * 即：UTC 周日 04:00 ~ 周一 03:59
 */
export function isMatchingWindow(): boolean {
  const now = new Date()
  const utcDay = now.getUTCDay()
  const utcHours = now.getUTCHours()
  // UTC 周日 04:00 ~ 周一 03:59（北京时间 周日 12:00 ~ 周一 11:59）
  return (utcDay === 0 && utcHours >= 4) || (utcDay === 1 && utcHours < 4)
}

/**
 * 判断当前是否已过揭晓时间 / 处于结果可见窗口内
 *
 * 可见窗口：北京时间 周日 20:00 ~ 周四 00:00
 * 对应 UTC：  周日 12:00 ~ 周三 16:00
 *
 * 超过此窗口后，即使本周已有匹配结果也不再展示主卡片，
 * 用户需等待下一轮匹配揭晓。
 */
export function isRevealWindow(): boolean {
  const now = new Date()
  const utcDay = now.getUTCDay()
  const utcHours = now.getUTCHours()

  // UTC 周日 12:00+  → 北京 周日 20:00+
  if (utcDay === 0) return utcHours >= 12
  // UTC 周一全天      → 北京 周一 08:00 ~ 周二 08:00
  if (utcDay === 1) return true
  // UTC 周二全天      → 北京 周二 08:00 ~ 周三 08:00
  if (utcDay === 2) return true
  // UTC 周三 00:00~15:59 → 北京 周三 08:00 ~ 周四 00:00 前
  if (utcDay === 3) return utcHours < 16

  return false
}

/**
 * 获取上一周的 week_key（用于揭晓窗口内回退查询上一周匹配结果）
 *
 * 回退 7 天取 ISO 周，确保无论周几都落在上一周。
 */
export function getPrevWeekKey(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 7)
  const { year, week } = getISOWeek(d)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * 获取自动匹配会使用的 week_key
 *
 * 周日自动匹配跑时 getWeekKey() 返回的是"上一个 ISO 周"（因为用周六的日期算）。
 * 但周一手动匹配时 getWeekKey() 返回的是"当前 ISO 周"。
 * 两者不同，导致自动匹配排除逻辑查不到手动匹配的记录。
 *
 * 此函数始终返回"自动匹配在周日会用的那个 week_key"，
 * 手动匹配应使用此函数以保持一致。
 */
export function getAutoMatchWeekKey(): string {
  const now = new Date()
  const utcDay = now.getUTCDay()       // 0=Sun
  const utcHours = now.getUTCHours()

  // 周日 UTC 4:00+（北京 12:00+）：与 getWeekKey 一致，用周六算
  if (utcDay === 0 && utcHours >= 4) {
    const saturday = new Date(now)
    saturday.setUTCDate(saturday.getUTCDate() - 1)
    const { year, week } = getISOWeek(saturday)
    return `${year}-W${String(week).padStart(2, '0')}`
  }

  // 其他时间：找上一个周日（含今天如果是周日），用那天的 ISO 周
  // ISO 周从周一开始，周日是最后一天，所以"上一个周日"属于当前 ISO 周
  const daysSinceSun = utcDay === 0 ? 0 : utcDay  // 周日=0天，周一=1天，...，周六=6天
  const prevSunday = new Date(now)
  prevSunday.setUTCDate(prevSunday.getUTCDate() - daysSinceSun)
  const { year, week } = getISOWeek(prevSunday)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * 从日期字符串计算 week_key（管理员手动指定匹配日期时使用）
 * 与 getWeekKey 使用相同的 UTC 基准和周边界规则
 */
export function dateToWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z') // 强制按 UTC 零点解析
  if (isNaN(d.getTime())) return getWeekKey()

  const { year, week } = getISOWeek(d)
  return `${year}-W${String(week).padStart(2, '0')}`
}
