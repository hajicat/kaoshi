// src/lib/match-engine-v2.ts
// V2 匹配引擎：五维度评分 + 最大覆盖最大权重匹配
// 与 V1 match-engine.ts 完全独立，互不影响

import { getDb } from './db'
import { getWeekKey, getAutoMatchWeekKey, dateToWeekKey } from './week'

// ─────────────────────────────────────────────
//  类型定义
// ─────────────────────────────────────────────

export interface V2User {
  id: number
  nickname?: string
  gender: string
  preferred_gender: string
  school?: string
  match_school_prefs?: string
  match_enabled?: number
  manual_safety_level?: string
  unmatchedRounds?: number
  [key: string]: any  // q1-q58 动态访问
}

export interface V2SafetyResult {
  level: 'blocked' | 'restricted' | 'normal'
  riskScore: number
  hardBlock: boolean
}

export interface V2DimensionScore {
  name: string
  score: number
  weight: number
  compatible: boolean
}

export interface V2MatchResult {
  score: number
  dimScores: V2DimensionScore[]
  reasons: string[]
  tier: 'strong' | 'normal' | 'backup' | 'none'
  contactQuality: number
  safetyLevel: string
  truthScore: number
}

export interface V2MatchConfig {
  valuesWeight: number
  interactionWeight: number
  dailyWeight: number
  chatWeight: number
  icebreakWeight: number
  strongThreshold: number
  normalThreshold: number
  backupThreshold: number
}

const DEFAULT_V2_CONFIG: V2MatchConfig = {
  valuesWeight: 0.25,
  interactionWeight: 0.30,
  dailyWeight: 0.15,
  chatWeight: 0.20,
  icebreakWeight: 0.10,
  strongThreshold: 76,
  normalThreshold: 68,
  backupThreshold: 60,
}

const MATCH_CONFIG_V2_KEY = 'match_config_v2'

// ─────────────────────────────────────────────
//  答案索引映射（同 V1 模式，文本→编号）
// ─────────────────────────────────────────────

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
    // q33-q35 个人画像（多选/文本，不进算法）
    // q36 破冰适配（多选，单独处理）
    q37: ['我比较喜欢主动开启话题', '我希望对方多主动一点，我会慢慢接上', '都可以，只要聊天自然就好', '我比较慢热，希望对方不要太急', '我不太擅长开启话题，但愿意认真回应'],
    // H 模块
    q38: ['当天就加，认真开个头', '有空时会加，一般不会拖太久', '会犹豫一下，可能等对方先加', '不一定会加，看当时心情'],
    q39: ['根据对方资料或问卷，发一个具体问题', '先简单打招呼，再慢慢找话题', '发"你好/在吗"，然后看对方怎么回', '我经常不知道怎么开口'],
    q40: ['谁先看到谁先说，不用计较', '主动添加的人应该先说', '我希望对方先说，但我会认真回应', '我基本不主动，除非特别感兴趣'],
    q41: ['找共同点，先问一个具体问题', '会有点尴尬，但还是会努力聊', '等对方带话题', '干脆先不聊，免得尴尬'],
    q42: ['换个更具体的话题试试', '再回一两句，看对方反应', '觉得对方没兴趣，就不太想聊了', '我也不知道怎么接，只能冷掉'],
    q43: ['主动换话题，或者接之前的线索', '坦白说"我有点卡壳，但还想继续聊"', '等对方重新找话题', '冷了就算了，说明不合适'],
    // q44 多选（话题），q45 多选（雷区）— 单独处理
    q46: ['认真接住，并补充一点自己的事', '有兴趣就多回几句', '礼貌回复，但不太会延展', '很容易回着回着消失'],
    q47: ['注意细节，具体夸一句或问一个问题', '简单夸一句或发表情包', '回"不错""哈哈"', '不知道怎么接'],
    q48: ['每天都能聊几轮', '每天聊一会儿就好', '有事再聊，不需要天天聊', '我比较随缘，回不回看状态'],
    q49: ['看到一般会尽快回', '忙完会回，不太故意拖', '经常隔很久才回', '经常忘回或懒得回'],
    q50: ['愿意，我会努力让对方舒服一点', '愿意，但希望对方也多带带我', '看对象，特别喜欢才会努力', '不太想改，合适的人自然能聊'],
    q51: ['认真了解对方，看看能不能发展', '先认识朋友，合适再进一步', '看看对方长什么样、有不有趣', '只是随便玩玩，不一定会投入'],
    q52: ['可能对方也尴尬，我可以先开口', '会有点失落，但还能理解', '觉得对方是不是没兴趣', '那我也不找，谁先主动谁输'],
    q53: ['问问题，引导对方多说', '分享自己的日常和想法', '玩梗、吐槽、轻松聊天', '认真讨论观点和计划'],
    q54: ['多问我一些具体问题', '多分享TA自己的生活', '轻松一点，不要太正式', '能聊深一点，不要太浅'],
    q55: ['聊得来，一两天内可以', '聊几天，感觉自然再说', '先线上熟一点再考虑', '刚开始不太想线下'],
    q56: ['如果聊得不错，可以考虑', '会希望先多聊几天', '会有压力，但可以解释', '会明显反感'],
    q57: ['可以，我愿意慢慢磨合', '可以，但对方至少要有回应', '比较难，我会很快没兴趣', '不太能接受，聊天感很重要'],
    // q58 开放文本，不进算法
  }

  for (const [qId, answers] of Object.entries(rawData)) {
    const innerMap = new Map<string, number>()
    for (let i = 0; i < answers.length; i++) {
      innerMap.set(answers[i], i)
    }
    ANSWER_INDEX_MAP.set(qId, innerMap)
  }
})()

function ansIdx(qId: string, answer: string): number {
  return ANSWER_INDEX_MAP.get(qId)?.get(answer) ?? -1
}

// ─────────────────────────────────────────────
//  工具函数
// ─────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 50
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

/** 解析 q36 多选标签 JSON 数组 */
function parseQ36Tags(raw: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 解析 q44/q45 多选话题 JSON 数组 */
function parseMultiSelect(raw: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 选项分数映射（A=100, B=80, C=45, D=20） */
function optionScore4(idx: number): number {
  if (idx === 0) return 100
  if (idx === 1) return 80
  if (idx === 2) return 45
  if (idx === 3) return 20
  return 50
}

/** 行动意愿分数映射（A=100, B=80, C=50, D=15） */
function intentScore4(idx: number): number {
  if (idx === 0) return 100
  if (idx === 1) return 80
  if (idx === 2) return 50
  if (idx === 3) return 15
  return 50
}

// ─────────────────────────────────────────────
//  同频评分（与 V1 相同）
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
//  互补矩阵评分（V2 使用 README 中的矩阵）
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

/** q37 破冰节奏矩阵 */
function scoreQ37(a: number, b: number): number {
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 82, 1: 96, 2: 90, 3: 78, 4: 94 },
    '1': { 0: 96, 1: 60, 2: 82, 3: 68, 4: 52 },
    '2': { 0: 90, 1: 82, 2: 88, 3: 82, 4: 82 },
    '3': { 0: 78, 1: 68, 2: 82, 3: 85, 4: 76 },
    '4': { 0: 94, 1: 52, 2: 82, 3: 76, 4: 45 },
  }
  return m[String(a)]?.[b] ?? 70
}

