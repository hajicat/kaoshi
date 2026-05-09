// src/lib/match-engine.ts
// 匹配引擎：从 admin/match/route.ts 提取，供 admin、auto 共用
//
// 所有算法函数（ansIdx, calcSafety, calcTruth, sameFreqScore,
// scoreQ22~scoreQ28, calculateMatch, generateReasons, genderCompatible）
// 与原 admin/match/route.ts 完全一致，一字未改。
// 新增 executeAutoMatch() 自动批量匹配逻辑。

import { getDb } from './db'
import { getWeekKey, getAutoMatchWeekKey, dateToWeekKey } from './week'

export { getWeekKey, isMatchingWindow } from './week'

// ── 带数据库锁的安全自动匹配（admin + auto 共用）──
//
// 状态机：not_started → running → done
// 使用 settings 表做分布式锁：
//   key = "matching_lock_{weekKey}"
//   value = "running" | "done"
//
// 死锁阈值：锁超过 5 分钟视为异常，允许抢占

const LOCK_EXPIRE_MS = 5 * 60 * 1000

export async function executeAutoMatchSafe(db: ReturnType<typeof getDb>): Promise<{
  status: string
  weekKey?: string
  message?: string
  matchedPairs?: number
  unmatchedUsers?: number
  totalEligible?: number
  safePoolSize?: number
}> {
  const weekKey = getWeekKey()
  const lockKey = `matching_lock_${weekKey}`

  // 1. 已经完成 → 直接返回
  const doneCheck = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ? AND value = 'done'",
    args: [lockKey],
  })
  if (doneCheck.rows.length > 0) {
    return { status: 'already_done', weekKey }
  }

  // 2. 正在跑 → 检查是否死锁
  const runningCheck = await db.execute({
    sql: "SELECT value, updated_at FROM settings WHERE key = ? AND value = 'running'",
    args: [lockKey],
  })
  if (runningCheck.rows.length > 0) {
    const lockRow = runningCheck.rows[0] as any
    const lockTime = lockRow.updated_at
    if (lockTime) {
      const lockAge = Date.now() - new Date(lockTime).getTime()
      if (lockAge > LOCK_EXPIRE_MS) {
        // 死锁：清除旧锁后继续
        await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
      } else {
        // 正在执行中，让客户端稍后重试
        return { status: 'in_progress', weekKey }
      }
    } else {
      return { status: 'in_progress', weekKey }
    }
  }

  // 3. 抢锁（原子操作：INSERT ... WHERE NOT EXISTS）
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
    // INSERT 冲突说明别人抢到了
    return { status: 'in_progress', weekKey }
  }

  // 4. 双重检查：确认抢锁成功
  const confirmLock = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: [lockKey],
  })
  if ((confirmLock.rows[0] as any)?.value !== 'running') {
    return { status: 'in_progress', weekKey }
  }

  // 5. 执行匹配
  try {
    const result = await executeAutoMatch(weekKey)

    // 标记完成
    await db.execute({
      sql: "UPDATE settings SET value = 'done', updated_at = datetime('now') WHERE key = ?",
      args: [lockKey],
    })

    return {
      status: 'done',
      weekKey,
      matchedPairs: result.matchedPairs,
      unmatchedUsers: result.unmatchedUsers,
      totalEligible: result.totalEligible,
      safePoolSize: result.safePoolSize,
    }
  } catch (err) {
    // 出错释放锁，下次可以重试
    await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
    throw err
  }
}

