import { NextRequest, NextResponse } from 'next/server'
import { getDb, initDb } from '@/lib/db'
import { verifyTokenSafe } from '@/lib/auth'
import { sanitizeString, sanitizeForStorage } from '@/lib/validation'
import { checkRateLimit, SURVEY_LIMITER } from '@/lib/rate-limit'
import { getWeekKey } from '@/lib/week'
import { getClientIp, validateCsrfToken, getCookieName } from '@/lib/csrf'
import { detectAttackPatterns } from '@/lib/security'
import { scoreGpsSamples, getSchoolShort, isNoEmailSchool, NO_EMAIL_SCHOOLS } from '@/lib/geo'

export const runtime = 'edge'

// ── V2 题目白名单（q1-q35 同 V1，q36 改多选，q37 同 V1，q38-q58 新增）──

const VALID_OPTIONS: Record<string, string[]> = {
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
  q33: ['真诚善良', '幽默风趣', '聪明机智', '细心体贴', '独立自主', '乐观开朗', '靠谱负责', '善解人意', '有上进心', '情绪稳定'],
  q34: ['容易焦虑', '有点拖延', '不太会表达', '有时固执', '容易吃醋', '有点懒散', '三分钟热度', '过于敏感', '不善拒绝', '脾气急躁'],
  q37: ['我比较喜欢主动开启话题', '我希望对方多主动一点，我会慢慢接上', '都可以，只要聊天自然就好', '我比较慢热，希望对方不要太急', '我不太擅长开启话题，但愿意认真回应'],
  // H 模块
  q38: ['当天就加，认真开个头', '有空时会加，一般不会拖太久', '会犹豫一下，可能等对方先加', '不一定会加，看当时心情'],
  q39: ['根据对方资料或问卷，发一个具体问题', '先简单打招呼，再慢慢找话题', '发"你好/在吗"，然后看对方怎么回', '我经常不知道怎么开口'],
  q40: ['谁先看到谁先说，不用计较', '主动添加的人应该先说', '我希望对方先说，但我会认真回应', '我基本不主动，除非特别感兴趣'],
  q41: ['找共同点，先问一个具体问题', '会有点尴尬，但还是会努力聊', '等对方带话题', '干脆先不聊，免得尴尬'],
  q42: ['换个更具体的话题试试', '再回一两句，看对方反应', '觉得对方没兴趣，就不太想聊了', '我也不知道怎么接，只能冷掉'],
  q43: ['主动换话题，或者接之前的线索', '坦白说"我有点卡壳，但还想继续聊"', '等对方重新找话题', '冷了就算了，说明不合适'],
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
}

// q36 多选标签白名单（V2 破冰适配）
const Q36_TAGS = [
  'hate_interview', 'hate_too_intense', 'hate_too_cold', 'hate_ex_history',
  'hate_photo_appearance', 'hate_fast_meet', 'hate_formal_talk', 'hate_too_meme',
  'hate_carrying', 'hate_fast_flirt', 'easygoing',
]

// q44 话题多选白名单
const Q44_OPTIONS = [
  '校园日常', '专业作品', '游戏', '动漫', '电影', '音乐', '吃喝探店', '宠物',
  '旅行', '摄影', '绘画', '手作', '运动', '穿搭', '情绪近况', '学习成长',
  '未来计划', '吐槽段子',
]

// q45 雷区多选白名单
const Q45_OPTIONS = [
  '前任', '感情史', '家庭隐私', '收入消费', '身材外貌评价', '黄段子或擦边',
  '频繁要照片', '查户口式提问', '太快约线下', '政治争论', '人生说教', '过度打探隐私', '没有明显雷区',
]