/** q39 开场互补矩阵 */
function scoreQ39(a: number, b: number): number {
  const m: Record<string, Record<number, number>> = {
    '0': { 0: 86, 1: 92, 2: 95, 3: 82 },
    '1': { 0: 92, 1: 82, 2: 84, 3: 70 },
    '2': { 0: 95, 1: 84, 2: 42, 3: 25 },
    '3': { 0: 82, 1: 70, 2: 25, 3: 15 },
  }
  return m[String(a)]?.[b] ?? 50
}

// ─────────────────────────────────────────────
//  一、V2 安全筛查
// ─────────────────────────────────────────────

export function calcSafetyV2(u: V2User): V2SafetyResult {
  let risk = 0
  let hardBlock = false

  const a1 = ansIdx('q1', u.q1), a2 = ansIdx('q2', u.q2), a3 = ansIdx('q3', u.q3)
  const a4 = ansIdx('q4', u.q4), a5 = ansIdx('q5', u.q5), a6 = ansIdx('q6', u.q6)
  const a7 = ansIdx('q7', u.q7), a8 = ansIdx('q8', u.q8), a14 = ansIdx('q14', u.q14)
  const a21 = ansIdx('q21', u.q21), a26 = ansIdx('q26', u.q26)
  const a49 = ansIdx('q49', u.q49), a51 = ansIdx('q51', u.q51), a52 = ansIdx('q52', u.q52)

  // 严重红旗 +3
  if (a2 === 3) risk += 3
  if (a3 === 2) risk += 3
  if (a4 === 2) risk += 3
  if (a5 === 3) risk += 3
  if (a21 === 3) risk += 3

  // 中度红旗 +2
  if (a1 === 2 || a1 === 3) risk += 2
  if (a3 === 3) risk += 2
  if (a6 === 3) risk += 2
  if (a7 === 3) risk += 2
  if (a8 === 3) risk += 2   // v2: q8D 不再是严重红旗，改为中度
  if (a14 === 3) risk += 2
  if (a52 === 3) risk += 2

  // 轻度风险 +1
  if (a6 === 2) risk += 1
  if (a7 === 2) risk += 1
  if (a8 === 2) risk += 1
  if (a14 === 2) risk += 1
  if (a49 === 3) risk += 1
  if (a51 === 3) risk += 1

  // 硬封禁组合
  if (a2 === 3 && a21 === 3) hardBlock = true
  if ((a1 === 2 || a1 === 3) && a3 === 2) hardBlock = true
  if (a3 === 3 && a26 === 3) hardBlock = true
  if (a4 === 2 && a7 === 3) hardBlock = true
  if (a5 === 3 && a14 >= 2) hardBlock = true

  let level: V2SafetyResult['level'] = 'normal'
  if (hardBlock || risk >= 7) level = 'blocked'
  else if (risk >= 4) level = 'restricted'

  return { level, riskScore: risk, hardBlock }
}

/** V2 风险系数：restricted 0.92（V1 是 0.82） */
function getRiskCoeffV2(levelA: string, levelB: string): number {
  if (levelA === 'blocked' || levelB === 'blocked') return 0
  if (levelA === 'restricted' || levelB === 'restricted') return 0.92
  return 1.0
}

// ─────────────────────────────────────────────
//  二、V2 真实性算法
// ─────────────────────────────────────────────

export function calcTruthV2(u: V2User): number {
  let truth = 1.0

  const a9 = ansIdx('q9', u.q9)
  const a10 = ansIdx('q10', u.q10)
  const a11 = ansIdx('q11', u.q11)
  const a12 = ansIdx('q12', u.q12)
  const a13 = ansIdx('q13', u.q13)
  const a6 = ansIdx('q6', u.q6)
  const a26 = ansIdx('q26', u.q26)
  const a14 = ansIdx('q14', u.q14)
  const a3 = ansIdx('q3', u.q3)

  if (a9 === 0) truth -= 0.08

  if (a10 === 0 || a10 === 3) truth -= 0.07

  // v2: q11B 不扣分，q11C 轻微扣
  if (a11 === 2) truth -= 0.06

  if (a12 === 0 && a13 === 0) truth -= 0.12

  if (a6 === 0 && a26 === 3) truth -= 0.10

  if (a14 === 0 && a3 === 2) truth -= 0.08

  // 统计社交期望 A 选项数
  const socialAKeys = ['q1','q4','q5','q6','q8','q12','q14','q15','q16','q22','q27','q29','q30']
  let socialAcount = 0
  for (const q of socialAKeys) {
    if (ansIdx(q, u[q]) === 0) socialAcount++
  }
  if (socialAcount >= 11) truth -= 0.05
  if (socialAcount === 13) truth -= 0.08

  return clamp(truth, 0.70, 1.00)
}

function calcTruthPairV2(a: V2User, b: V2User): number {
  const minTruth = Math.min(calcTruthV2(a), calcTruthV2(b))
  return 0.85 + 0.15 * minTruth
}

// ─────────────────────────────────────────────
//  三、五维度评分
// ─────────────────────────────────────────────

/** 价值观维度：q15 q16 q18 q19 q20 */
function calcValueScore(a: V2User, b: V2User): number {
  return avg([
    sameFreqScore(ansIdx('q15', a.q15), ansIdx('q15', b.q15)),
    sameFreqScore(ansIdx('q16', a.q16), ansIdx('q16', b.q16)),
    sameFreqScore(ansIdx('q18', a.q18), ansIdx('q18', b.q18)),
    sameFreqScore(ansIdx('q19', a.q19), ansIdx('q19', b.q19)),
    sameFreqScore(ansIdx('q20', a.q20), ansIdx('q20', b.q20)),
  ])
}

/** 互动模式维度：q22 q23 q24 q25 q26 q27 q28 */
function calcInteractionScore(a: V2User, b: V2User): number {
  return avg([
    scoreQ22(ansIdx('q22', a.q22), ansIdx('q22', b.q22)),
    sameFreqScore(ansIdx('q23', a.q23), ansIdx('q23', b.q23)),
    scoreQ24(ansIdx('q24', a.q24), ansIdx('q24', b.q24)),
    scoreQ25(ansIdx('q25', a.q25), ansIdx('q25', b.q25)),
    scoreQ26(ansIdx('q26', a.q26), ansIdx('q26', b.q26)),
    sameFreqScore(ansIdx('q27', a.q27), ansIdx('q27', b.q27)),
    scoreQ28(ansIdx('q28', a.q28), ansIdx('q28', b.q28)),
  ])
}

/** 日常节奏维度：q29 q30 q31 q32 */
function calcDailyScore(a: V2User, b: V2User): number {
  return avg([
    sameFreqScore(ansIdx('q29', a.q29), ansIdx('q29', b.q29)),
    sameFreqScore(ansIdx('q30', a.q30), ansIdx('q30', b.q30)),
    sameFreqScore(ansIdx('q31', a.q31), ansIdx('q31', b.q31)),
    sameFreqScore(ansIdx('q32', a.q32), ansIdx('q32', b.q32)),
  ])
}

// ─────────────────────────────────────────────
//  四、聊天能力维度（全新）
// ─────────────────────────────────────────────