/** 重置本周匹配锁（管理员手动重新匹配时使用） */
export async function resetWeekMatchLock(weekKey?: string): Promise<boolean> {
  const db = getDb()
  const key = weekKey || getWeekKey()
  const lockKey = `matching_lock_${key}`
  try {
    await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
    // 同时删除本周的匹配记录，允许重新匹配
    await db.execute({ sql: "DELETE FROM matches WHERE week_key = ?", args: [key] })
    return true
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────
//  类型定义
// ─────────────────────────────────────────────

export interface SafetyResult {
  level: 'blocked' | 'restricted' | 'normal'
  riskScore: number
  hardBlock: boolean
}

export interface MatchResult {
  score: number
  dimScores: Array<{ name: string; score: number; compatible: boolean }>
  reasons: string[]
  safetyLevel: string
  truthScore: number
}

export interface MatchedPairDetail {
  userA: string
  userB: string
  score: number
}

export interface UnmatchedDetail {
  nickname: string
  gender: string
  reason: string
}

export interface AutoMatchResult {
  success: boolean
  weekKey: string
  matchedPairs: number
  unmatchedUsers: number
  totalEligible: number
  safePoolSize: number
  matchedDetails?: MatchedPairDetail[]
  unmatchedDetails?: UnmatchedDetail[]
}

// ─────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────

const SAME_FREQ_QUESTIONS = ['q15','q16','q18','q19','q20','q23','q27','q29','q30','q31','q32']

const COMP_QUESTIONS = [
  { id: 'q22', fn: scoreQ22, name: '安抚方式' },
  { id: 'q24', fn: scoreQ24, name: '角色分工' },
  { id: 'q25', fn: scoreQ25, name: '冲突节奏' },
  { id: 'q26', fn: scoreQ26, name: '争执修复' },
  { id: 'q28', fn: scoreQ28, name: '需求表达' },
]

// ─────────────────────────────────────────────
//  匹配配置（后台可调，存储在 settings 表）
// ─────────────────────────────────────────────

export interface MatchConfig {
  /** 硬门槛：>= 此分数一定匹配（默认 76） */
  threshold: number
  /** 软门槛：>= 此分数有概率匹配（默认 50，仅概率模式生效） */
  softThreshold: number
  /** 概率模式开关（默认关闭） */
  probabilityMode: boolean
  /** 概率模式下，软硬门槛之间的基础命中率（默认 30%） */
  baseProbability: number
}

/** 默认配置 */
const DEFAULT_CONFIG: MatchConfig = {
  threshold: 76,
  softThreshold: 50,
  probabilityMode: false,
  baseProbability: 30,
}

/** settings 表中的 key */
const MATCH_CONFIG_KEY = 'match_config'

/**
 * 从 settings 表读取匹配配置（带缓存，同一次匹配流程只读一次）
 * 若无记录或解析失败则返回默认值
 */
let _cachedConfig: MatchConfig | null = null

export async function getMatchConfig(): Promise<MatchConfig> {
  if (_cachedConfig) return _cachedConfig

  try {
    const db = getDb()
    const res = await db.execute({
      sql: `SELECT value FROM settings WHERE key = ?`,
      args: [MATCH_CONFIG_KEY],
    })
    const row = res.rows[0] as any
    if (row?.value) {
      const parsed = JSON.parse(row.value)
      // 校验并填充缺失字段
      _cachedConfig = {
        threshold: typeof parsed.threshold === 'number' ? parsed.threshold : DEFAULT_CONFIG.threshold,
        softThreshold: typeof parsed.softThreshold === 'number' ? parsed.softThreshold : DEFAULT_CONFIG.softThreshold,
        probabilityMode: !!parsed.probabilityMode,
        baseProbability: typeof parsed.baseProbability === 'number' ? parsed.baseProbability : DEFAULT_CONFIG.baseProbability,
      }
      return _cachedConfig!
    }
  } catch { /* 解析失败用默认 */ }

  _cachedConfig = { ...DEFAULT_CONFIG }
  return _cachedConfig!
}

/** 清除缓存（管理员修改配置后调用） */
export function clearMatchConfigCache(): void {
  _cachedConfig = null
}

/** 保存匹配配置到 settings 表 */
export async function saveMatchConfig(config: Partial<MatchConfig>): Promise<MatchConfig> {
  const current = await getMatchConfig()
  const merged: MatchConfig = {
    ...current,
    ...config,
    // 防止非法值
    threshold: Math.max(0, Math.min(99, config.threshold ?? current.threshold)),
    softThreshold: Math.max(0, Math.min(99, config.softThreshold ?? current.softThreshold)),
    baseProbability: Math.max(0, Math.min(100, config.baseProbability ?? current.baseProbability)),
  }

  const db = getDb()
  await db.execute({
    sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
    args: [MATCH_CONFIG_KEY, JSON.stringify(merged)],
  })

  // 更新缓存
  _cachedConfig = merged
  return merged
}

/**
 * 判断一对配对是否通过门槛
 *
 * 规则：
 *   1. score >= threshold → 一定通过
 *   2. probabilityMode 开启 且 softThreshold <= score < threshold → 按概率掷骰子
 *   3. 其他 → 不通过
 */
function passesThreshold(score: number, config: MatchConfig): boolean {
  if (score >= config.threshold) return true
  if (config.probabilityMode && score >= config.softThreshold) {
    // 分数越高概率越大：softThreshold 处 = baseProbability%，threshold 处 = 100%
    const range = config.threshold - config.softThreshold || 1
    const ratio = (score - config.softThreshold) / range
    // 概率从 baseProbability% 线性增长到 100%
    const prob = config.baseProbability + (100 - config.baseProbability) * ratio
    // 密码学安全随机
    const rand = crypto.getRandomValues(new Uint8Array(1))[0] / 255
    return rand < prob / 100
  }
  return false
}

/** 所有学校名称（与 geo.ts + /api/match/preferences 保持一致） */
const ALL_SCHOOL_NAMES = [
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

// ─────────────────────────────────────────────
//  工具函数 — 答案索引查找
// ─────────────────────────────────────────────

/**
 * 答案索引映射表：模块级预构建，O(1) 查找
 *
 * 原实现每次调用都重建 Record<string, string[]> + indexOf 遍历（O(n)）
 * 匹配 50 人时 ansIdx 被调用数千次，总开销显著。
 * 改为模块加载时一次性构建 Map<题号, Map<答案文本, 索引>>，
 * 后续所有查询均为 O(1) 哈希查找。
 */
const ANSWER_INDEX_MAP = new Map<string, Map<string, number>>()

;(function buildAnswerIndexMap() {
  const rawData: Record<string, string[]> = {
    q1: ['会烦，但会先让自己稳住，再说明我现在不方便', '会直接表现出不耐烦，但事后能恢复正常', '很容易把火气撒到当时在场的人身上', '会记很久，之后态度也会变差'],
    q2: ['可以商量，但不是默认义务', '密码无所谓，定位长期共享没必要', '我希望彼此都保留独立隐私', '我想知道对方的，但不太想让对方知道我的'],
    q3: ['一着急就想马上说清楚', '先不说话，缓一缓再谈', '故意说重话，让对方也难受', '故意冷着对方，等TA先来低头'],
    q4: ['先把场面稳住，之后私下说朋友的问题', '先护住朋友情绪，但不会跟着一起攻击别人', '既然是我朋友，我肯定先一起对付外人', '赶紧躲开，别把麻烦沾到我身上'],
    q5: ['会觉得可怜，想办法给点吃的或求助', '有点想帮，但也会担心安全和卫生', '不敢接触，赶紧走开', '会拍个好玩的视频发给朋友吐槽一下'],
    q6: ['尊重，告诉TA需要我时找我', '会有点失落，但能理解', '会追问是不是我做错了什么', '会明显不高兴，觉得这就是在冷落我'],
    q7: ['不做，觉得没必要', '会犹豫，但大概率不想冒这个险', '如果大家都这么干，我也会', '能省事为什么不省，规则本来就是给人绕的'],
    q8: ['先攒钱，或者自己找额外收入', '找平替，等二手或降价', '分期先买了再说', '想办法让父母或对象给我买'],
    q9: ['从来不会，我一直很正能量', '偶尔会，但知道那只是情绪', '会，而且会在脑子里反复想', '只对真正伤害过我的人才会有'],
    q10: ['太重感情，总是付出太多', '有时脾气急，说话会快', '有时会先顾自己，后知后觉才意识到', '太理性，偶尔显得不够热'],
    q11: ['挺认真，希望系统别乱配', '当成有点意思的测试做做看', '先看看有没有好看的人', '我主要想看看这套东西到底准不准'],
    q12: ['存起来，给之后更重要的事', '买一直想买但确实用得上的东西', '立刻奖励自己或请朋友吃喝玩', '拿去试试高风险投资'],
    q13: ['立刻拿下，机会更重要', '还是按原计划，不买', '借钱/花呗也想先拿下', '先忍住，等二手或以后再说'],
    q14: ['先道歉，再想怎么补救', '先解释清楚不是故意的，再道歉', '先躲一下，等气氛过去', '只要不是故意的，就不用太上纲上线'],
    q15: ['按原计划学', '学完再去汇合', '立刻出门，朋友更重要', '试图把大家都拉到我的节奏里'],
    q16: ['情绪稳定，遇事不乱', '对未来有计划，愿意成长', '有趣松弛，跟TA在一起不累', '很懂我，能给我强烈的陪伴感'],
    q17: ['吵一点，但讲义气', '冷一点，但边界清楚、卫生好', '爱八卦，但肯分担家务', '乱一点，但情绪稳定、好说话'],
    q18: ['先等信息完整，再判断', '很容易共情弱者', '不太关心，跟我关系不大', '忍不住去跟评论区辩论'],
    q19: ['我在想未来，TA在混日子', '我在讲道理，TA只顾发脾气', '我愿意沟通，TA总在逃避', '我看重分寸，TA总觉得无所谓'],
    q20: ['关系里最重要的是稳定和可靠', '关系里最重要的是共同成长', '关系里最重要的是轻松和快乐', '关系里最重要的是浓烈和偏爱'],
    q21: ['合适的关系会让人自然变好', '可以调整习惯，但不能失去自己', '与其改造彼此，不如找更合适的人', '爱我就应该为我改变一些'],
    q22: ['先抱抱/陪着，让TA知道我在', '认真听TA说，陪TA骂两句也行', '帮TA分析问题，给方案', '给TA一点空间，等TA想说再说'],
    q23: ['很多碎片都想立刻分享', '每天固定聊一会儿就挺好', '没什么特别的事不用天天报备', '更喜欢攒到见面时说'],
    q24: ['我来做主安排', '对方安排，我负责配合和体验', '一起商量、分工', '随走随停，不想计划太细'],
    q25: ['想赶紧讲清楚，不想拖', '需要一点时间消化，再谈', '很想确认对方是不是还在乎我', '会忍不住争出个对错'],
    q26: ['我会主动找机会修复关系', '我希望给彼此一点时间，但不会故意拉长', '我通常等对方先来', '谁先低头谁就输了'],
    q27: ['高频沟通和及时回应', '说到做到、稳定靠谱', '行动照顾、生活上很落地', '尊重空间，但关键时候在场'],
    q28: ['主动察觉，来哄我', '问我需不需要聊', '先别打扰，等我整理好', '给我一个实际解决办法'],
    q29: ['规律型，白天有安排', '熬夜型，起得晚但有自己的节奏', '看心情，随机应变', '想规律但经常失败'],
    q30: ['很整洁，东西最好归位', '大致整洁就行', '乱一点也能接受', '真的很讨厌打扫，希望别人搞定'],
    q31: ['顺其自然，别算太死', '设共同预算会更安心', '比较偏向清楚AA', '我会期待一方明显多承担一些'],
    q32: ['比较外放，喜欢热闹和新鲜局', '有局会去，但也需要独处', '小圈子就够了，不爱太多社交', '很看对象，跟合拍的人才会打开'],
  }

  for (const [qId, answers] of Object.entries(rawData)) {
    const innerMap = new Map<string, number>()
    for (let i = 0; i < answers.length; i++) {
      innerMap.set(answers[i], i)
    }
    ANSWER_INDEX_MAP.set(qId, innerMap)
  }
})()

/** 获取答案的字母索引 A=0 B=1 C=2 D=3，找不到返回 -1 */
function ansIdx(qId: string, answer: string): number {
  return ANSWER_INDEX_MAP.get(qId)?.get(answer) ?? -1
}

// ─────────────────────────────────────────────
//  一、安全筛查算法（已导出，供 admin/users 复用）
// ─────────────────────────────────────────────

export function calcSafety(u: any): SafetyResult {
  let risk = 0
  let hardBlock = false

  const a1 = ansIdx('q1', u.q1), a2 = ansIdx('q2', u.q2), a3 = ansIdx('q3', u.q3)
  const a4 = ansIdx('q4', u.q4), a5 = ansIdx('q5', u.q5), a6 = ansIdx('q6', u.q6)
  const a7 = ansIdx('q7', u.q7), a8 = ansIdx('q8', u.q8)
  const a21 = ansIdx('q21', u.q21)

  // 严重红旗 +3
  if (a2 === 3) risk += 3
  if (a3 === 2) risk += 3
  if (a4 === 2) risk += 3
  if (a5 === 3) risk += 3
  if (a8 === 3) risk += 3
  if (a21 === 3) risk += 3

  // 中度红旗 +2
  if (a1 === 2) risk += 2
  if (a1 === 3) risk += 2
  if (a3 === 3) risk += 2
  if (a6 === 3) risk += 2
  if (a7 === 3) risk += 2

  // 轻度风险 +1
  if (a6 === 2) risk += 1
  if (a7 === 2) risk += 1
  if (a8 === 2) risk += 1

  // 组合封禁
  if ((a2 === 3) && (a21 === 3)) hardBlock = true
  if ((a1 >= 2) && (a3 === 2)) hardBlock = true
  if ((a3 === 3) && (ansIdx('q26', u.q26) === 3)) hardBlock = true
  if ((a4 === 2) && (a7 === 3)) hardBlock = true
  if ((a5 === 3) && (ansIdx('q14', u.q14) >= 2)) hardBlock = true

  let level: SafetyResult['level'] = 'normal'
  if (hardBlock || risk >= 6) level = 'blocked'
  else if (risk >= 3) level = 'restricted'

  return { level, riskScore: risk, hardBlock }
}

// ─────────────────────────────────────────────
//  二、真实性算法
// ─────────────────────────────────────────────

function calcTruth(u: any): number {
  let score = 1.0

  const a9 = ansIdx('q9', u.q9), a10 = ansIdx('q10', u.q10)
  const a11 = ansIdx('q11', u.q11), a12 = ansIdx('q12', u.q12)
  const a13 = ansIdx('q13', u.q13), a6 = ansIdx('q6', u.q6)
  const a26 = ansIdx('q26', u.q26), a14 = ansIdx('q14', u.q14)
  const a3 = ansIdx('q3', u.q3)

  // 过于完美减分
  if (a9 === 0) score -= 0.12
  if (a10 === 0) score -= 0.10
  if (a11 >= 1 && a11 <= 2) score -= 0.12

  // 交叉矛盾惩罚
  if (a12 === 0 && a13 === 0) score -= 0.18
  if (a6 === 0 && a26 === 3) score -= 0.12
  if (a14 === 0 && a3 === 2) score -= 0.08

  // Count actual "most socially desirable" answers
  const desirableA = [
    ansIdx('q1', u.q1) === 0,
    ansIdx('q4', u.q4) === 0,
    ansIdx('q5', u.q5) === 0,
    ansIdx('q6', u.q6) === 0,
    ansIdx('q8', u.q8) === 0,
    ansIdx('q12', u.q12) === 0,
    ansIdx('q14', u.q14) === 0,
    ansIdx('q15', u.q15) === 0,
    ansIdx('q16', u.q16) === 0,
    ansIdx('q22', u.q22) === 0,
    ansIdx('q27', u.q27) === 0,
    ansIdx('q29', u.q29) === 0,
    ansIdx('q30', u.q30) === 0,
  ].filter(Boolean).length

  if (desirableA >= 10) score -= 0.08
  if (desirableA >= 14) score -= 0.12

  return Math.max(0.55, Math.min(1.0, score))
}

// ─────────────────────────────────────────────
//  三、匹配算法 — 同频题距离计分
// ─────────────────────────────────────────────

function sameFreqScore(idxA: number, idxB: number): number {
  if (idxA < 0 || idxB < 0) return 50
  const d = Math.abs(idxA - idxB)
  if (d === 0) return 100
  if (d === 1) return 80
  if (d === 2) return 45
  return 10
}

// ─────────────────────────────────────────────
//  四、匹配算法 — 互补题矩阵计分
// ─────────────────────────────────────────────

function scoreQ22(a: number, b: number): number {
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 78, 1: 88, 2: 72, 3: 65 },
    '1': { 0: 88, 1: 75, 2: 70, 3: 68 },
    '2': { 0: 72, 1: 70, 2: 60, 3: 75 },
    '3': { 0: 65, 1: 68, 2: 75, 3: 58 },
  }
  return m[String(a)]?.[b] ?? 50
}

function scoreQ24(a: number, b: number): number {
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 40, 1: 100, 2: 78, 3: 35 },
    '1': { 0: 100, 1: 55, 2: 75, 3: 38 },
    '2': { 0: 78, 1: 75, 2: 92, 3: 72 },
    '3': { 0: 35, 1: 38, 2: 72, 3: 60 },
  }
  return m[String(a)]?.[b] ?? 50
}