const TOTAL_QUESTIONS = 58

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

    const ip = getClientIp(req)
    const rateResult = await checkRateLimit(ip, SURVEY_LIMITER, 'survey-v2')
    if (!rateResult.allowed) {
      return NextResponse.json({ error: '提交太频繁' }, { status: 429 })
    }

    // 业务层频率限制
    const weekKey = getWeekKey()
    const countKey = `survey_v2_week_${decoded.id}_${weekKey}`
    const countResult = await db.execute({
      sql: `SELECT value FROM settings WHERE key = ?`,
      args: [countKey],
    })
    const currentCount = Number((countResult.rows[0] as any)?.value || 0)
    if (currentCount >= 3) {
      return NextResponse.json({ error: '本周问卷已修改3次，请下周再试' }, { status: 429 })
    }

    const answers = await req.json()
    try { await detectAttackPatterns(req, answers as Record<string, unknown>) } catch {}
    if (typeof answers !== 'object' || answers === null) {
      return NextResponse.json({ error: '数据格式错误' }, { status: 400 })
    }

    const fields = Array.from({ length: TOTAL_QUESTIONS }, (_, i) => `q${i + 1}`)
    const values: string[] = []

    // 题目类型分类
    const MULTI_SELECT_QUESTIONS = new Set(['q33', 'q34', 'q36', 'q44', 'q45'])
    const MULTI_SELECT_MAX: Record<string, number> = { q33: 3, q34: 3, q36: 4, q44: 5, q45: 4 }
    const MULTI_SELECT_WHITELIST: Record<string, string[]> = {
      q33: VALID_OPTIONS.q33,
      q34: VALID_OPTIONS.q34,
      q36: Q36_TAGS,
      q44: Q44_OPTIONS,
      q45: Q45_OPTIONS,
    }
    const TEXT_QUESTIONS = new Set(['q35', 'q58'])
    const CHOICE_WITH_OTHER_QUESTIONS = new Set(['q37'])

    for (const f of fields) {
      const rawVal = answers[f]

      if (TEXT_QUESTIONS.has(f)) {
        const val = sanitizeForStorage(typeof rawVal === 'string' ? rawVal : '', 200)
        values.push(val)
      } else if (CHOICE_WITH_OTHER_QUESTIONS.has(f)) {
        const val = sanitizeString(String(rawVal || ''), 200)
        if (!val) {
          values.push('')
        } else if (val.startsWith('其他：')) {
          const customText = sanitizeForStorage(val.slice(3), 100)
          values.push('其他：' + customText)
        } else if (VALID_OPTIONS[f] && !VALID_OPTIONS[f].includes(val)) {
          return NextResponse.json({ error: `第${f.slice(1)}题答案不合法` }, { status: 400 })
        } else {
          values.push(val)
        }
      } else if (MULTI_SELECT_QUESTIONS.has(f)) {
        if (!rawVal || typeof rawVal !== 'string') {
          values.push('')
          continue
        }
        try {
          const arr = JSON.parse(rawVal)
          if (!Array.isArray(arr)) {
            return NextResponse.json({ error: `第${f.slice(1)}题格式错误，请选择选项` }, { status: 400 })
          }
          const maxSelect = MULTI_SELECT_MAX[f] || 3
          if (arr.length === 0) {
            return NextResponse.json({ error: `第${f.slice(1)}题请至少选择1项` }, { status: 400 })
          }
          if (arr.length > maxSelect) {
            return NextResponse.json({ error: `第${f.slice(1)}题最多选${maxSelect}项` }, { status: 400 })
          }
          const whitelist = MULTI_SELECT_WHITELIST[f]
          if (whitelist) {
            for (const item of arr) {
              if (typeof item !== 'string' || !whitelist.includes(item)) {
                return NextResponse.json({ error: `第${f.slice(1)}题包含无效选项` }, { status: 400 })
              }
            }
          }
          values.push(rawVal)
        } catch {
          return NextResponse.json({ error: `第${f.slice(1)}题格式错误` }, { status: 400 })
        }
      } else {
        // 单选题
        const val = sanitizeString(String(rawVal || ''), 200)
        if (val && VALID_OPTIONS[f] && !VALID_OPTIONS[f].includes(val)) {
          return NextResponse.json({ error: `第${f.slice(1)}题答案不合法` }, { status: 400 })
        }
        values.push(val)
      }
    }

    // 检查所有题目已回答
    const unanswered = values.filter(v => !v).length
    if (unanswered > 0) {
      return NextResponse.json({ error: `请回答所有${TOTAL_QUESTIONS}道题目（还有${unanswered}题未答）` }, { status: 400 })
    }

    // 写入 V2 问卷表
    await db.execute({
      sql: `INSERT OR REPLACE INTO survey_responses_v2 (user_id, ${fields.join(', ')}, updated_at)
            VALUES (?, ${values.map(() => '?').join(', ')}, datetime('now'))`,
      args: [decoded.id, ...values],
    })

    await db.execute({
      sql: 'UPDATE users SET survey_completed_v2 = 1 WHERE id = ?',
      args: [decoded.id],
    })

    // 递增本周提交计数
    await db.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      args: [countKey, String(currentCount + 1)],
    })

    // ── GPS 采样验证（与 V1 survey/route.ts 逻辑一致）──
    const gpsSamples = answers.gpsSamples as Array<{ lat: number; lng: number; accuracy?: number }> | undefined
    const bodyPrevScore = typeof answers.prevScore === 'number' ? answers.prevScore : null
    const userId = Number(decoded.id)

    const userSchoolRow = await db.execute({ sql: 'SELECT school FROM users WHERE id = ?', args: [userId] })
    const userSchool = String((userSchoolRow.rows[0] as any)?.school || '')
    const userSchoolShort = getSchoolShort(userSchool)

    if (gpsSamples && Array.isArray(gpsSamples) && gpsSamples.length >= 1) {
      let bestResult: { score: number; details: string } | null = null
      if (userSchoolShort && isNoEmailSchool(userSchoolShort)) {
        bestResult = scoreGpsSamples(gpsSamples, userSchoolShort)
      } else {
        // 未知学校：对所有 NO_EMAIL_SCHOOLS 逐一评分取最高
        for (const short of Array.from(NO_EMAIL_SCHOOLS)) {
          const result = scoreGpsSamples(gpsSamples, short)
          if (!bestResult || result.score > bestResult.score) bestResult = result
        }
      }

      if (bestResult) {
        const finalScore = Math.max(bestResult.score, bodyPrevScore || 0)
        const verificationStatus = finalScore >= 50 ? 'verified_student' : 'pending_verification'
        const verificationMessage = finalScore >= 50
          ? `学生认证通过（GPS 得分 ${finalScore}）`
          : `GPS 得分 ${finalScore}，未达到认证阈值（50）。建议在校园内多个位置答题以提高得分。`

        const sessionId = `survey_v2_${Date.now()}`
        for (const s of gpsSamples) {
          await db.execute({
            sql: `INSERT INTO verification_samples (user_id, latitude, longitude, accuracy, session_id) VALUES (?, ?, ?, ?, ?)`,
            args: [userId, s.lat, s.lng, s.accuracy ?? null, sessionId],
          }).catch(() => {})
        }

        await db.execute({
          sql: 'UPDATE users SET verification_status = ?, verification_score = ?' +
            (verificationStatus === 'verified_student' ? ", verified_at = datetime('now')" : '') +
            ' WHERE id = ?',
          args: [verificationStatus, finalScore, userId],
        })

        const response = NextResponse.json({
          success: true,
          verificationStatus,
          verificationScore: finalScore,
          verificationMessage,
        })
        response.cookies.set('survey_v2_status', 'done', {
          secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60,
        })
        if (verificationStatus === 'verified_student') {
          response.cookies.set('verification_status', 'verified_student', {
            secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60,
          })
        }
        return response
      }
    }

    // 无 GPS 数据或评分失败，保留已有验证状态
    const existing = await db.execute({ sql: 'SELECT verification_status, verification_score FROM users WHERE id = ?', args: [userId] })
    const existingRow = existing.rows[0] as any
    const response = NextResponse.json({
      success: true,
      verificationStatus: existingRow?.verification_status || 'pending_verification',
      verificationScore: existingRow?.verification_score ?? null,
      verificationMessage: '',
    })
    response.cookies.set('survey_v2_status', 'done', {
      secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60,
    })
    return response
  } catch (error) {
    console.error('[survey-v2]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '保存失败，请稍后重试' }, { status: 500 })
  }
}

// GET：读取用户已有的 V2 问卷答案
export async function GET(req: NextRequest) {
  try {
    const cookieName = getCookieName('token')
    const token = req.cookies.get(cookieName)?.value
    if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const db = getDb()
    await initDb()
    const decoded = await verifyTokenSafe(token, db)
    if (!decoded) return NextResponse.json({ error: '请先登录' }, { status: 401 })

    const result = await db.execute({
      sql: `SELECT * FROM survey_responses_v2 WHERE user_id = ?`,
      args: [decoded.id],
    })

    if (result.rows.length === 0) {
      return NextResponse.json({ answers: null })
    }

    const row = result.rows[0] as any
    const answers: Record<string, string> = {}
    for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
      answers[`q${i}`] = row[`q${i}`] || ''
    }

    return NextResponse.json({ answers })
  } catch (error) {
    console.error('[survey-v2 GET]', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: '获取失败' }, { status: 500 })
  }
}