/** 单人聊天能力：q39 q41 q42 q43 q46 q47 q49 q50 */
function calcChatAbility(u: V2User): number {
  return avg([
    optionScore4(ansIdx('q39', u.q39)),
    optionScore4(ansIdx('q41', u.q41)),
    optionScore4(ansIdx('q42', u.q42)),
    optionScore4(ansIdx('q43', u.q43)),
    optionScore4(ansIdx('q46', u.q46)),
    optionScore4(ansIdx('q47', u.q47)),
    optionScore4(ansIdx('q49', u.q49)),
    optionScore4(ansIdx('q50', u.q50)),
  ])
}

/** 联系方式行动意愿：q38 q40 q51 */
function calcContactIntent(u: V2User): number {
  return (
    intentScore4(ansIdx('q38', u.q38)) * 0.45 +
    intentScore4(ansIdx('q40', u.q40)) * 0.25 +
    intentScore4(ansIdx('q51', u.q51)) * 0.30
  )
}

/** 共同话题得分：q44 */
function calcTopicScore(a: V2User, b: V2User): number {
  const setA = parseMultiSelect(a.q44)
  const setB = parseMultiSelect(b.q44)
  if (setA.length === 0 && setB.length === 0) return 50

  const setACopy = new Set(setA)
  const intersection = setB.filter(x => setACopy.has(x))
  const unionSize = new Set(setA.concat(setB)).size
  if (unionSize === 0) return 50

  return clamp((intersection.length / unionSize) * 100, 40, 100)
}

/** 聊天方式互补：q53 q54 */
function styleFit(skill: number, need: number): number {
  if (skill < 0 || need < 0) return 70
  if (skill === need) return 100
  // 氛围型(2) vs 深聊型(3) 冲突
  if ((skill === 2 && need === 3) || (skill === 3 && need === 2)) return 45
  return 70
}

function calcStyleScore(a: V2User, b: V2User): number {
  return avg([
    styleFit(ansIdx('q53', a.q53), ansIdx('q54', b.q54)),
    styleFit(ansIdx('q53', b.q53), ansIdx('q54', a.q54)),
  ])
}

/** 聊天雷区惩罚 */
function calcTabooPenalty(a: V2User, b: V2User): number {
  let penalty = 0
  const tabooA = parseMultiSelect(a.q45)
  const tabooB = parseMultiSelect(b.q45)

  // A 讨厌太快约线下，B q55A
  if (tabooA.includes('太快约线下') && ansIdx('q55', b.q55) === 0) penalty += 8
  if (tabooB.includes('太快约线下') && ansIdx('q55', a.q55) === 0) penalty += 8

  // A 讨厌频繁要照片，B q51C
  if (tabooA.includes('频繁要照片') && ansIdx('q51', b.q51) === 2) penalty += 8
  if (tabooB.includes('频繁要照片') && ansIdx('q51', a.q51) === 2) penalty += 8

  // A 讨厌查户口式提问，B 是提问型且具体开场
  if (tabooA.includes('查户口式提问') && ansIdx('q53', b.q53) === 0 && ansIdx('q39', b.q39) === 0) penalty += 6
  if (tabooB.includes('查户口式提问') && ansIdx('q53', a.q53) === 0 && ansIdx('q39', a.q39) === 0) penalty += 6

  // A 讨厌严肃面试，B 深聊型
  if (tabooA.includes('人生说教') && ansIdx('q53', b.q53) === 3) penalty += 6
  if (tabooB.includes('人生说教') && ansIdx('q53', a.q53) === 3) penalty += 6

  // A 讨厌玩梗太多，B 氛围型
  if (tabooA.includes('黄段子或擦边') && ansIdx('q53', b.q53) === 2) penalty += 6
  if (tabooB.includes('黄段子或擦边') && ansIdx('q53', a.q53) === 2) penalty += 6

  // q58 开放文本关键词检测（比行为匹配惩罚更轻）
  const tabooTextRules: [string, RegExp][] = [
    ['黄段子或擦边', /骚|约炮|屁股|污|暧昧/],
    ['频繁要照片', /照片|自拍|发图|看看你|长什么样/],
    ['太快约线下', /见面|约出来|线下|出来玩|出去玩|面基/],
    ['前任', /前任|前男友|前女友|ex|前对象/],
    ['查户口式提问', /家里|父母|收入|工资|房子|车|存款/],
  ]
  const q58a = String(a.q58 || '').toLowerCase()
  const q58b = String(b.q58 || '').toLowerCase()
  if (q58b) {
    for (const [taboo, regex] of tabooTextRules) {
      if (tabooA.includes(taboo) && regex.test(q58b)) penalty += 4
    }
  }
  if (q58a) {
    for (const [taboo, regex] of tabooTextRules) {
      if (tabooB.includes(taboo) && regex.test(q58a)) penalty += 4
    }
  }

  return penalty
}

/** 聊天能力总分 */
function calcChatScore(a: V2User, b: V2User): number {
  const initiativeScore = scoreQ39(ansIdx('q39', a.q39), ansIdx('q39', b.q39))

  const abilityScore = avg([calcChatAbility(a), calcChatAbility(b)])
  const intentScore = avg([calcContactIntent(a), calcContactIntent(b)])
  const freqScore = sameFreqScore(ansIdx('q48', a.q48), ansIdx('q48', b.q48))
  const replySpeedScore = sameFreqScore(ansIdx('q49', a.q49), ansIdx('q49', b.q49))
  const topicScore = calcTopicScore(a, b)
  const styleScore = calcStyleScore(a, b)
  const tabooPenalty = calcTabooPenalty(a, b)

  const score =
    initiativeScore * 0.20 +
    abilityScore * 0.20 +
    intentScore * 0.15 +
    freqScore * 0.10 +
    replySpeedScore * 0.10 +
    topicScore * 0.15 +
    styleScore * 0.10 -
    tabooPenalty

  return clamp(score, 0, 100)
}

// ─────────────────────────────────────────────
//  五、破冰适配维度（全新计分）
// ─────────────────────────────────────────────

/** 不自在点惩罚（双向） */
function calcDiscomfortPenalty(hater: V2User, actor: V2User): number {
  const tags = parseQ36Tags(hater.q36)
  let penalty = 0

  for (const tag of tags) {
    if (tag === 'hate_interview') {
      // A 讨厌查户口，B 是提问型且具体开场
      if (ansIdx('q53', actor.q53) === 0 && ansIdx('q39', actor.q39) === 0) penalty += 6
    }
    if (tag === 'hate_too_intense') {
      // A 讨厌太热情，B 高频或即时回复
      if (ansIdx('q48', actor.q48) === 0 || ansIdx('q49', actor.q49) === 0) penalty += 8
    }
    if (tag === 'hate_too_cold') {
      // A 讨厌太冷，B 弱开场或慢回复
      if (ansIdx('q39', actor.q39) >= 2 || ansIdx('q49', actor.q49) >= 2) penalty += 10
    }
    if (tag === 'hate_photo_appearance') {
      // A 讨厌要照片，B q51C
      if (ansIdx('q51', actor.q51) === 2) penalty += 10
    }
    if (tag === 'hate_fast_meet') {
      // A 讨厌太快约线下，B q55A
      if (ansIdx('q55', actor.q55) === 0) penalty += 10
    }
    if (tag === 'hate_formal_talk') {
      // A 讨厌严肃面试，B 深聊型
      if (ansIdx('q53', actor.q53) === 3) penalty += 6
    }
    if (tag === 'hate_too_meme') {
      // A 讨厌玩梗太多，B 氛围型
      if (ansIdx('q53', actor.q53) === 2) penalty += 6
    }
    if (tag === 'hate_carrying') {
      // A 讨厌一直自己找话题，B 接话弱
      if (calcChatAbility(actor) < 55) penalty += 12
    }
    if (tag === 'hate_fast_flirt') {
      // A 讨厌太快暧昧，B q51C/D
      if (ansIdx('q51', actor.q51) >= 2) penalty += 8
    }
  }

  // A q56D 且 B q55A 额外惩罚
  if (ansIdx('q56', hater.q56) === 3 && ansIdx('q55', actor.q55) === 0) penalty += 5

  return penalty
}