function scoreQ25(a: number, b: number): number {
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 68, 1: 90, 2: 62, 3: 32 },
    '1': { 0: 90, 1: 85, 2: 70, 3: 38 },
    '2': { 0: 62, 1: 70, 2: 52, 3: 28 },
    '3': { 0: 32, 1: 38, 2: 28, 3: 20 },
  }
  return m[String(a)]?.[b] ?? 50
}

function scoreQ26(a: number, b: number): number {
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 92, 1: 96, 2: 72, 3: 0 },
    '1': { 0: 96, 1: 85, 2: 58, 3: 0 },
    '2': { 0: 72, 1: 58, 2: 18, 3: 0 },
    '3': { 0: 0,  1: 0,  2: 0,  3: 0 },
  }
  return m[String(a)]?.[b] ?? 0
}

function scoreQ28(a: number, b: number): number {
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 70, 1: 85, 2: 45, 3: 72 },
    '1': { 0: 85, 1: 80, 2: 55, 3: 82 },
    '2': { 0: 45, 1: 55, 2: 88, 3: 60 },
    '3': { 0: 72, 1: 82, 2: 60, 3: 76 },
  }
  return m[String(a)]?.[b] ?? 50
}

// ─────────────────────────────────────────────
//  五、完整匹配引擎
// ─────────────────────────────────────────────

