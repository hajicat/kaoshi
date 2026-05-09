'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getCsrfToken } from '@/lib/csrf'

interface DimScore { name: string; score: number; compatible: boolean }
interface MatchData {
  id: number; partnerId: number; partnerNickname: string; partnerSchool: string
  score: number; dimScores: DimScore[] | null; reasons: string[]
  weekKey: string; iRevealed: boolean; partnerRevealed: boolean
  contact: { type: string | null; info: string | null; decryptError?: boolean; empty?: boolean } | null
  selfHasContact?: boolean
  partnerSurvey?: any
}

// 历史匹配记录（精简版）
interface HistoryMatch {
  id: number
  partnerNickname: string
  partnerGender: string | null
  partnerSchool: string
  score: number
  dimScores: DimScore[] | null
  reasons: string[]
  createdAt: string
  iRevealed: boolean
  partnerRevealed: boolean
  bothRevealed: boolean
  contact: { type: string | null; info: string | null; decryptError?: boolean; empty?: boolean } | null
  hidden: boolean // 当前周未揭晓时隐藏详情
}

interface WeekData {
  weekKey: string
  isCurrent: boolean
  totalMatches: number
  revealedCount: number
  matches: HistoryMatch[]
}

const DIM_COLORS: Record<string, string> = {
  '价值观': 'from-stone-400 to-amber-200',
  '互动模式': 'from-green-400 to-emerald-400',
  '日常节奏': 'from-blue-400 to-cyan-400',
}

// getCsrfToken 已从 @/lib/csrf 导入

// ── 倒计时组件 ──
// 安全复制到剪贴板（兼容非 HTTPS 环境）
const safeCopy = async (text: string): Promise<boolean> => {
  try {
    if (navigator?.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch {
    return false
  }
}

function MatchCountdown() {
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 })

  useEffect(() => {
    function update() {
      const now = new Date()
      const target = new Date(now)
      const utcDay = now.getUTCDay()
      const utcHours = now.getUTCHours()

      if (utcDay === 0 && utcHours >= 12) {
        target.setUTCDate(target.getUTCDate() + 7)
        target.setUTCHours(12, 0, 0, 0)
      } else {
        const daysToAdd = (7 - now.getUTCDay()) % 7
        target.setUTCDate(now.getUTCDate() + daysToAdd)
        target.setUTCHours(12, 0, 0, 0)
      }

      const diff = target.getTime() - now.getTime()
      setCountdown({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        mins: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        secs: Math.floor((diff % (1000 * 60)) / 1000),
      })
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="inline-flex items-center gap-2 px-5 py-3 bg-pink-50 rounded-full">
      {[
        { val: countdown.days, label: '天' },
        { val: countdown.hours, label: '时' },
        { val: countdown.mins, label: '分' },
        { val: countdown.secs, label: '秒' },
      ].map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-lg font-bold text-pink-600 font-mono w-6 text-center">
            {String(item.val).padStart(2, '0')}
          </span>
          <span className="text-xs text-gray-400">{item.label}</span>
          {i < 3 && <span className="text-gray-300">:</span>}
        </div>
      ))}
    </div>
  )
}