/** 开场兼容性 */
function calcOpenerCompatibility(a: V2User, b: V2User): number {
  const qa = ansIdx('q37', a.q37), qb = ansIdx('q37', b.q37)

  // 主动型 + 被动型 = 互补
  if ((qa === 0 && [1, 3, 4].includes(qb)) || (qb === 0 && [1, 3, 4].includes(qa))) return 95

  // 都可以型 + 都可以型
  if (qa === 2 && qb === 2) return 88

  // 双方都不主动
  if ([1, 4].includes(qa) && [1, 4].includes(qb)) return 50

  // 双方都不会开头且聊天能力都低
  if (qa === 4 && qb === 4 && calcChatAbility(a) < 60 && calcChatAbility(b) < 60) return 35

  return 75
}

/** 破冰适配总分 */
function calcIceBreakScore(a: V2User, b: V2User): number {
  const qa = ansIdx('q37', a.q37), qb = ansIdx('q37', b.q37)

  let q37PaceScore = 70
  if (qa >= 0 && qa <= 4 && qb >= 0 && qb <= 4) {
    q37PaceScore = scoreQ37(qa, qb)
  }

  const discomfortPenalty = calcDiscomfortPenalty(a, b) + calcDiscomfortPenalty(b, a)
  const discomfortFitScore = clamp(100 - discomfortPenalty, 40, 100)
  const openerCompatibilityScore = calcOpenerCompatibility(a, b)

  let score =
    q37PaceScore * 0.45 +
    discomfortFitScore * 0.40 +
    openerCompatibilityScore * 0.15

  // 双方都不主动时上限 58
  if ([1, 4].includes(qa) && [1, 4].includes(qb)) {
    score = Math.min(score, 58)
  }

  return clamp(score, 0, 100)
}

// ─────────────────────────────────────────────
//  六、灾难组合惩罚
// ─────────────────────────────────────────────

function calcTotalPenalty(a: V2User, b: V2User): number {
  let penalty = 0

  const q26A = ansIdx('q26', a.q26), q26B = ansIdx('q26', b.q26)
  const q23A = ansIdx('q23', a.q23), q23B = ansIdx('q23', b.q23)
  const q24A = ansIdx('q24', a.q24), q25B = ansIdx('q25', b.q25)
  const q25A = ansIdx('q25', a.q25), q24B = ansIdx('q24', b.q24)
  const q39A = ansIdx('q39', a.q39), q39B = ansIdx('q39', b.q39)
  const q38A = ansIdx('q38', a.q38), q38B = ansIdx('q38', b.q38)
  const q48A = ansIdx('q48', a.q48), q49B = ansIdx('q49', b.q49)
  const q49A = ansIdx('q49', a.q49), q48B = ansIdx('q48', b.q48)
  const q52A = ansIdx('q52', a.q52), q52B = ansIdx('q52', b.q52)
  const q55A = ansIdx('q55', a.q55), q56B = ansIdx('q56', b.q56)
  const q56A = ansIdx('q56', a.q56), q55B = ansIdx('q55', b.q55)
  const q51A = ansIdx('q51', a.q51), q51B = ansIdx('q51', b.q51)
  const q37A = ansIdx('q37', a.q37), q37B = ansIdx('q37', b.q37)

  // 关系灾难
  if (q26A === 3 && q26B === 3) penalty += 25
  if ((q23A === 0 && [2, 3].includes(q23B)) || (q23B === 0 && [2, 3].includes(q23A))) penalty += 10
  if ((q24A === 0 && q25B === 3) || (q24B === 0 && q25A === 3)) penalty += 12

  // 聊天灾难
  if ([2, 3].includes(q39A) && [2, 3].includes(q39B)) penalty += 10
  if ([2, 3].includes(q38A) && [2, 3].includes(q38B)) penalty += 8
  if ((q48A === 0 && q49B === 3) || (q48B === 0 && q49A === 3)) penalty += 10
  if (q52A === 3 && q52B === 3) penalty += 18
  if ((q55A === 0 && q56B === 3) || (q55B === 0 && q56A === 3)) penalty += 10
  if (q51A === 3 || q51B === 3) penalty += 8

  // 破冰灾难
  if ([1, 4].includes(q37A) && [1, 4].includes(q37B)) penalty += 8

  const tagsA = parseQ36Tags(a.q36)
  const tagsB = parseQ36Tags(b.q36)

  if (tagsA.includes('hate_carrying') && calcChatAbility(b) < 55) penalty += 10
  if (tagsB.includes('hate_carrying') && calcChatAbility(a) < 55) penalty += 10

  if ((q37A === 3 && q55B === 0) || (q37B === 3 && q55A === 0)) penalty += 6

  if ((tagsA.includes('hate_fast_meet') && q55B === 0) || (tagsB.includes('hate_fast_meet') && q55A === 0)) penalty += 10

  if ((tagsA.includes('hate_too_cold') && [2, 3].includes(q49B)) || (tagsB.includes('hate_too_cold') && [2, 3].includes(q49A))) penalty += 8

  return penalty
}

// ─────────────────────────────────────────────
//  七、联系方式交换质量
// ─────────────────────────────────────────────

export function calcContactQuality(u: V2User): number {
  const contactIntent = calcContactIntent(u)
  const chatAbility = calcChatAbility(u)

  const a11 = ansIdx('q11', u.q11)
  const seriousScore = avg([
    intentScore4(ansIdx('q38', u.q38)),
    intentScore4(ansIdx('q51', u.q51)),
    a11 === 0 ? 100 : a11 === 1 ? 80 : a11 === 2 ? 45 : 70,
  ])

  let quality =
    contactIntent * 0.40 +
    chatAbility * 0.40 +
    seriousScore * 0.20

  // q38D + q39D 上限 40
  if (ansIdx('q38', u.q38) === 3 && ansIdx('q39', u.q39) === 3) {
    quality = Math.min(quality, 40)
  }

  return clamp(quality, 0, 100)
}

// ─────────────────────────────────────────────
//  八、V2 主评分函数
// ─────────────────────────────────────────────