export function calculateMatch(a: any, b: any): MatchResult {
  // 1. 安全筛查
  const safetyA = calcSafety(a)
  const safetyB = calcSafety(b)
  if (safetyA.level === 'blocked' || safetyB.level === 'blocked') {
    return { score: 0, dimScores: [], reasons: ['安全筛查未通过'], safetyLevel: 'blocked', truthScore: 0 }
  }

  // 2. 真实性计算
  const truthA = calcTruth(a)
  const truthB = calcTruth(b)

  // 3. 同频题评分
  let valueScores: number[] = []
  for (const q of ['q15','q16','q18','q19','q20']) {
    valueScores.push(sameFreqScore(ansIdx(q, a[q]), ansIdx(q, b[q])))
  }

  let interactionScores: number[] = []
  interactionScores.push(sameFreqScore(ansIdx('q23', a.q23), ansIdx('q23', b.q23)))
  interactionScores.push(sameFreqScore(ansIdx('q27', a.q27), ansIdx('q27', b.q27)))

  for (const cq of COMP_QUESTIONS) {
    interactionScores.push(cq.fn(ansIdx(cq.id, a[cq.id]), ansIdx(cq.id, b[cq.id])))
  }

  let dailyScores: number[] = []
  for (const q of ['q29','q30','q31','q32']) {
    dailyScores.push(sameFreqScore(ansIdx(q, a[q]), ansIdx(q, b[q])))
  }

  const avgValue = valueScores.length > 0 ? valueScores.reduce((s,v)=>s+v,0)/valueScores.length : 50
  const avgInteraction = interactionScores.length > 0 ? interactionScores.reduce((s,v)=>s+v,0)/interactionScores.length : 50
  const avgDaily = dailyScores.length > 0 ? dailyScores.reduce((s,v)=>s+v,0)/dailyScores.length : 50

  // 4. 灾难组合惩罚
  let disasterPenalty = 0
  const q26A = ansIdx('q26', a.q26), q26B = ansIdx('q26', b.q26)
  const q23A = ansIdx('q23', a.q23), q23B = ansIdx('q23', b.q23)
  const q24A = ansIdx('q24', a.q24), q24B = ansIdx('q24', b.q24)
  const q25A = ansIdx('q25', a.q25), q25B = ansIdx('q25', b.q25)

  if ((q26A >= 2 && q26B >= 2)) disasterPenalty += 25
  if ((q23A === 0 && q23B >= 2) || (q23B === 0 && q23A >= 2)) disasterPenalty += 10
  if ((q24A === 0 && q25B === 3) || (q24B === 0 && q25A === 3)) disasterPenalty += 12

  // 5. 加权总分（价值观35% + 互动冲突45% + 日常20%）
  const baseScore = avgValue * 0.35 + avgInteraction * 0.45 + avgDaily * 0.20

  // 6. 真实性和风险系数
  const confidenceFactor = Math.min(truthA, truthB)
  const riskFactor = (safetyA.level === 'restricted' || safetyB.level === 'restricted') ? 0.82 : 1.0

  let finalScore = (baseScore - disasterPenalty) * confidenceFactor * riskFactor
  finalScore = Math.max(0, Math.min(99, Math.round(finalScore)))

  // 7. 维度分数
  const dimScores = [
    { name: '价值观', score: Math.round(avgValue), compatible: avgValue >= 70 },
    { name: '互动模式', score: Math.round(avgInteraction), compatible: avgInteraction >= 70 },
    { name: '日常节奏', score: Math.round(avgDaily), compatible: avgDaily >= 70 },
  ]

  // 8. 匹配文案
  const reasons = generateReasons(a, b, finalScore, avgValue, avgInteraction, avgDaily, q26A, q26B, q24A, q24B, q23A, q23B)

  const worstSafety = safetyA.riskScore > safetyB.riskScore ? safetyA.level : safetyB.level
  const minTruth = Math.min(truthA, truthB)

  return { score: finalScore, dimScores, reasons, safetyLevel: worstSafety, truthScore: Math.round(minTruth * 100) / 100 }
}