export default function MatchPage() {
  const router = useRouter()

  const [user, setUser] = useState<any>(null)
  const [match, setMatch] = useState<MatchData | null>(null)
  const [loading, setLoading] = useState(true)
  const [revealing, setRevealing] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteCodes, setInviteCodes] = useState<any[]>([])

  // 修改密码状态
  const [showChangePwd, setShowChangePwd] = useState(false)
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [pwdForm, setPwdForm] = useState({ oldPwd: '', newPwd: '', confirmPwd: '' })
  const [matchEnabled, setMatchEnabled] = useState(true)
  const [surveyPath, setSurveyPath] = useState('/survey')
  const [refreshing, setRefreshing] = useState(false)
  const [matchedDone, setMatchedDone] = useState<boolean | null>(null)
  const [inviteRequired, setInviteRequired] = useState(true)

  // ── 学校匹配偏好状态 ──
  const [schoolPrefs, setSchoolPrefs] = useState<string[]>([])
  const [mySchool, setMySchool] = useState<string | null>(null)
  const [allSchools, setAllSchools] = useState<string[]>([])
  const [prefsLoading, setPrefsLoading] = useState(false)
  const [prefsSaved, setPrefsSaved] = useState(false)
  const [prefsError, setPrefsError] = useState('')
  const [schoolPage, setSchoolPage] = useState(0)
  const SCHOOL_PAGE_SIZE = 10

  // allSchools 变化时重置页码到第一页
  useEffect(() => { setSchoolPage(0) }, [allSchools.length])

  // ── 历史数据状态 ──
  const [historyWeeks, setHistoryWeeks] = useState<WeekData[]>([])
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)

  // 加载当前周数据 + 历史数据（同时请求）
  const loadAllData = async () => {
    try {
      const [meRes, matchRes, inviteRes, histRes, settingsRes, prefsRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/match'),
        fetch('/api/invite'),
        fetch('/api/match/history'),
        fetch('/api/public-settings'),
        fetch('/api/match/preferences'),
      ])
      // 先解析 settings（认证检查需要 algorithmVersion）
      const settingsData: any = settingsRes.ok ? await settingsRes.json() : {}
      if (settingsData.algorithmVersion === 'v2') setSurveyPath('/survey-v2')

      // 检查认证
      if (!meRes.ok) { router.push('/login'); return }
      const meData = await meRes.json()
      if (!meData.user) { router.push('/login'); return }
      if (!meData.user.isAdmin && !meData.user.surveyCompleted) { router.push(settingsData.algorithmVersion === 'v2' ? '/survey-v2' : '/survey'); return }
      // 其他响应即使失败也继续处理（部分数据可能正常返回）
      // 用 as any 绕过 TS 严格模式对空对象 {} 的类型推导问题
      const matchData: any = matchRes.ok ? await matchRes.json() : {}
      const inviteData: any = inviteRes.ok ? await inviteRes.json() : {}
      const histData: any = histRes.ok ? await histRes.json() : {}
      const prefsData: any = prefsRes.ok ? await prefsRes.json() : {}
      setUser(meData.user)
      setMatchEnabled(meData.user.matchEnabled)
      if (matchRes.ok) {
        if (matchData.match) setMatch(matchData.match)
        if ('matchedDone' in matchData) setMatchedDone(matchData.matchedDone)
      }
      setInviteCodes(inviteData.available || [])
      // 学校匹配偏好
      if (prefsData.preferences) {
        setSchoolPrefs(prefsData.preferences)
        setMySchool(prefsData.school || null)
        setAllSchools(prefsData.allSchools || [])
      }
      // 历史数据
      if (histData.weeks) {
        setHistoryWeeks(histData.weeks)
        setSelectedWeekIndex(0)
      }
      // 邀请码功能开关
      if (typeof settingsData.inviteRequired === 'boolean') {
        setInviteRequired(settingsData.inviteRequired)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // 加载历史数据（单独调用，用于刷新）
  const loadHistoryData = async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/match/history')
      if (!res.ok) { setHistoryLoading(false); return }
      const data = await res.json()
      if (data.weeks) {
        setHistoryWeeks(data.weeks)
        setSelectedWeekIndex(0)
      }
    } catch (err) {
      console.error('[history]', err)
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    loadAllData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // 自动匹配触发
  const [autoMatchTriggered, setAutoMatchTriggered] = useState(false)

  useEffect(() => {
    if (!user?.surveyCompleted || autoMatchTriggered) return
    const tryAutoMatch = async () => {
      setAutoMatchTriggered(true)
      const now = new Date()
      const utcDay = now.getUTCDay()
      const utcHours = now.getUTCHours()
      if (utcDay !== 0 || utcHours < 4) return
      try {
        const csrfToken = getCsrfToken()
        const res = await fetch('/api/match/auto', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'done' || data.status === 'already_done') return
          console.warn('[autoMatch] 状态:', data.status, data.message)
        }
      } catch (err) {
        console.debug('[autoMatch] 触发失败:', err)
      }
    }
    const timer = setTimeout(tryAutoMatch, 2000)
    return () => clearTimeout(timer)
  }, [user?.surveyCompleted, autoMatchTriggered])

  // ═══ 匹配邮件通知触发（fire-and-forget，首位访客模式）═══
  const [notifyTriggered, setNotifyTriggered] = useState(false)

  useEffect(() => {
    if (!user?.id || notifyTriggered) return
    const tryNotify = async () => {
      setNotifyTriggered(true)
      try {
        const csrfToken = getCsrfToken()
        await fetch('/api/match/notify', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken },
        })
        // fire-and-forget：无论成功失败都不影响用户
      } catch (err) {
        console.debug('[match/notify] 触发失败:', err)
      }
    }
    const timer = setTimeout(tryNotify, 3000) // 比autoMatch稍晚，确保匹配先完成
    return () => clearTimeout(timer)
  }, [user?.id, notifyTriggered])

  // 刷新数据（当前+历史一起刷新）
  const handleRefresh = async () => {
    setRefreshing(true)
    await loadAllData()
  }

  const handleReveal = async () => {
    if (!match) return
    setRevealing(true)
    try {
      const csrfToken = getCsrfToken()
      const postRes = await fetch('/api/match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ matchId: match.id })
      })
      if (!postRes.ok) {
        const errData = await postRes.json().catch(() => null)
        alert(errData?.error || '揭晓失败，请稍后重试')
        setRevealing(false)
        return
      }
      const res = await fetch('/api/match')
      if (!res.ok) { setRevealing(false); return }
      const data = await res.json()
      if (data.match) setMatch(data.match)
    } catch {
      alert('网络错误，请稍后重试')
    }
    finally { setRevealing(false) }
  }

  const handleLogout = async () => {
    try {
      const csrfToken = getCsrfToken()
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      })
      router.push('/login')
    } catch {
      router.push('/login')
    }
  }

  const toggleMatch = async (enabled: boolean) => {
    setMatchEnabled(enabled)
    try {
      const csrfToken = getCsrfToken()
      await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ matchEnabled: enabled }),
      })
    } catch (e) { /* ignore */ }
  }

  // 全选 / 取消全选（保留自己的学校不被移除）
  const toggleAllSchools = (selectAll: boolean) => {
    const prev = [...schoolPrefs]
    const next = selectAll
      ? Array.from(new Set([...(mySchool ? [mySchool] : []), ...allSchools]))
      : (mySchool ? [mySchool] : [])
    setSchoolPrefs(next)
    saveSchoolPrefs(next, prev)
  }

  // 重置翻页到第一页
  const resetSchoolPage = () => { setSchoolPage(0) }

  const saveSchoolPrefs = async (selected: string[], previous: string[]) => {
    setPrefsError('')
    setPrefsSaved(false)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/match/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ schools: selected }),
      })
      const data = await res.json()
      if (!res.ok) {
        // 失败时回滚到之前的状态
        setSchoolPrefs(previous)
        setPrefsError(data.error || '保存失败')
        return
      }
      setPrefsSaved(true)
      setTimeout(() => setPrefsSaved(false), 2000)
    } catch {
      // 网络失败也回滚
      setSchoolPrefs(previous)
      setPrefsError('网络错误')
    }
  }

  const handleChangePassword = async () => {
    if (!pwdForm.oldPwd || !pwdForm.newPwd || !pwdForm.confirmPwd) {
      setPwdMsg({ msg: '请填写完整', type: 'error' }); return
    }
    if (pwdForm.newPwd !== pwdForm.confirmPwd) {
      setPwdMsg({ msg: '两次输入的新密码不一致', type: 'error' }); return
    }
    // 与后端 validatePassword 规则保持一致：≥8位 + 含字母和数字
    if (pwdForm.newPwd.length < 8) {
      setPwdMsg({ msg: '新密码至少8个字符', type: 'error' }); return
    }
    if (!/[a-zA-Z]/.test(pwdForm.newPwd) || !/[0-9]/.test(pwdForm.newPwd)) {
      setPwdMsg({ msg: '密码必须包含字母和数字', type: 'error' }); return
    }
    setPwdSaving(true)
    setPwdMsg(null)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          currentPassword: pwdForm.oldPwd,
          newPassword: pwdForm.newPwd,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setPwdMsg({ msg: '✅ 密码修改成功！下次登录使用新密码', type: 'success' })
        setTimeout(() => { setShowChangePwd(false); setPwdForm({ oldPwd: '', newPwd: '', confirmPwd: '' }) }, 2000)
      } else {
        setPwdMsg({ msg: data.error || '修改失败，请检查旧密码是否正确', type: 'error' })
      }
    } catch {
      setPwdMsg({ msg: '网络错误，请重试', type: 'error' })
    } finally {
      setPwdSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-stone-50 flex items-center justify-center">
        <div className="text-center"><div className="text-5xl mb-4 animate-bounce">🎁</div><p className="text-gray-400">加载中...</p></div>
      </div>
    )
  }

  // 当前选中周的候选人数
  const currentWeek = historyWeeks[selectedWeekIndex]
  const currentMatches = currentWeek?.matches || []

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-stone-50">
      <nav className="flex items-center justify-between px-3 py-2.5 max-w-4xl mx-auto">
        <div className="flex items-center gap-1 min-w-0">
          <img src="/logo.png" alt="吉我爱" className="w-7 h-7 shrink-0" />
          <span className="font-bold text-base gradient-text hidden sm:inline">吉我爱</span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {user?.isAdmin && (
            <Link href="/admin" className="inline-flex px-2.5 py-1 text-xs text-pink-600 border border-pink-200 rounded-full hover:bg-pink-50 transition whitespace-nowrap">管理</Link>
          )}
          <Link href="/"
            className="text-xs px-2 py-1 text-gray-500 border border-gray-200 rounded-full hover:text-pink-600 hover:border-pink-200 hover:bg-pink-50 transition"
            title="返回首页">
            🏠 首页
          </Link>
          <button onClick={handleRefresh}
            className={`text-xs px-2 py-1 border rounded-full transition ${
              refreshing ? 'animate-spin text-pink-400 border-pink-200' : 'text-pink-500 hover:text-pink-600 border-pink-200 hover:bg-pink-50'
            }`}
            title="刷新">
            {refreshing ? '...' : '🔄'}
          </button>
          <Link href={surveyPath}
            className="text-xs px-3 py-1.5 text-pink-600 border border-pink-300 rounded-full hover:bg-pink-50 hover:border-pink-400 transition font-medium"
            title="重新填写问卷">
            📝 重新答题
          </Link>
          <button onClick={() => setShowChangePwd(true)}
            className="text-xs px-2 py-1 text-blue-500 border border-blue-200 rounded-full hover:text-blue-600 hover:bg-blue-50 transition"
            title="修改密码">
            🔐
          </button>
          <button onClick={handleLogout}
            className="text-xs px-2.5 py-1 text-red-400 border border-red-200 rounded-full hover:text-red-600 hover:bg-red-50 transition"
            title="退出登录">
            退出
          </button>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* ════════════════ 当前匹配状态 ════════════════ */}
        {match ? (
          <div className="glass-card rounded-3xl p-8 shadow-xl animate-fade-in">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">💌</div>
              <h2 className="text-2xl font-bold text-gray-800">本周匹配结果</h2>
              <p className="text-sm text-gray-400 mt-1">{match.weekKey}</p>
            </div>

            <div className="bg-gradient-to-r from-pink-50 to-stone-50 rounded-2xl p-6 mb-6 text-center">
              <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-pink-300 to-stone-400 rounded-full flex items-center justify-center text-3xl text-white shadow-lg">
                {match.partnerNickname[0]}
              </div>
              <h3 className="text-xl font-bold text-gray-800">{match.partnerNickname}</h3>
              {match.partnerSchool && (
                <p className="text-sm text-pink-500 mt-0.5">🏫 {match.partnerSchool}</p>
              )}
              <div className="flex items-center justify-center gap-2 mt-1">
                <div className="text-3xl font-bold gradient-text">{match.score}%</div>
                <span className="text-gray-400 text-sm">契合度</span>
              </div>
            </div>

            {match.dimScores && match.dimScores.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm font-medium text-gray-500 mb-3">📊 契合度</h4>
                <div className="space-y-3">
                  {match.dimScores.map((dim, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-20 text-right">{dim.name}</span>
                      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r ${DIM_COLORS[dim.name] || 'from-pink-400 to-stone-400'} transition-all duration-1000`}
                          style={{ width: `${dim.score}%` }} />
                      </div>
                      <span className={`text-sm font-bold ${dim.score >= 70 ? 'text-green-500' : dim.score >= 50 ? 'text-yellow-500' : 'text-red-400'}`}>
                        {dim.score}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-500 mb-3">为什么匹配到TA？</h4>
              <div className="space-y-2">
                {match.reasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="text-pink-400">•</span><span>{r}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Reveal Contact */}
            {!match.iRevealed ? (
              <div>
                {!match.selfHasContact && (
                  <div className="mb-3 text-center py-2 px-4 bg-stone-100 rounded-xl border border-stone-300">
                    <p className="text-sm text-stone-600">⚠️ 请先填写你自己的联系方式，才能查看对方的</p>
                  </div>
                )}
                <button onClick={handleReveal} disabled={revealing || !match.selfHasContact}
                  className={`w-full py-4 font-semibold bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] rounded-2xl transition text-lg text-[#8b4a54] ${
                    !match.selfHasContact ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
                  }`}>
                  {revealing ? '确认中...' : '🤝 我愿意交换联系方式'}
                </button>
              </div>
            ) : !match.partnerRevealed ? (
              <div className="text-center py-4 px-6 bg-yellow-50 rounded-2xl border border-yellow-200">
                <p className="text-yellow-700 font-medium">你已确认 ✓</p>
                <p className="text-sm text-yellow-600 mt-1">等待对方也确认后即可看到联系方式</p>
              </div>
            ) : match.contact ? match.contact.empty ? (
              <div className="text-center py-4 px-6 bg-gray-50 rounded-2xl border border-gray-200">
                <p className="text-gray-500 font-medium">😅 对方暂未填写联系方式</p>
                <p className="text-xs text-gray-400 mt-1">可以等对方补充后再来查看</p>
              </div>
            ) : match.contact.decryptError ? (
              <div className="bg-green-50 rounded-2xl p-6 border border-green-200 text-center">
                <p className="text-green-600 font-medium mb-2">🎉 双方已确认！</p>
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="text-sm text-red-400">联系方式解密失败</p>
                  <p className="text-sm text-gray-400 mt-1">请联系管理员处理</p>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 rounded-2xl p-6 border border-green-200 text-center">
                <p className="text-green-600 font-medium mb-2">🎉 双方已确认！</p>
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="text-sm text-gray-400">
                    {match.contact.type === 'wechat' ? '微信号' : match.contact.type === 'qq' ? 'QQ号' : '联系方式'}
                  </p>
                  <p className="text-xl font-bold text-gray-800 mt-1">{match.contact.info}</p>
                </div>
                <p className="text-xs text-green-500 mt-3">去加好友吧！聊聊看合不合拍 ☕</p>
              </div>
            ) : null}

            {match.iRevealed && match.partnerRevealed && match.partnerSurvey && (
              <PartnerAnswers survey={match.partnerSurvey} nickname={match.partnerNickname} />
            )}

            {/* 仍在匹配池提示 */}
            <div className="mt-6 pt-5 border-t border-pink-100">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-3 bg-blue-50/80 rounded-xl border border-blue-200 gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔄</span>
                  <div>
                    <p className="text-sm font-medium text-blue-700">你仍在匹配池中</p>
                    <p className="text-xs text-blue-500">下一轮匹配结果将在周日 20:00 揭晓</p>
                  </div>
                </div>
                <MatchCountdown />
              </div>
            </div>
          </div>
        ) : matchedDone ? (
          <div className="glass-card rounded-3xl p-10 shadow-xl text-center animate-fade-in interactive-card">
            <div className="text-6xl mb-4">🍃</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-3">本周暂未匹配到搭档</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">
              本周参与匹配的同学中，暂时没有找到和你契合度较高的搭档<br />别灰心，缘分可能就在下一周 🌟
            </p>
            <MatchCountdown />
            <div className="mt-8 flex items-center justify-center gap-4">
              <Link href={surveyPath} className="px-6 py-2.5 bg-gradient-to-r from-pink-400 to-rose-400 text-white rounded-xl text-sm font-medium hover:shadow-lg transition-all">
                📝 调整问卷答案
              </Link>
            </div>
          </div>
        ) : (
          <div className="glass-card rounded-3xl p-10 shadow-xl text-center animate-fade-in interactive-card">
            <div className="text-6xl mb-4">🔮</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-3">你的缘分在路上</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">
              问卷已提交，系统正在为你寻找最佳匹配<br />
              匹配结果将在每周日 <span className="font-bold text-pink-600">20:00</span> 准时揭晓
            </p>
            <MatchCountdown />
            <div className="mt-8 flex items-center justify-center gap-4">
              <Link href={surveyPath} className="px-6 py-2.5 bg-gradient-to-r from-pink-400 to-rose-400 text-white rounded-xl text-sm font-medium hover:shadow-lg transition-all">
                📝 重新填写问卷
              </Link>
            </div>
          </div>
        )}

        {/* ════════════════ 历史候选人（仅无当前匹配时显示） ════════════════ */}
        {!match && (historyWeeks.length > 0 || historyLoading) && (
          <CandidateHistoryInline
            weeks={historyWeeks}
            selectedIndex={selectedWeekIndex}
            onSelectIndex={setSelectedWeekIndex}
            loading={historyLoading}
            onRefresh={() => loadHistoryData()}
          />
        )}

        {/* Match Toggle */}
        <div className="mt-8 glass-card rounded-3xl p-6 shadow-lg interactive-card animate-fade-in" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{matchEnabled ? '🎯' : '⏸️'}</span>
              <div>
                <h3 className="font-semibold text-gray-800">参与匹配</h3>
                <p className="text-xs text-gray-400">{matchEnabled ? '你正在参与每周匹配' : '已暂停，不会被匹配到'}</p>
              </div>
            </div>
            <button onClick={() => toggleMatch(!matchEnabled)}
              className={`w-12 h-7 rounded-full transition-colors ${matchEnabled ? 'bg-[#FFB6B6]' : 'bg-gray-300'}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${matchEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {/* School Match Preferences */}
        {allSchools.length > 0 && (() => {
          const totalPages = Math.ceil(allSchools.length / SCHOOL_PAGE_SIZE)
          const pageStart = schoolPage * SCHOOL_PAGE_SIZE
          const pageEnd = pageStart + SCHOOL_PAGE_SIZE
          const visibleSchools = allSchools.slice(pageStart, pageEnd)
          const isAllSelected = allSchools.every(s => schoolPrefs.includes(s))
          return (
        <div className="mt-4 glass-card rounded-3xl p-6 shadow-lg animate-fade-in" style={{ animationDelay: '150ms' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏫</span>
              <div>
                <h3 className="font-semibold text-gray-800">匹配学校偏好</h3>
                <p className="text-xs text-gray-400">
                  {mySchool ? `你来自「${mySchool}」` : '选择你想匹配的学校'}
                  · 只会与选中学校的同学配对
                  {totalPages > 1 && <span className="ml-1">（{schoolPrefs.length}/{allSchools.length}）</span>}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => toggleAllSchools(!isAllSelected)}
                disabled={prefsLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-pink-300 text-pink-600 bg-pink-50 hover:bg-pink-100 transition-colors disabled:opacity-50"
              >
                {isAllSelected ? '取消全选' : '全选'}
              </button>
            </div>
          </div>
          <div className="space-y-2.5">
            {visibleSchools.map((school) => {
              const isMySchool = school === mySchool
              // 无需校内邮箱的学校（GPS验证即可），可能存在校外人员
              const NO_EMAIL_SCHOOLS = new Set([
                '吉林动画学院', '吉林艺术学院',
                '吉林农业大学', '吉林工程技术师范学院',
                '长春师范大学', '吉林财经大学', '吉林体育学院', '吉林工商学院',
                '长春工程学院', '吉林警察学院', '长春汽车职业技术大学',
                '长春职业技术大学',
                '长春光华学院', '长春工业大学人文信息学院', '长春电子科技学院',
                '长春财经学院', '吉林建筑科技学院', '长春建筑学院',
                '长春科技学院', '长春大学旅游学院', '长春人文学院', '长春中医药大学',
              ])
              const isSpecial = NO_EMAIL_SCHOOLS.has(school)
              const checked = schoolPrefs.includes(school)
              return (
                <label
                  key={school}
                  className={`flex items-center gap-3 cursor-pointer rounded-xl px-4 py-3 transition-all border ${
                    checked
                      ? 'bg-pink-50 border-pink-200'
                      : 'bg-white/50 border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const newPrefs = e.target.checked
                        ? [...schoolPrefs, school]
                        : schoolPrefs.filter(s => s !== school)
                      const prev = [...schoolPrefs]
                      setSchoolPrefs(newPrefs)
                      saveSchoolPrefs(newPrefs, prev)
                    }}
                    disabled={isMySchool || prefsLoading}
                    className="w-4 h-4 rounded border-gray-300 text-pink-500 focus:ring-pink-400"
                  />
                  <span className={`flex-1 text-sm ${isMySchool ? 'font-medium text-pink-700' : 'text-gray-700'}`}>
                    {school}
                    {isMySchool && school !== '吉林动画学院' && <span className="ml-1.5 text-xs bg-pink-100 text-pink-600 px-1.5 py-0.5 rounded-full">我的学校</span>}
                    {isSpecial && school !== '吉林动画学院' && (
                      <span className="ml-1.5 text-xs text-stone-500 font-normal">
                        （可能有校外人员参加）
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={() => setSchoolPage(p => Math.max(0, p - 1))}
                disabled={schoolPage === 0 || prefsLoading}
                className="w-8 h-8 rounded-full bg-white/60 border border-gray-200 text-gray-600 text-sm hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                ‹
              </button>
              <span className="text-xs text-gray-500 min-w-[3rem] text-center">
                {schoolPage + 1} / {totalPages}
              </span>
              <button
                onClick={() => setSchoolPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={schoolPage === totalPages - 1 || prefsLoading}
                className="w-8 h-8 rounded-full bg-white/60 border border-gray-200 text-gray-600 text-sm hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                ›
              </button>
            </div>
          )}
          {prefsError && <p className="mt-3 text-xs text-red-500">{prefsError}</p>}
          {prefsSaved && (
            <p className="mt-3 text-xs text-green-500 flex items-center gap-1">
              ✅ 已保存
            </p>
          )}
        </div>
          )
        })()}

        {/* Invite Codes — 仅在开启时显示 */}
        {inviteRequired && (
        <div className="mt-4 glass-card rounded-3xl p-6 shadow-lg">
          <button onClick={() => setShowInvite(!showInvite)} className="w-full flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📨</span>
              <div className="text-left">
                <h3 className="font-semibold text-gray-800">我的邀请码</h3>
                <p className="text-xs text-gray-400">你还剩 {inviteCodes.length} 个可用邀请码</p>
              </div>
            </div>
            <span className="text-gray-400">{showInvite ? '收起' : '展开'}</span>
          </button>
          {showInvite && (
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
              {inviteCodes.length > 0 ? inviteCodes.map((c, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                  <code className="text-sm font-mono font-bold text-pink-600">{c.code}</code>
                  <button onClick={async () => { const ok = await safeCopy(c.code); if (!ok) alert('复制失败') }}
                    className="text-xs text-gray-400 hover:text-pink-500 transition">复制</button>
                </div>
              )) : <p className="text-sm text-gray-400 text-center py-4">邀请码已用完</p>}
              <p className="text-xs text-gray-400 mt-2">邀请码发给你信任的同学，让他们也能加入</p>
            </div>
          )}
        </div>
        )}

        {/* Contact Settings */}
        <div className="mt-4 glass-card rounded-3xl p-6 shadow-lg">
          <ContactSettings user={user} />
        </div>

        {/* ═══ 修改密码弹窗 ═══ */}
        {showChangePwd && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setShowChangePwd(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-modal-in" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-gray-800">🔐 修改密码</h3>
                <button onClick={() => setShowChangePwd(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
              </div>

              {pwdMsg && (
                <div className={`mb-3 p-2.5 rounded-xl text-sm ${pwdMsg.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                  {pwdMsg.msg}
                </div>
              )}

              <div className="space-y-3">
                <input type="password" placeholder="当前密码" value={pwdForm.oldPwd}
                  onChange={e => setPwdForm(p => ({ ...p, oldPwd: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <input type="password" placeholder="新密码（至少8位，含字母+数字）" value={pwdForm.newPwd}
                  onChange={e => setPwdForm(p => ({ ...p, newPwd: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <input type="password" placeholder="确认新密码" value={pwdForm.confirmPwd}
                  onChange={e => setPwdForm(p => ({ ...p, confirmPwd: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />

                <div className="flex gap-2 pt-1">
                  <button onClick={() => setShowChangePwd(false)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition">
                    取消
                  </button>
                  <button onClick={handleChangePassword} disabled={pwdSaving}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-sky-500 rounded-xl hover:opacity-90 transition disabled:opacity-50">
                    {pwdSaving ? '...' : '确认修改'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  历史候选人内联组件（直接显示在当前状态下方）
// ══════════════════════════════════════════════════════════════

function CandidateHistoryInline({
  weeks, selectedIndex, onSelectIndex, loading, onRefresh,
}: {
  weeks: WeekData[]; selectedIndex: number; onSelectIndex: (i: number) => void;
  loading: boolean; onRefresh: () => void
}) {
  if (loading) {
    return (
      <div className="mt-8 glass-card rounded-3xl p-8 shadow-xl text-center animate-fade-in">
        <div className="text-4xl mb-3 animate-bounce">🌍</div>
        <p className="text-gray-400">加载历史候选人...</p>
      </div>
    )
  }

  if (weeks.length === 0) return null

  const currentWeek = weeks[selectedIndex]
  const matches = currentWeek.matches
  const totalCandidates = weeks.reduce((sum, w) => sum + w.totalMatches, 0)

  return (
    <div className="mt-10">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">🕰️ 历史候选人</h2>
        <span className="text-xs text-gray-400">{totalCandidates} 位</span>
      </div>

      {/* 周 Tab 切换 */}
      {weeks.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-2 mb-4 scrollbar-hide">
          {weeks.map((wk, idx) => (
            <button key={wk.weekKey} onClick={() => onSelectIndex(idx)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition whitespace-nowrap border ${
                idx === selectedIndex
                  ? 'bg-green-50 text-green-700 border-green-200 shadow-sm'
                  : 'bg-white/60 text-gray-500 border-gray-200 hover:border-pink-200 hover:text-pink-600'
              }`}>
              <span className="mr-1">📅</span>{wk.weekKey}
              {wk.isCurrent && <span className="ml-1 text-xs">✨</span>}
            </button>
          ))}
        </div>
      )}

      {/* 候选人卡片列表 */}
      <div className="glass-card rounded-2xl p-5 shadow-xl animate-fade-in">
        {currentWeek.revealedCount > 0 && (
          <div className="inline-flex items-center gap-1 px-3 py-1 bg-green-50 text-green-600 text-xs font-medium rounded-full border border-green-200 mb-4">
            <span>✉️</span> {currentWeek.revealedCount} 位已揭示
          </div>
        )}
        <div className="space-y-2.5">
          {matches.map((m) => (
            <CandidateCard key={m.id} match={m} weekKey={currentWeek.weekKey} />
          ))}
          {currentWeek.totalMatches === 0 && (
            <p className="text-center text-sm text-gray-400 py-6">该周暂无匹配记录</p>
          )}
        </div>
      </div>
    </div>
  )
}

// 单个候选人卡片
function CandidateCard({ match, weekKey }: { match: HistoryMatch; weekKey: string }) {
  const [expanded, setExpanded] = useState(false)

  // 取最高分的维度作为描述
  const topDim = match.dimScores?.slice().sort((a, b) => b.score - a.score)[0]

  // 头像颜色：已揭示用粉色系，未揭示用灰色系
  const avatarBg = match.bothRevealed
    ? 'bg-gradient-to-br from-pink-300 to-stone-400'
    : 'bg-gradient-to-br from-gray-200 to-gray-300'

  // 头像图标：已揭示显示爱心，未揭示显示问号
  const avatarIcon = match.bothRevealed ? '💕' : '❓'

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 hover:border-pink-200 transition bg-white/60">
      {/* 卡片头部（可点击展开） */}
      <div
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-4 p-4 cursor-pointer transition ${
          expanded ? 'bg-pink-50/80' : 'hover:bg-pink-50/40'
        }`}
      >
        {/* 头像 */}
        <div className={`w-12 h-12 ${avatarBg} rounded-full flex items-center justify-center text-xl shadow-sm shrink-0`}>
          {match.bothRevealed ? match.partnerNickname[0] : avatarIcon}
        </div>

        {/* 基本信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-800 truncate">
              {(match.partnerGender === 'female' ? '女' : match.partnerGender === 'male' ? '男' : '')}
              {' · '}{match.partnerNickname}
            </span>
            {match.partnerSchool && (
              <span className="text-xs text-pink-400 shrink-0">🏫 {match.partnerSchool}</span>
            )}
            {/* 状态标签 */}
            {match.bothRevealed ? (
              <span className="px-2 py-0.5 text-xs font-medium bg-green-50 text-green-600 rounded-full border border-green-200">已揭示</span>
            ) : match.hidden ? (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-500 rounded-full border border-blue-200">等待揭晓</span>
            ) : match.iRevealed ? (
              <span className="px-2 py-0.5 text-xs font-medium bg-yellow-50 text-yellow-600 rounded-full border border-yellow-200">等待对方</span>
            ) : null}
          </div>
          {!match.hidden && (
            <p className="text-sm text-gray-500 mt-0.5 truncate">
              {topDim ? `你们在「${topDim.name}」维度上高度契合` : ''}
            </p>
          )}
          {match.hidden && (
            <p className="text-sm text-gray-400 mt-0.5">匹配结果尚未揭晓，请耐心等待</p>
          )}
        </div>

        {/* 分数 */}
        <div className="shrink-0 text-right">
          <div className={`text-2xl font-bold ${match.bothRevealed ? 'gradient-text' : 'text-gray-400'}`}>
            {match.hidden ? '?' : `${match.score}%`}
          </div>
        </div>

        {/* 展开箭头 */}
        <svg className={`w-4 h-4 text-gray-300 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* ═══ 展开详情（和当周匹配展示一致）═══ */}
      {expanded && !match.hidden && (
        <div className="px-5 pb-5 animate-fade-in border-t border-pink-100">

          {/* 五维度契合度 */}
          {match.dimScores && match.dimScores.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-500 mb-3">📊 契合度</h4>
              <div className="space-y-3">
                {match.dimScores.map((dim, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-20 text-right">{dim.name}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full bg-gradient-to-r ${DIM_COLORS[dim.name] || 'from-pink-400 to-stone-400'} transition-all duration-700`}
                        style={{ width: `${dim.score}%` }} />
                      </div>
                    <span className={`text-sm font-bold ${dim.score >= 70 ? 'text-green-500' : dim.score >= 50 ? 'text-yellow-500' : 'text-red-400'}`}>
                      {dim.score}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 匹配原因 */}
          {match.reasons && match.reasons.length > 0 && (
            <div className="mt-5">
              <h4 className="text-sm font-medium text-gray-500 mb-3">💡 为什么匹配到TA？</h4>
              <div className="space-y-2">
                {match.reasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="text-pink-400 mt-0.5">•</span><span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 联系方式区域 */}
          {!match.iRevealed ? (
            <div className="mt-5">
              <p className="text-center py-3 px-4 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-400">
                点击「确认交换」后可查看联系方式
              </p>
            </div>
          ) : !match.partnerRevealed ? (
            <div className="mt-5 text-center py-3 px-4 bg-yellow-50 rounded-xl border border-yellow-200">
              <p className="text-sm text-yellow-700 font-medium">你已确认 ✓ 等待对方确认</p>
            </div>
          ) : match.contact && !match.contact.empty && !match.contact.decryptError ? (
            <div className="mt-5 bg-green-50 rounded-xl p-4 border border-green-200 text-center">
              <p className="text-green-600 font-medium text-sm mb-1">🎉 双方已确认！</p>
              <div className="bg-white rounded-lg p-3 shadow-sm inline-block">
                <p className="text-xs text-gray-400">
                  {match.contact.type === 'wechat' ? '微信号' : match.contact.type === 'qq' ? 'QQ号' : '联系方式'}
                </p>
                <p className="text-lg font-bold text-gray-800 mt-0.5">{match.contact.info}</p>
              </div>
            </div>
          ) : match.contact?.empty ? (
            <div className="mt-5 text-center py-3 px-4 bg-gray-50 rounded-xl border border-gray-200">
              <p className="text-sm text-gray-400">😅 对方暂未填写联系方式</p>
            </div>
          ) : null}

        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  对方问卷回答展示组件（双方确认后可见）
// ══════════════════════════════════════════════════════════════
function PartnerAnswers({ survey, nickname }: { survey: any; nickname: string }) {
  const [expanded, setExpanded] = useState(false)

  const parseMulti = (val: string | null | undefined): string[] => {
    if (!val) return []
    try { return JSON.parse(val) } catch { return [] }
  }

  const questions = useMemo(() => {
    const QUESTIONS = [
      { key: 'q1', dim: '性格底色', type: 'choice' as const, q: '你正忙着做一件特别重要的事，旁边的人反复打断你，你最真实的第一反应更接近？' },
      { key: 'q2', dim: '性格底色', type: 'choice' as const, q: '恋爱后，对方提出"想互相知道手机密码、实时共享定位"，你更接近？' },
      { key: 'q3', dim: '性格底色', type: 'choice' as const, q: '吵架时，你最担心自己会变成哪一种？' },
      { key: 'q4', dim: '性格底色', type: 'choice' as const, q: '如果你的朋友和别人起了严重冲突，而你知道朋友不一定占理，你通常会？' },
      { key: 'q5', dim: '性格底色', type: 'choice' as const, q: '路上看到一只脏兮兮、明显状态不好的流浪猫一直跟着你叫，你第一反应更像？' },
      { key: 'q6', dim: '性格底色', type: 'choice' as const, q: '对方说"今天有点累，想自己待一会儿，不太想聊天"，你更可能？' },
      { key: 'q7', dim: '性格底色', type: 'choice' as const, q: '你在团队作业里发现，只要稍微钻点空子就能少做很多事，还不容易被发现，你更可能？' },
      { key: 'q8', dim: '性格底色', type: 'choice' as const, q: '现在生活费不算宽裕，但你特别想买一个远超自己消费能力的东西，你更可能？' },
      { key: 'q9', dim: '自我观察', type: 'choice' as const, q: '遇到很讨厌的人或特别委屈的事，你心里会不会冒出不太体面的想法？' },
      { key: 'q10', dim: '自我观察', type: 'choice' as const, q: '如果一定要承认自己在关系里的一个缺点，你更像？' },
      { key: 'q11', dim: '自我观察', type: 'choice' as const, q: '你做这套题的真实心态更接近？' },
      { key: 'q12', dim: '自我观察', type: 'choice' as const, q: '如果你拿到一笔 3000 元的意外收入，你更倾向？' },
      { key: 'q13', dim: '自我观察', type: 'choice' as const, q: '如果你刚决定"这笔钱先存着"，结果第二天你最喜欢的一个绝版东西出现了，而且正好花光这笔钱，你更可能？' },
      { key: 'q14', dim: '自我观察', type: 'choice' as const, q: '你不小心做错事让别人很难堪，你第一反应更像？' },
      { key: 'q15', dim: '人生方向', type: 'choice' as const, q: '原计划周末去学一项对自己很重要的东西，朋友突然喊你马上出去玩，你更可能？' },
      { key: 'q16', dim: '人生方向', type: 'choice' as const, q: '你更希望另一半是什么样的人？' },
      { key: 'q17', dim: '人生方向', type: 'choice' as const, q: '你更能接受哪种"有缺点但能相处"的室友？' },
      { key: 'q18', dim: '人生方向', type: 'choice' as const, q: '对热点争议事件，你通常更接近？' },
      { key: 'q19', dim: '人生方向', type: 'choice' as const, q: '两个人在一起，你最不能接受哪种"不在一个频道"？' },
      { key: 'q20', dim: '人生方向', type: 'choice' as const, q: '你更认同哪句话？' },
      { key: 'q21', dim: '人生方向', type: 'choice' as const, q: '如果有一段关系需要你改变很多，你会怎么看？' },
      { key: 'q22', dim: '相处之道', type: 'choice' as const, q: '对方很委屈很难过时，你下意识更像？' },
      { key: 'q23', dim: '相处之道', type: 'choice' as const, q: '你对"分享日常"的理想频率更接近？' },
      { key: 'q24', dim: '相处之道', type: 'choice' as const, q: '一起旅行时，你最理想的相处方式？' },
      { key: 'q25', dim: '相处之道', type: 'choice' as const, q: '面对严重分歧，你更像哪种状态？' },
      { key: 'q26', dim: '相处之道', type: 'choice' as const, q: '如果这次争执里你受伤了，你更可能怎么处理？' },
      { key: 'q27', dim: '相处之道', type: 'choice' as const, q: '你更能接受哪种表达爱的方式？' },
      { key: 'q28', dim: '相处之道', type: 'choice' as const, q: '当你不开心时，你更希望对方怎么做？' },
      { key: 'q29', dim: '生活节奏', type: 'choice' as const, q: '你的周末通常更接近？' },
      { key: 'q30', dim: '生活节奏', type: 'choice' as const, q: '你对居住环境的要求更接近？' },
      { key: 'q31', dim: '生活节奏', type: 'choice' as const, q: '你怎么看待恋爱中的日常开销？' },
      { key: 'q32', dim: '生活节奏', type: 'choice' as const, q: '你的社交能量更像？' },
      { key: 'q33', dim: '个人画像', type: 'multi' as const, q: '选出你觉得自己的 3 个优点（可少选）' },
      { key: 'q34', dim: '个人画像', type: 'multi' as const, q: '选出你觉得自己的 3 个缺点（可少选）' },
      { key: 'q35', dim: '个人画像', type: 'text' as const, q: '如果用一种食物来比喻你理想中的恋爱关系，会是什么？为什么？' },
      { key: 'q36', dim: '破冰参考', type: 'text' as const, q: '刚认识一个人时，你通常在哪些地方会比较不自在？' },
      { key: 'q37', dim: '破冰参考', type: 'text' as const, q: '刚开始聊天时，你更舒服的聊天节奏是？' },
      // H 模块：联系方式与聊天能力（V2 才有）
      { key: 'q38', dim: '联系方式与聊天能力', type: 'choice' as const, q: '匹配成功并看到对方联系方式后，你通常会？' },
      { key: 'q39', dim: '联系方式与聊天能力', type: 'choice' as const, q: '加上对方后，第一句话你更可能？' },
      { key: 'q40', dim: '联系方式与聊天能力', type: 'choice' as const, q: '你觉得加联系方式后，谁更应该先开口？' },
      { key: 'q41', dim: '联系方式与聊天能力', type: 'choice' as const, q: '如果你对 TA 有好感，但不知道聊什么，你会？' },
      { key: 'q42', dim: '联系方式与聊天能力', type: 'choice' as const, q: '对方只回了很短一句，比如"哈哈""还行"，你会？' },
      { key: 'q43', dim: '联系方式与聊天能力', type: 'choice' as const, q: '如果聊天突然冷场，你通常会？' },
      { key: 'q44', dim: '联系方式与聊天能力', type: 'multi' as const, q: '你平时最容易聊起来的话题是？（最多选 5 个）' },
      { key: 'q45', dim: '联系方式与聊天能力', type: 'multi' as const, q: '你刚认识时最不喜欢别人聊什么？（最多选 4 个）' },
      { key: 'q46', dim: '联系方式与聊天能力', type: 'choice' as const, q: '别人主动找你聊天，但话题有点普通，你会？' },
      { key: 'q47', dim: '联系方式与聊天能力', type: 'choice' as const, q: '如果对方分享了日常照片、作品或最近在做的事，你会？' },
      { key: 'q48', dim: '联系方式与聊天能力', type: 'choice' as const, q: '你更舒服的聊天频率是？' },
      { key: 'q49', dim: '联系方式与聊天能力', type: 'choice' as const, q: '你对回复速度的真实状态更接近？' },
      { key: 'q50', dim: '联系方式与聊天能力', type: 'choice' as const, q: '如果你发现自己不太会聊天，你愿意改进吗？' },
      { key: 'q51', dim: '联系方式与聊天能力', type: 'choice' as const, q: '你加人后的主要目的更接近？' },
      { key: 'q52', dim: '联系方式与聊天能力', type: 'choice' as const, q: '如果对方没有主动找你聊天，你会怎么想？' },
      { key: 'q53', dim: '联系方式与聊天能力', type: 'choice' as const, q: '你更擅长哪种聊天方式？' },
      { key: 'q54', dim: '联系方式与聊天能力', type: 'choice' as const, q: '你希望对方更擅长哪种聊天方式？' },
      { key: 'q55', dim: '联系方式与聊天能力', type: 'choice' as const, q: '刚加上时，你能接受多快线下见面？' },
      { key: 'q56', dim: '联系方式与聊天能力', type: 'choice' as const, q: '如果对方很快约你见面，你会？' },
      { key: 'q57', dim: '联系方式与聊天能力', type: 'choice' as const, q: '你能接受对方不太会聊天，但态度真诚吗？' },
      { key: 'q58', dim: '联系方式与聊天能力', type: 'text' as const, q: '请写 3 个别人可以自然和你开聊的入口' },
    ]
    return QUESTIONS
  }, [])

  return (
    <div className="mt-6 border-t border-gray-100 pt-6">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left group">
        <h4 className="text-sm font-medium text-gray-500 group-hover:text-pink-600 transition">
          📝 查看{nickname}的问卷回答
        </h4>
        <span className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-5 animate-fade-in">
          {questions.map((q, idx) => {
            if (q.type === 'multi') {
              const items = parseMulti(survey[q.key])
              if (items.length === 0) return (
                <div key={q.key} className="bg-gray-50 rounded-xl p-4 shadow-sm opacity-60">
                  <div className="flex items-start gap-2 mb-3">
                    <span className="text-xs font-bold text-gray-400 bg-white px-2 py-0.5 rounded-full mt-0.5">{idx + 1}</span>
                    <p className="text-sm font-medium text-gray-800 leading-relaxed">{q.q}</p>
                  </div>
                  <p className="text-xs text-gray-400 mb-2 ml-6">✨ {q.dim} · TA 的回答</p>
                  <p className="ml-6 text-sm text-gray-400 italic">未作答</p>
                </div>
              )
              return (
                <div key={q.key} className="bg-gradient-to-r from-stone-50 to-pink-50 rounded-xl p-4 shadow-sm">
                  <div className="flex items-start gap-2 mb-3">
                    <span className="text-xs font-bold text-pink-500 bg-white px-2 py-0.5 rounded-full mt-0.5">{idx + 1}</span>
                    <p className="text-sm font-medium text-gray-800 leading-relaxed">{q.q}</p>
                  </div>
                  <p className="text-xs text-gray-400 mb-2 ml-6">✨ {q.dim} · TA 的回答</p>
                  <div className="flex flex-wrap gap-2 ml-6">
                    {items.map((item, i) => (
                      <span key={i} className="px-3 py-1.5 bg-white rounded-lg text-sm text-pink-600 font-medium shadow-sm border border-pink-100">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )
            }
            const val = survey[q.key]
            if (!val?.trim()) return (
              <div key={q.key} className="bg-gray-50 rounded-xl p-4 shadow-sm opacity-60">
                <div className="flex items-start gap-2 mb-3">
                  <span className="text-xs font-bold text-gray-400 bg-white px-2 py-0.5 rounded-full mt-0.5">{idx + 1}</span>
                  <p className="text-sm font-medium text-gray-800 leading-relaxed">{q.q}</p>
                </div>
                <p className="text-xs text-gray-400 mb-2 ml-6">💬 {q.dim} · TA 的回答</p>
                <p className="ml-6 text-sm text-gray-400 italic">未作答</p>
              </div>
            )
            return (
              <div key={q.key} className="bg-gray-50 rounded-xl p-4 shadow-sm">
                <div className="flex items-start gap-2 mb-3">
                  <span className="text-xs font-bold text-blue-500 bg-white px-2 py-0.5 rounded-full mt-0.5">{idx + 1}</span>
                  <p className="text-sm font-medium text-gray-800 leading-relaxed">{q.q}</p>
                </div>
                <p className="text-xs text-gray-400 mb-2 ml-6">💬 {q.dim} · TA 的回答</p>
                <div className="ml-6 px-4 py-3 bg-white rounded-lg border border-gray-100">
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{val}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ContactSettings({ user }: { user: any }) {
  const [contactType, setContactType] = useState(user?.contactType || 'wechat')
  const [contactInfo, setContactInfo] = useState(user?.contactInfo || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (user?.contactType) setContactType(user.contactType)
    if (user?.contactInfo) setContactInfo(user.contactInfo)
  }, [user])

  const handleSave = async () => {
    if (!contactInfo.trim()) { setErrorMsg('请输入联系方式'); return }
    setErrorMsg('')
    setSaving(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/auth/me', {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ contactType, contactInfo, matchEnabled: true })
      })
      const data = await res.json()
      if (!res.ok) { setErrorMsg(data.error || '保存失败'); return }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch { setErrorMsg('网络错误，保存失败') }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">📱</span>
        <h3 className="font-semibold text-gray-800">联系方式设置</h3>
      </div>
      <p className="text-xs text-gray-400 mb-4">匹配成功后才会展示给对方，全程加密存储</p>
      {errorMsg && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-500">{errorMsg}</div>
      )}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <select value={contactType} onChange={e => setContactType(e.target.value)}
          className="px-3 py-2 bg-white/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 w-full sm:w-auto">
          <option value="wechat">微信号</option>
          <option value="qq">QQ号</option>
          <option value="other">其他</option>
        </select>
        <input type="text" placeholder="输入你的联系方式" value={contactInfo}
          onChange={e => setContactInfo(e.target.value)} maxLength={19}
          className="flex-1 min-w-0 px-4 py-2 bg-white/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />
        <button onClick={handleSave} disabled={saving}
          className="w-full sm:w-auto px-5 py-2 text-sm font-medium bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] rounded-xl hover:opacity-90 transition whitespace-nowrap text-[#8b4a54]">
          {saved ? '已保存 ✓' : saving ? '...' : '保存'}
        </button>
      </div>
    </div>
  )
}