export function calculateMatchV2(a: V2User, b: V2User, config?: V2MatchConfig): V2MatchResult {
  const cfg = config || DEFAULT_V2_CONFIG

  // 1. 安全筛查
  const safetyA = calcSafetyV2(a)
  const safetyB = calcSafetyV2(b)
  if (safetyA.level === 'blocked' || safetyB.level === 'blocked') {
    return {
      score: 0, dimScores: [], reasons: ['安全筛查未通过'], tier: 'none',
      contactQuality: 0, safetyLevel: 'blocked', truthScore: 0,
    }
  }

  // 2. 五维度评分
  const valueScore = calcValueScore(a, b)
  const interactionScore = calcInteractionScore(a, b)
  const dailyScore = calcDailyScore(a, b)
  const chatScore = calcChatScore(a, b)
  const iceBreakScore = calcIceBreakScore(a, b)

  const baseScore =
    valueScore * cfg.valuesWeight +
    interactionScore * cfg.interactionWeight +
    dailyScore * cfg.dailyWeight +
    chatScore * cfg.chatWeight +
    iceBreakScore * cfg.icebreakWeight

  // 3. 灾难惩罚
  const penalty = calcTotalPenalty(a, b)

  // 4. 真实性系数
  const truthPair = calcTruthPairV2(a, b)

  // 5. 风险系数
  const riskCoeff = getRiskCoeffV2(safetyA.level, safetyB.level)

  // 6. 连续未匹配补偿
  const unmatchedBoost = Math.min(
    Math.max(a.unmatchedRounds || 0, b.unmatchedRounds || 0) * 3,
    9
  )

  // 7. 最终分
  const finalScore = clamp(
    Math.round(((baseScore - penalty) * truthPair * riskCoeff + unmatchedBoost) * 100) / 100,
    0, 99
  )

  // 8. 联系方式质量
  const contactQuality = Math.min(calcContactQuality(a), calcContactQuality(b))

  // 9. 匹配层级
  let tier: V2MatchResult['tier'] = 'none'
  if (finalScore >= cfg.strongThreshold) tier = 'strong'
  else if (finalScore >= cfg.normalThreshold) tier = 'normal'
  else if (finalScore >= cfg.backupThreshold) tier = 'backup'

  // 10. 维度分数
  const dimScores: V2DimensionScore[] = [
    { name: '价值观', score: Math.round(valueScore), weight: cfg.valuesWeight, compatible: valueScore >= 70 },
    { name: '互动模式', score: Math.round(interactionScore), weight: cfg.interactionWeight, compatible: interactionScore >= 70 },
    { name: '日常节奏', score: Math.round(dailyScore), weight: cfg.dailyWeight, compatible: dailyScore >= 70 },
    { name: '聊天能力', score: Math.round(chatScore), weight: cfg.chatWeight, compatible: chatScore >= 60 },
    { name: '破冰适配', score: Math.round(iceBreakScore), weight: cfg.icebreakWeight, compatible: iceBreakScore >= 60 },
  ]

  // 11. 匹配理由
  const reasons = generateReasonsV2(a, b, finalScore, valueScore, interactionScore, dailyScore, chatScore, iceBreakScore)

  const worstSafety = safetyA.riskScore > safetyB.riskScore ? safetyA.level : safetyB.level
  const minTruth = Math.min(calcTruthV2(a), calcTruthV2(b))

  return {
    score: finalScore,
    dimScores,
    reasons,
    tier,
    contactQuality,
    safetyLevel: worstSafety,
    truthScore: Math.round(minTruth * 100) / 100,
  }
}

// ─────────────────────────────────────────────
//  九、匹配理由生成
// ─────────────────────────────────────────────

function generateReasonsV2(
  a: V2User, b: V2User, finalScore: number,
  valueScore: number, interactionScore: number, dailyScore: number,
  chatScore: number, iceBreakScore: number,
): string[] {
  const reasons: string[] = []

  const q26A = ansIdx('q26', a.q26), q26B = ansIdx('q26', b.q26)
  const q24A = ansIdx('q24', a.q24), q24B = ansIdx('q24', b.q24)

  // 关系理由
  if (q26A <= 1 && q26B <= 1) {
    reasons.push('你们都不是把关系当成输赢的人。遇到问题时，一方愿意修复，另一方也愿意接住，这种组合更容易把争执变成沟通。')
  } else if ((q26A === 0 && q26B === 1) || (q26A === 1 && q26B === 0)) {
    reasons.push('在处理矛盾时，你们的节奏形成了一种自然配合：一个更愿意先开口，另一个适合冷静后再谈。')
  }

  // 生活理由
  if (dailyScore >= 75 && sameFreqScore(ansIdx('q23', a.q23), ansIdx('q23', b.q23)) >= 80) {
    reasons.push('你们对陪伴频率和生活节奏的期待比较接近，不容易出现一方觉得被冷落、另一方觉得被打扰的落差。')
  }

  // 旅行理由
  if ((q24A === 0 && q24B === 1) || (q24B === 0 && q24A === 1)) {
    reasons.push('一个擅长安排规划，另一个愿意配合享受，这种搭配在一起出门会比较顺。')
  } else if (q24A === 2 && q24B === 2) {
    reasons.push('你们都倾向于商量着来，这种相处方式不容易产生权力拉扯。')
  }

  // 聊天理由
  const topicA = parseMultiSelect(a.q44)
  const topicB = parseMultiSelect(b.q44)
  const topicOverlap = topicB.filter(x => new Set(topicA).has(x)).length
  if (topicOverlap >= 2) {
    reasons.push('你们有几个天然共同话题，加上联系方式后不需要从尴尬的"在吗"开始。')
  }

  const q37A = ansIdx('q37', a.q37), q37B = ansIdx('q37', b.q37)
  if ((q37A === 0 && [1, 3, 4].includes(q37B)) || (q37B === 0 && [1, 3, 4].includes(q37A))) {
    reasons.push('你们在破冰节奏上有互补感：一个更容易先开口，另一个更适合慢慢接住。')
  }

  if (calcChatAbility(a) >= 65 && calcChatAbility(b) >= 65) {
    reasons.push('你们都不是容易把话题聊死的人，日常分享更容易被认真接住。')
  }

  // 高分理由
  if (finalScore >= 86) {
    reasons.push('这是一组非常难得的匹配，不只是聊得来，而是关系底色、相处节奏和破冰方式都比较顺。')
  } else if (finalScore >= 76) {
    reasons.push('整体来看，这是值得认真了解的对象。你们的关系节奏和聊天适配度都达到了较稳定的区间。')
  }

  return reasons.slice(0, 4)
}

// ─────────────────────────────────────────────
//  十、性别兼容（与 V1 相同）
// ─────────────────────────────────────────────

export function genderCompatibleV2(userA: V2User, userB: V2User): boolean {
  const aGender = userA.gender
  const bGender = userB.gender
  const aPref = userA.preferred_gender
  const bPref = userB.preferred_gender
  const aWantsB = aPref === 'all' || aPref === bGender
  const bWantsA = bPref === 'all' || bPref === aGender
  return aWantsB && bWantsA
}

// ─────────────────────────────────────────────
//  十一、q36 自动转换（V1 文本→V2 标签）
// ─────────────────────────────────────────────

const Q36_TAG_KEYWORDS: Record<string, string[]> = {
  'hate_interview': ['查户口', '面试', '追问', '一上来就问'],
  'hate_too_intense': ['太热情', '消息太多', '太密', '轰炸'],
  'hate_too_cold': ['太冷', '冷淡', '几个字', '不回'],
  'hate_ex_history': ['前任', '感情史', '前男', '前女'],
  'hate_photo_appearance': ['照片', '外貌', '评价', '长相', '身材'],
  'hate_fast_meet': ['约线下', '见面', '语音', '电话', '太快'],
  'hate_formal_talk': ['严肃', '面试', '高压'],
  'hate_too_meme': ['玩梗', '抽象', '接不上'],
  'hate_carrying': ['自己找话题', '一直找', '带节奏', '一个人聊'],
  'hate_fast_flirt': ['暧昧', '边界', '太快'],
}