// ─────────────────────────────────────────────
//  六、匹配文案生成器
// ─────────────────────────────────────────────

function generateReasons(
  a: any, b: any, finalScore: number,
  avgValue: number, avgInteraction: number, avgDaily: number,
  q26A: number, q26B: number, q24A: number, q24B: number,
  q23A: number, q23B: number
): string[] {
  const reasons: string[] = []

  // q26 争执处理方式：分析双方是否形成互补节奏
  const bothLowConflict = (q26A <= 1 && q26B <= 1)  // 都不是把关系当输赢
  const oneActiveOnePassive = (q26A !== q26B && ((q26A < 2 && q26B >= 2) || (q26B < 2 && q26A >= 2)))  // 一方主动一方等待

  if (bothLowConflict) {
    reasons.push('你们都不是把关系当成输赢的人。遇到问题时一方愿意主动修复，另一方也愿意接住，这种组合很容易把争执变成沟通。')
  } else if (oneActiveOnePassive) {
    reasons.push('在处理矛盾时，你们的节奏形成了一种自然的配合——一个更愿意先开口，另一个擅长冷静后再谈。')
  }

  if (avgDaily >= 75) {
    if (q23A >= 0 && q23B >= 0 && Math.abs(q23A - q23B) <= 1) {
      reasons.push('在日常生活里，你们对陪伴频率和生活节奏的期待也比较接近，不容易出现"我以为"和"你怎么又"的落差。')
    } else {
      reasons.push('你们在日常生活的节奏上有不错的默契。')
    }
  }

  if ((q24A === 0 && q24B === 1) || (q24B === 0 && q24A === 1)) {
    reasons.push('一个擅长安排规划，另一个愿意配合享受，这种搭配出门旅行会很顺畅。')
  } else if (q24A === 2 && q24B === 2) {
    reasons.push('你们都倾向于商量着来，这种成熟的相处方式不容易产生权力拉扯。')
  }

  if (avgValue >= 72) {
    const vMatches = ['q15','q16','q18','q19','q20'].filter(q => a[q] && b[q] && a[q] === b[q])
    if (vMatches.length >= 3) {
      reasons.push('你们在人生优先级和价值选择上高度一致，这是关系长期稳定的基石。')
    }
  }

  if (finalScore >= 86) {
    reasons.push('这是一组非常难得的匹配——不只是"聊得来"，而是真正有可能走得远的关系底色。')
  } else if (finalScore >= 76) {
    reasons.push('整体来看是值得认真了解的对象，建议多聊聊彼此的生活方式和处事节奏。')
  }

  return reasons.slice(0, 4)
}

