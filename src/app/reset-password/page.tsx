'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getCsrfToken } from '@/lib/csrf'

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">加载中...</p></div>}>
      <ResetForm />
    </Suspense>
  )
}

function ResetForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // 无 token → 提示去登录页
  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-stone-50 flex items-center justify-center px-4">
        <div className="glass-card rounded-3xl p-8 shadow-xl text-center max-w-md w-full">
          <div className="text-5xl mb-4">🔑</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">无效的重置链接</h2>
          <p className="text-sm text-gray-400 mb-6">
            这个重置链接不完整或已过期
          </p>
          <Link href="/login"
            className="inline-block w-full py-3 bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] font-semibold rounded-xl hover:opacity-90 transition text-center text-[#8b4a54]">
            返回登录页
          </Link>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 前端校验
    if (password.length < 8) { setError('密码至少需要 8 个字符'); return }
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(password)) { setError('密码需同时包含字母和数字'); return }
    if (password !== confirmPwd) { setError('两次输入的密码不一致'); return }

    setLoading(true)
    try {
      const csrfToken = getCsrfToken()
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '重置失败')
        setLoading(false)
        return
      }

      setSuccess(true)
      setTimeout(() => router.push('/login'), 2500)
    } catch {
      setError('网络错误，请稍后重试')
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-stone-50 flex items-center justify-center px-4">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float" />
          <div className="absolute bottom-20 right-10 w-72 h-72 bg-green-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float" style={{ animationDelay: '1.5s' }} />
        </div>

        <div className="relative z-10 glass-card rounded-3xl p-10 text-center shadow-2xl animate-fade-in max-w-md w-full">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">密码重置成功！</h2>
          <p className="text-gray-500">正在跳转到登录页面...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-stone-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float" />
        <div className="absolute bottom-20 right-10 w-72 h-72 bg-stone-100 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <span className="text-3xl">🎁</span>
          <span className="font-bold text-2xl gradient-text">吉我爱</span>
        </Link>

        <div className="glass-card rounded-3xl p-8 shadow-xl">
          <h2 className="text-2xl font-bold text-center text-gray-800 mb-2">
            🔑 重置密码
          </h2>
          <p className="text-sm text-gray-400 text-center mb-6">
            输入你的新密码
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-500 text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 新密码 */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">新密码</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="至少 8 位，含字母和数字"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-10 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition"
                  required minLength={8} autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition text-lg"
                  tabIndex={-1}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            {/* 确认密码 */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">确认新密码</label>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="再次输入新密码"
                value={confirmPwd}
                onChange={e => setConfirmPwd(e.target.value)}
                className="w-full px-4 py-3 bg-white/50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 transition"
                required minLength={8} autoComplete="new-password"
              />
            </div>

            {/* 密码强度提示 */}
            {password && (
              <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                <div className={`flex items-center gap-2 text-xs ${password.length >= 8 ? 'text-green-500' : 'text-gray-400'}`}>
                  <span>{password.length >= 8 ? '✅' : '○'}</span> 至少 8 个字符
                </div>
                <div className={`flex items-center gap-2 text-xs ${/[a-zA-Z]/.test(password) ? 'text-green-500' : 'text-gray-400'}`}>
                  <span>{/[a-zA-Z]/.test(password) ? '✅' : '○'}</span> 包含字母
                </div>
                <div className={`flex items-center gap-2 text-xs ${/\d/.test(password) ? 'text-green-500' : 'text-gray-400'}`}>
                  <span>{/\d/.test(password) ? '✅' : '○'}</span> 包含数字
                </div>
                <div className={`flex items-center gap-2 text-xs ${confirmPwd && password === confirmPwd ? 'text-green-500' : 'text-gray-400'}`}>
                  <span>{confirmPwd && password === confirmPwd ? '✅' : '○'}</span> 两次输入一致
                </div>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-[#FFF2F2] to-[#FFB6B6] font-semibold rounded-xl hover:opacity-90 transition disabled:opacity-50 text-[#8b4a54]">
              {loading ? '请稍候...' : '确认重置'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-400">
            想起密码了？
            <Link href="/login" className="ml-1 text-pink-500 font-medium hover:underline">返回登录</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