export function convertQ36TextToTags(v1Text: string): string[] {
  if (!v1Text) return []
  const matched = new Set<string>()
  const text = v1Text

  for (const [tag, keywords] of Object.entries(Q36_TAG_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        matched.add(tag)
        break
      }
    }
  }

  // 检查"顺其自然"
  if (text.includes('顺其自然') || text.includes('没什么')) {
    matched.add('easygoing')
  }

  return Array.from(matched).slice(0, 4)
}

// ─────────────────────────────────────────────
//  十二、用户数据加载（优先 V2，回退 V1）
// ─────────────────────────────────────────────

const V2_SELECT_FIELDS = `
  u.id, u.nickname, u.gender, u.preferred_gender, u.school, u.match_school_prefs,
  u.match_enabled, u.safety_level as manual_safety_level,
  s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
  s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
  s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
  s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37,
  s.q38,s.q39,s.q40,s.q41,s.q42,s.q43,s.q44,s.q45,s.q46,s.q47,
  s.q48,s.q49,s.q50,s.q51,s.q52,s.q53,s.q54,s.q55,s.q56,s.q57,s.q58`

export async function loadUserForV2Matching(db: ReturnType<typeof getDb>, userId: number): Promise<V2User | null> {
  // 优先从 V2 表加载
  const v2Res = await db.execute({
    sql: `SELECT ${V2_SELECT_FIELDS} FROM users u JOIN survey_responses_v2 s ON u.id = s.user_id WHERE u.id = ?`,
    args: [userId],
  })
  if (v2Res.rows.length > 0) return v2Res.rows[0] as any as V2User

  // 回退到 V1 表
  const v1Res = await db.execute({
    sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender, u.school, u.match_school_prefs,
                 u.match_enabled, u.safety_level as manual_safety_level,
                 s.q1,s.q2,s.q3,s.q4,s.q5,s.q6,s.q7,s.q8,s.q9,s.q10,
                 s.q11,s.q12,s.q13,s.q14,s.q15,s.q16,s.q17,s.q18,s.q19,s.q20,
                 s.q21,s.q22,s.q23,s.q24,s.q25,s.q26,s.q27,s.q28,s.q29,s.q30,
                 s.q31,s.q32,s.q33,s.q34,s.q35,s.q36,s.q37
          FROM users u JOIN survey_responses s ON u.id = s.user_id WHERE u.id = ?`,
    args: [userId],
  })
  if (v1Res.rows.length === 0) return null

  const user = v1Res.rows[0] as any
  // q36 自动转换：文本→标签数组
  user.q36 = JSON.stringify(convertQ36TextToTags(user.q36))
  // q38-q58 设为空字符串，使 ansIdx 返回 -1，评分函数对 -1 返回中性分（50-70），不影响 V1 用户排名
  for (let i = 38; i <= 58; i++) {
    user['q' + i] = ''
  }
  return user as V2User
}

// ─────────────────────────────────────────────
//  十三、V2 自动批量匹配
// ─────────────────────────────────────────────

const ALL_SCHOOL_NAMES = [
  '吉林大学', '东北师范大学', '吉林动画学院', '长春大学',
  '长春理工大学', '长春工业大学', '吉林建筑大学', '吉林农业大学',
  '长春中医药大学', '吉林工程技术师范学院', '长春师范大学',
  '吉林财经大学', '吉林体育学院', '吉林艺术学院', '吉林工商学院',
  '长春工程学院', '吉林警察学院', '长春汽车职业技术大学', '长春职业技术大学',
  '吉林外国语大学', '长春光华学院', '长春工业大学人文信息学院',
  '长春电子科技学院', '长春财经学院', '吉林建筑科技学院',
  '长春建筑学院', '长春科技学院', '长春大学旅游学院', '长春人文学院',
]

export interface V2AutoMatchResult {
  success: boolean
  weekKey: string
  matchedPairs: number
  unmatchedUsers: number
  totalEligible: number
  safePoolSize: number
  matchedDetails?: Array<{ userA: string; userB: string; score: number }>
  unmatchedDetails?: Array<{ nickname: string; gender: string; reason: string }>
}

export async function executeAutoMatchV2(weekKey?: string): Promise<V2AutoMatchResult> {
  const db = getDb()
  const wk = weekKey || getWeekKey()
  const config = await getMatchConfigV2()
  clearMatchConfigV2Cache()

  // 查询所有有 V2 问卷或 V1 问卷的用户（排除本周已有 V2 匹配的）
  const usersResult = await db.execute({
    sql: `SELECT u.id, u.nickname, u.gender, u.preferred_gender, u.school, u.match_school_prefs,
                 u.safety_level as manual_safety_level
          FROM users u
          WHERE (u.survey_completed_v2 = 1 OR u.survey_completed = 1)
            AND u.match_enabled = 1
            AND u.id NOT IN (
              SELECT user_a FROM matches_v2 WHERE week_key = ?
              UNION
              SELECT user_b FROM matches_v2 WHERE week_key = ?
            )`,
    args: [wk, wk],
  })

  // 加载每个用户的完整数据
  const users: V2User[] = []
  for (const row of usersResult.rows) {
    const u = await loadUserForV2Matching(db, Number((row as any).id))
    if (u) users.push(u)
  }

  // 查询历史未匹配轮次（最近 4 周在 matches_v2 中出现过的用户）
  const userIds = users.map(u => Number(u.id))
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => '?').join(',')
    const matchedHistory = await db.execute({
      sql: `SELECT DISTINCT user_a as uid FROM matches_v2 WHERE user_a IN (${placeholders})
            UNION
            SELECT DISTINCT user_b as uid FROM matches_v2 WHERE user_b IN (${placeholders})`,
      args: [...userIds, ...userIds],
    })
    const everMatched = new Set<number>()
    for (const row of matchedHistory.rows as any[]) {
      everMatched.add(Number(row.uid))
    }
    // 计算连续未匹配轮次：简单策略 — 从未被匹配过的用户给予更高补偿
    for (const u of users) {
      if (!everMatched.has(Number(u.id))) {
        // 从未在 matches_v2 中出现过，视为至少 2 轮未匹配
        u.unmatchedRounds = 2
      }
    }
  }

  function parsePrefs(prefsRaw: string | null | undefined): Set<string> {
    if (!prefsRaw || prefsRaw === 'all') return new Set(ALL_SCHOOL_NAMES)
    try { return new Set(JSON.parse(prefsRaw)) } catch { return new Set(ALL_SCHOOL_NAMES) }
  }

  if (users.length < 2) {
    return {
      success: false, weekKey: wk,
      matchedPairs: 0, unmatchedUsers: users.length,
      totalEligible: users.length, safePoolSize: 0,
    }
  }

  const unmatchedDetails: Array<{ nickname: string; gender: string; reason: string }> = []
  const safeUsers: Array<{ user: V2User; safety: V2SafetyResult }> = []

  for (const u of users) {
    const nickname = String(u.nickname || '未知')
    const gender = u.gender || ''
    if (u.manual_safety_level === 'blocked') {
      unmatchedDetails.push({ nickname, gender, reason: '管理员手动封禁' })
      continue
    }
    const safety = calcSafetyV2(u)
    if (safety.level === 'blocked') {
      unmatchedDetails.push({ nickname, gender, reason: `安全筛查未通过（风险分${safety.riskScore}）` })
      continue
    }
    safeUsers.push({ user: u, safety })
  }

  if (safeUsers.length < 2) {
    return {
      success: false, weekKey: wk,
      matchedPairs: 0, unmatchedUsers: users.length,
      totalEligible: users.length, safePoolSize: safeUsers.length,
      unmatchedDetails,
    }
  }

  // 构建所有候选边
  type Edge = { a: V2User; b: V2User; score: number; cq: number }
  const edges: Edge[] = []

  for (let i = 0; i < safeUsers.length; i++) {
    for (let j = i + 1; j < safeUsers.length; j++) {
      const ua = safeUsers[i].user
      const ub = safeUsers[j].user
      if (!genderCompatibleV2(ua, ub)) continue

      // 学校偏好过滤
      const prefsA = parsePrefs(ua.match_school_prefs)
      const prefsB = parsePrefs(ub.match_school_prefs)
      const schoolA = ua.school || ''
      const schoolB = ub.school || ''
      if (schoolA && schoolB) {
        if (!prefsA.has(schoolB) || !prefsB.has(schoolA)) continue
      }

      const result = calculateMatchV2(ua, ub, config)
      if (result.score < config.backupThreshold) continue

      const cqA = calcContactQuality(ua)
      const cqB = calcContactQuality(ub)
      if (cqA < 40 || cqB < 40) continue

      edges.push({ a: ua, b: ub, score: result.score, cq: Math.min(cqA, cqB) })
    }
  }

  // 按分数降序排序
  edges.sort((x, y) => y.score - x.score)

  // 贪心选边（最大覆盖 + 最大权重）
  const matched = new Set<number>()
  const insertStatements: Array<{ sql: string; args: any[] }> = []
  const matchedDetails: Array<{ userA: string; userB: string; score: number }> = []

  for (const edge of edges) {
    const idA = Number(edge.a.id)
    const idB = Number(edge.b.id)
    if (matched.has(idA) || matched.has(idB)) continue

    // backup 匹配需要额外条件
    if (edge.score < config.normalThreshold) {
      // 检查连续未匹配轮次
      const maxUnmatched = Math.max(edge.a.unmatchedRounds || 0, edge.b.unmatchedRounds || 0)
      if (maxUnmatched < 2) continue
      // 双方 safety 必须 normal
      const sa = calcSafetyV2(edge.a)
      const sb = calcSafetyV2(edge.b)
      if (sa.level !== 'normal' || sb.level !== 'normal') continue
      // 聊天和联系方式质量检查
      const chatS = calcChatScore(edge.a, edge.b)
      const ciA = calcContactIntent(edge.a)
      const ciB = calcContactIntent(edge.b)
      if (chatS < 60 || ciA < 55 || ciB < 55) continue
      if (edge.cq < 55) continue
    }

    const result = calculateMatchV2(edge.a, edge.b, config)

    insertStatements.push({
      sql: `INSERT INTO matches_v2 (user_a, user_b, score, dim_scores, reasons, week_key)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [idA, idB, edge.score, JSON.stringify(result.dimScores), JSON.stringify(result.reasons), wk],
    })

    matched.add(idA)
    matched.add(idB)
    matchedDetails.push({
      userA: String(edge.a.nickname || '未知'),
      userB: String(edge.b.nickname || '未知'),
      score: edge.score,
    })
  }

  // 收集未匹配原因
  for (const su of safeUsers) {
    if (matched.has(Number(su.user.id))) continue
    const nickname = String(su.user.nickname || '未知')
    const gender = su.user.gender || ''

    let hasGenderCompatible = false
    let bestScore = 0
    for (const other of safeUsers) {
      if (Number(other.user.id) === Number(su.user.id)) continue
      if (!genderCompatibleV2(su.user, other.user)) continue
      hasGenderCompatible = true
      const r = calculateMatchV2(su.user, other.user, config)
      if (r.score > bestScore) bestScore = r.score
    }

    let reason: string
    if (!hasGenderCompatible) {
      reason = '无性别兼容的候选人'
    } else if (bestScore < config.backupThreshold) {
      reason = `最高匹配分${bestScore}分，低于最低阈值${config.backupThreshold}分`
    } else {
      reason = `最高匹配分${bestScore}分，未满足匹配条件`
    }
    unmatchedDetails.push({ nickname, gender, reason })
  }

  // 批量写入
  let insertFailures = 0
  if (insertStatements.length > 0) {
    try {
      await db.batch(insertStatements)
    } catch {
      for (const stmt of insertStatements) {
        try { await db.execute(stmt) } catch (_) { insertFailures++ }
      }
    }
  }
  if (insertFailures > 0) {
    console.error(`[match-engine-v2] ${insertFailures}/${insertStatements.length} match inserts failed`)
  }

  return {
    success: true,
    weekKey: wk,
    matchedPairs: matchedDetails.length,
    unmatchedUsers: safeUsers.length - matched.size,
    totalEligible: users.length,
    safePoolSize: safeUsers.length,
    matchedDetails,
    unmatchedDetails,
  }
}