// ─────────────────────────────────────────────
//  七、性别兼容检查
// ─────────────────────────────────────────────

export function genderCompatible(userA: any, userB: any): boolean {
  const aGender = userA.gender
  const bGender = userB.gender
  const aPref = userA.preferred_gender
  const bPref = userB.preferred_gender
  const aWantsB = aPref === 'all' || aPref === bGender
  const bWantsA = bPref === 'all' || bPref === aGender
  return aWantsB && bWantsA
}

// ─────────────────────────────────────────────
//  八、手动指定匹配（管理员配对）
// ─────────────────────────────────────────────

/**
 * 手动匹配返回值（纯数据对象，不含 NextResponse）
 * 调用方负责包装成 HTTP 响应
 */
export interface ManualMatchResult {
  success?: boolean
  error?: string
  status?: number
  existingMatchId?: number
  weekKey?: string
  manual?: boolean
  match?: {
    id?: number
    userA: number
    userAName: string
    userB: number
    userBName: string
    score: number
    dimScores: Array<{ name: string; score: number; compatible: boolean }>
    reasons: string[]
  }
}

export async function handleManualMatch(body: any): Promise<ManualMatchResult> {
  const db = getDb()
  const userAId = Number(body.userA)
  const userBId = Number(body.userB)
  const weekKey = body.weekKey ? dateToWeekKey(body.weekKey) : getAutoMatchWeekKey()

  if (!Number.isInteger(userAId) || !Number.isInteger(userBId) || userAId <= 0 || userBId <= 0) {
    return { error: '无效的用户ID', status: 400 }
  }
  if (userAId === userBId) {
    return { error: '不能匹配同一个人', status: 400 }
  }

  const [userARes, userBRes] = await Promise.all([
    db.execute({ sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender,
                    s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                    s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                    s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                    s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37
             FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id = ?`, args: [userAId] }),
    db.execute({ sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender,
                    s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                    s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                    s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                    s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37
             FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id = ?`, args: [userBId] }),
  ])

  const userA = userARes.rows[0] as any
  const userB = userBRes.rows[0] as any
  if (!userA || !userB) {
    return { error: `用户不存在 — A: ${!!userA}, B: ${!!userB}`, status: 404 }
  }

  const existingCheck = await db.execute({
    sql: `SELECT id FROM matches WHERE week_key = ? AND (user_a IN (?, ?) OR user_b IN (?, ?)) LIMIT 1`,
    args: [weekKey, userAId, userBId, userAId, userBId],
  })
  if (existingCheck.rows.length > 0) {
    return {
      error: `其中一方在本周(${weekKey})已有匹配记录，如需重新配对请先删除现有记录`,
      existingMatchId: Number(existingCheck.rows[0].id),
      status: 409,
    }
  }

  const result = calculateMatch(userA, userB)

  // 手动匹配：揭晓时间与自动匹配对齐（当周周日 北京时间 20:00 = UTC 周日 12:00）
  // 如果当周周日已过，则用下个周日
  function getRevealAt(): string {
    const now = new Date()
    const utcDay = now.getUTCDay()       // 0=Sun
    const utcHours = now.getUTCHours()
    const reveal = new Date(now)

    // 距离当本周日的天数（周日→0, 周六→1, ..., 周一→6）
    let daysUntilSun = (7 - utcDay) % 7
    // 如果已经是周日且已过 UTC 12:00（北京 20:00），则用下个周日
    if (utcDay === 0 && utcHours >= 12) {
      daysUntilSun = 7
    }
    reveal.setUTCDate(reveal.getUTCDate() + daysUntilSun)
    reveal.setUTCHours(12, 0, 0, 0)     // 北京时间 20:00
    return reveal.toISOString().replace('Z', '')   // SQLite 兼容格式
  }

  await db.execute({
    sql: `INSERT INTO matches (user_a, user_b, score, dim_scores, reasons, week_key, source, reveal_at)
          VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
    args: [userAId, userBId, result.score, JSON.stringify(result.dimScores), JSON.stringify(result.reasons), weekKey, getRevealAt()],
  })

  const insertRes = await db.execute({ sql: 'SELECT last_insert_rowid() as id', args: [] })
  const insertedId = Number((insertRes.rows[0] as any)?.id || 0)

  return {
    success: true,
    manual: true,
    weekKey,
    match: {
      id: insertedId,
      userA: userAId,
      userAName: userA.nickname,
      userB: userBId,
      userBName: userB.nickname,
      score: result.score,
      dimScores: result.dimScores,
      reasons: result.reasons,
    },
  }
}

// ─────────────────────────────────────────────
//  九、自动批量匹配（供 auto route 和 admin route 共用）
// ─────────────────────────────────────────────

/**
 * 执行自动批量匹配
 *
 * 流程：
 *   1. 查询本周所有已填问卷且开启匹配的用户（排除已有配对的）
 *   2. 安全筛查过滤掉 blocked 用户
 *   3. 贪心算法：每人选最优配对（≥76分），已配对的不重复
 *   4. 写入 matches 表
 *
 * 注意：此函数不做权限检查/锁机制，由调用方负责
 */
export async function executeAutoMatch(weekKey?: string): Promise<AutoMatchResult> {
  const db = getDb()
  const wk = weekKey || getWeekKey()

  // ── 读取匹配配置（阈值、概率模式等）──
  const matchConfig = await getMatchConfig()
  // 清除缓存，确保下次调用重新读取（防止跨批次使用过期缓存）
  clearMatchConfigCache()

  const usersResult = await db.execute({
    sql: `SELECT u.id, u.gender, u.preferred_gender, u.school, u.match_school_prefs,
                 u.safety_level as manual_safety_level,
                 s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                 s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                 s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                 s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37
          FROM users u
          JOIN survey_responses s ON u.id = s.user_id
          WHERE u.survey_completed = 1 AND u.match_enabled = 1
            AND u.id NOT IN (
              SELECT user_a FROM matches WHERE week_key = ?
              UNION
              SELECT user_b FROM matches WHERE week_key = ?
            )`,
    args: [wk, wk],
  })

  const users = usersResult.rows as any[]

  // 解析每个用户的匹配学校偏好（'all' → 全部学校）
  function parsePrefs(prefsRaw: string | null): Set<string> {
    if (!prefsRaw || prefsRaw === 'all') return new Set(ALL_SCHOOL_NAMES)
    try {
      return new Set(JSON.parse(prefsRaw))
    } catch {
      return new Set(ALL_SCHOOL_NAMES)
    }
  }

  const userSchoolPrefs = new Map<number, Set<string>>()
  for (const u of users) {
    userSchoolPrefs.set(Number(u.id), parsePrefs(u.match_school_prefs))
  }

  if (users.length < 2) {
    return {
      success: false, weekKey: wk,
      matchedPairs: 0, unmatchedUsers: users.length,
      totalEligible: users.length, safePoolSize: 0,
    }
  }

  const unmatchedDetails: UnmatchedDetail[] = []
  const safeUsers: Array<{ user: any; safety: SafetyResult; truth: number }> = []
  for (const u of users) {
    const nickname = String(u.nickname || '未知')
    const gender = u.gender || ''
    // 管理员手动 blocked 优先排除，不参与匹配
    if (u.manual_safety_level === 'blocked') {
      unmatchedDetails.push({ nickname, gender, reason: '管理员手动封禁' })
      continue
    }
    const safety = calcSafety(u)
    const truth = calcTruth(u)
    if (safety.level === 'blocked') {
      unmatchedDetails.push({ nickname, gender, reason: `安全筛查未通过（风险分${safety.riskScore}）` })
      continue
    }
    safeUsers.push({ user: u, safety, truth })
  }

  if (safeUsers.length < 2) {
    // 所有通过安全筛查的用户都标记为"候选人不足"
    for (const su of safeUsers) {
      unmatchedDetails.push({
        nickname: String(su.user.nickname || '未知'),
        gender: su.user.gender || '',
        reason: '通过安全筛查的候选人不足',
      })
    }
    return {
      success: false, weekKey: wk,
      matchedPairs: 0, unmatchedUsers: users.length,
      totalEligible: users.length, safePoolSize: safeUsers.length,
      unmatchedDetails,
    }
  }

  const matches: any[] = []
  const matchedDetails: MatchedPairDetail[] = []
  const matched = new Set<number>()
  // 记录每个用户在匹配尝试中的最佳分数和原因
  const attemptInfo = new Map<number, { bestScore: number; hasGenderCompatible: boolean }>()
  // Fisher-Yates 洗牌（密码学安全随机）
  const shuffled = [...safeUsers]
  const randomBytes = new Uint32Array(shuffled.length)
  crypto.getRandomValues(randomBytes)
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomBytes[i] % (i + 1)
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // ── 批量收集匹配结果，最后用 db.batch() 一次写入（减少网络往返）──
  const insertStatements: Array<{ sql: string; args: any[] }> = []

  for (let i = 0; i < shuffled.length; i++) {
    if (matched.has(Number(shuffled[i].user.id))) continue

    let bestMatch: typeof shuffled[0] | null = null
    let bestScore = 0
    let bestResult: MatchResult | null = null
    let hasGenderCompatible = false

    for (let j = i + 1; j < shuffled.length; j++) {
      if (matched.has(Number(shuffled[j].user.id))) continue
      if (!genderCompatible(shuffled[i].user, shuffled[j].user)) continue
      hasGenderCompatible = true

      // ── 学校偏好过滤：双向匹配（A的偏好包含B的学校，B的偏好包含A的学校）──
      const idA = Number(shuffled[i].user.id)
      const idB = Number(shuffled[j].user.id)
      const prefsA = userSchoolPrefs.get(idA)
      const prefsB = userSchoolPrefs.get(idB)
      const schoolA = (shuffled[i].user.school as string) || ''
      const schoolB = (shuffled[j].user.school) as string || ''
      // 学校偏好过滤：双方都有学校信息时才过滤；任一方无信息则跳过（放行给其他条件决定）
      if (schoolA && schoolB && prefsA && prefsB) {
        if (!prefsA.has(schoolB) || !prefsB.has(schoolA)) continue
      }

      const result = calculateMatch(shuffled[i].user, shuffled[j].user)
      if (result.score > bestScore) {
        bestScore = result.score
        bestMatch = shuffled[j]
        bestResult = result
      }
    }

    // 记录尝试信息（无论是否成功匹配）
    const curId = Number(shuffled[i].user.id)
    const existing = attemptInfo.get(curId)
    if (!existing || bestScore > existing.bestScore) {
      attemptInfo.set(curId, { bestScore, hasGenderCompatible })
    }
    if (bestMatch) {
      const partnerId = Number(bestMatch.user.id)
      const partnerExisting = attemptInfo.get(partnerId)
      if (!partnerExisting || bestScore > partnerExisting.bestScore) {
        attemptInfo.set(partnerId, { bestScore, hasGenderCompatible: true })
      }
    }

    if (bestMatch && bestResult && passesThreshold(bestScore, matchConfig)) {
      insertStatements.push({
        sql: `INSERT INTO matches (user_a, user_b, score, dim_scores, reasons, week_key)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          Number(shuffled[i].user.id),
          Number(bestMatch.user.id),
          bestScore,
          JSON.stringify(bestResult.dimScores),
          JSON.stringify(bestResult.reasons),
          wk,
        ],
      })
      matched.add(Number(shuffled[i].user.id))
      matched.add(Number(bestMatch.user.id))
      matches.push({ score: bestScore })
      matchedDetails.push({
        userA: String(shuffled[i].user.nickname || '未知'),
        userB: String(bestMatch.user.nickname || '未知'),
        score: bestScore,
      })
    }
  }

  // 收集未匹配用户的原因（通过安全筛查但未成功匹配的）
  for (const su of shuffled) {
    if (matched.has(Number(su.user.id))) continue
    const info = attemptInfo.get(Number(su.user.id))
    let reason: string
    if (!info || !info.hasGenderCompatible) {
      reason = '无性别兼容的候选人'
    } else if (info.bestScore < matchConfig.softThreshold) {
      reason = `最高匹配分${info.bestScore}分，低于最低阈值${matchConfig.softThreshold}分`
    } else {
      reason = `最高匹配分${info.bestScore}分，未达阈值${matchConfig.threshold}分`
    }
    unmatchedDetails.push({
      nickname: String(su.user.nickname || '未知'),
      gender: su.user.gender || '',
      reason,
    })
  }

  // 用 db.batch() 一次性提交所有匹配结果
  if (insertStatements.length > 0) {
    try {
      await db.batch(insertStatements)
    } catch {
      // batch 失败时回退到逐条插入（兼容不支持 batch 的客户端）
      for (const stmt of insertStatements) {
        try { await db.execute(stmt) } catch (_) { /* 单条失败不影响其他 */ }
      }
    }
  }

  return {
    success: true,
    weekKey: wk,
    matchedPairs: matches.length,
    unmatchedUsers: shuffled.length - matched.size,
    totalEligible: users.length,
    safePoolSize: safeUsers.length,
    matchedDetails,
    unmatchedDetails,
  }
}