// ─────────────────────────────────────────────
//  十四、分布式锁包装
// ─────────────────────────────────────────────

const LOCK_EXPIRE_MS = 5 * 60 * 1000

export async function executeAutoMatchSafeV2(db: ReturnType<typeof getDb>): Promise<{
  status: string
  weekKey?: string
  message?: string
  matchedPairs?: number
  unmatchedUsers?: number
  totalEligible?: number
  safePoolSize?: number
}> {
  const weekKey = getWeekKey()
  const lockKey = `matching_lock_v2_${weekKey}`

  const doneCheck = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ? AND value = 'done'",
    args: [lockKey],
  })
  if (doneCheck.rows.length > 0) return { status: 'already_done', weekKey }

  const runningCheck = await db.execute({
    sql: "SELECT value, updated_at FROM settings WHERE key = ? AND value = 'running'",
    args: [lockKey],
  })
  if (runningCheck.rows.length > 0) {
    const lockRow = runningCheck.rows[0] as any
    if (lockRow.updated_at) {
      const lockAge = Date.now() - new Date(lockRow.updated_at).getTime()
      if (lockAge > LOCK_EXPIRE_MS) {
        await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
      } else {
        return { status: 'in_progress', weekKey }
      }
    } else {
      return { status: 'in_progress', weekKey }
    }
  }

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

  const confirmLock = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: [lockKey],
  })
  if ((confirmLock.rows[0] as any)?.value !== 'running') {
    return { status: 'in_progress', weekKey }
  }

  try {
    const result = await executeAutoMatchV2(weekKey)

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
    try {
      await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
    } catch (cleanupErr) {
      console.error('[match-engine-v2] lock cleanup failed:', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr))
    }
    throw err instanceof Error ? err : new Error(String(err))
  }
}

export async function resetWeekMatchLockV2(weekKey?: string): Promise<boolean> {
  const db = getDb()
  const key = weekKey || getWeekKey()
  const lockKey = `matching_lock_v2_${key}`
  let lockOk = false
  let matchOk = false
  try {
    await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [lockKey] })
    lockOk = true
  } catch (e) {
    console.error('[match-engine-v2] resetWeekMatchLockV2: lock delete failed:', e instanceof Error ? e.message : String(e))
  }
  try {
    await db.execute({ sql: "DELETE FROM matches_v2 WHERE week_key = ?", args: [key] })
    matchOk = true
  } catch (e) {
    console.error('[match-engine-v2] resetWeekMatchLockV2: matches delete failed:', e instanceof Error ? e.message : String(e))
  }
  return lockOk && matchOk
}

// ─────────────────────────────────────────────
//  十五、V2 手动匹配
// ─────────────────────────────────────────────

export interface V2ManualMatchResult {
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
    dimScores: V2DimensionScore[]
    reasons: string[]
  }
}

/** 计算下一个周日 20:00 北京时间（ISO 字符串，去尾部 Z 以兼容 SQLite） */
function getRevealAt(): string {
  const now = new Date()
  const utcDay = now.getUTCDay()       // 0=Sun
  const utcHours = now.getUTCHours()
  const reveal = new Date(now)

  let daysUntilSun = (7 - utcDay) % 7
  // 如果已经是周日且已过 UTC 12:00（北京 20:00），则用下个周日
  if (utcDay === 0 && utcHours >= 12) {
    daysUntilSun = 7
  }
  reveal.setUTCDate(reveal.getUTCDate() + daysUntilSun)
  reveal.setUTCHours(12, 0, 0, 0)     // 北京时间 20:00
  return reveal.toISOString().replace('Z', '')
}

export async function handleManualMatchV2(body: any): Promise<V2ManualMatchResult> {
  const db = getDb()
  const userAId = Number(body.userA)
  const userBId = Number(body.userB)
  const weekKey = body.weekKey ? dateToWeekKey(body.weekKey) : getWeekKey()
  // 管理员手动匹配可指定目标表（不受 V1/V2 版本限制）
  const targetTable = body.targetTable === 'matches' ? 'matches' : 'matches_v2'

  if (!Number.isInteger(userAId) || !Number.isInteger(userBId) || userAId <= 0 || userBId <= 0) {
    return { error: '无效的用户ID', status: 400 }
  }
  if (userAId === userBId) return { error: '不能匹配同一个人', status: 400 }

  const userA = await loadUserForV2Matching(db, userAId)
  const userB = await loadUserForV2Matching(db, userBId)
  if (!userA || !userB) return { error: `用户不存在 — A: ${!!userA}, B: ${!!userB}`, status: 404 }

  const existingCheck = await db.execute({
    sql: `SELECT id FROM ${targetTable} WHERE week_key = ? AND (user_a IN (?, ?) OR user_b IN (?, ?)) LIMIT 1`,
    args: [weekKey, userAId, userBId, userAId, userBId],
  })
  if (existingCheck.rows.length > 0) {
    return {
      error: `其中一方在本周(${weekKey})已有匹配记录`,
      existingMatchId: Number(existingCheck.rows[0].id),
      status: 409,
    }
  }

  const config = await getMatchConfigV2()
  const result = calculateMatchV2(userA, userB, config)

  // 管理员可自定义契合度，否则用自动计算值
  const customScore = typeof body.customScore === 'number' && body.customScore >= 0 && body.customScore <= 99
    ? Math.round(body.customScore * 100) / 100 : null  // 保留两位小数
  const finalScore = customScore ?? result.score

  await db.execute({
    sql: `INSERT INTO ${targetTable} (user_a, user_b, score, dim_scores, reasons, week_key, source, reveal_at)
          VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
    args: [userAId, userBId, finalScore, JSON.stringify(result.dimScores), JSON.stringify(result.reasons), weekKey, getRevealAt()],
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
      userAName: userA.nickname || '未知',
      userB: userBId,
      userBName: userB.nickname || '未知',
      score: finalScore,
      dimScores: result.dimScores,
      reasons: result.reasons,
    },
  }
}

// ─────────────────────────────────────────────
//  十六、V2 配置读写
// ─────────────────────────────────────────────

let _cachedV2Config: V2MatchConfig | null = null

export async function getMatchConfigV2(): Promise<V2MatchConfig> {
  if (_cachedV2Config) return _cachedV2Config
  try {
    const db = getDb()
    const res = await db.execute({
      sql: `SELECT value FROM settings WHERE key = ?`,
      args: [MATCH_CONFIG_V2_KEY],
    })
    const row = res.rows[0] as any
    if (row?.value) {
      const parsed = JSON.parse(row.value)
      _cachedV2Config = {
        valuesWeight: typeof parsed.valuesWeight === 'number' ? parsed.valuesWeight : DEFAULT_V2_CONFIG.valuesWeight,
        interactionWeight: typeof parsed.interactionWeight === 'number' ? parsed.interactionWeight : DEFAULT_V2_CONFIG.interactionWeight,
        dailyWeight: typeof parsed.dailyWeight === 'number' ? parsed.dailyWeight : DEFAULT_V2_CONFIG.dailyWeight,
        chatWeight: typeof parsed.chatWeight === 'number' ? parsed.chatWeight : DEFAULT_V2_CONFIG.chatWeight,
        icebreakWeight: typeof parsed.icebreakWeight === 'number' ? parsed.icebreakWeight : DEFAULT_V2_CONFIG.icebreakWeight,
        strongThreshold: typeof parsed.strongThreshold === 'number' ? parsed.strongThreshold : DEFAULT_V2_CONFIG.strongThreshold,
        normalThreshold: typeof parsed.normalThreshold === 'number' ? parsed.normalThreshold : DEFAULT_V2_CONFIG.normalThreshold,
        backupThreshold: typeof parsed.backupThreshold === 'number' ? parsed.backupThreshold : DEFAULT_V2_CONFIG.backupThreshold,
      }
      return _cachedV2Config!
    }
  } catch (e) {
    console.warn('[match-engine-v2] getMatchConfigV2 failed, using defaults:', e instanceof Error ? e.message : String(e))
  }
  _cachedV2Config = { ...DEFAULT_V2_CONFIG }
  return _cachedV2Config!
}

export function clearMatchConfigV2Cache(): void {
  _cachedV2Config = null
}

export async function saveMatchConfigV2(config: Partial<V2MatchConfig>): Promise<V2MatchConfig> {
  const current = await getMatchConfigV2()
  const merged: V2MatchConfig = {
    ...current,
    ...config,
    valuesWeight: clamp(config.valuesWeight ?? current.valuesWeight, 0, 1),
    interactionWeight: clamp(config.interactionWeight ?? current.interactionWeight, 0, 1),
    dailyWeight: clamp(config.dailyWeight ?? current.dailyWeight, 0, 1),
    chatWeight: clamp(config.chatWeight ?? current.chatWeight, 0, 1),
    icebreakWeight: clamp(config.icebreakWeight ?? current.icebreakWeight, 0, 1),
    strongThreshold: clamp(config.strongThreshold ?? current.strongThreshold, 0, 99),
    normalThreshold: clamp(config.normalThreshold ?? current.normalThreshold, 0, 99),
    backupThreshold: clamp(config.backupThreshold ?? current.backupThreshold, 0, 99),
  }
  const db = getDb()
  await db.execute({
    sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
    args: [MATCH_CONFIG_V2_KEY, JSON.stringify(merged)],
  })
  _cachedV2Config = merged
  return merged
}
