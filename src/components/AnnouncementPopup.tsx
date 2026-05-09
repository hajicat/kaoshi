'use client'

import { useState, useEffect, useCallback } from 'react'
import { getCsrfToken } from '@/lib/csrf'

interface Announcement {
  id: number
  title: string
  content: string
  dismissMode: string
}

export default function AnnouncementPopup() {
  const [queue, setQueue] = useState<Announcement[]>([])
  const [current, setCurrent] = useState<Announcement | null>(null)
  const [visible, setVisible] = useState(false)

  const dismissToServer = useCallback(async (id: number) => {
    try {
      const csrfToken = getCsrfToken()
      await fetch('/api/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ announcementId: id }),
      })
    } catch { /* 静默失败 */ }
  }, [])

  useEffect(() => {
    fetch('/api/announcements')
      .then(r => r.json())
      .then(data => {
        const list: Announcement[] = data.announcements || []
        // 过滤掉游客 localStorage 已标记的
        const filtered = list.filter(a => {
          if (a.dismissMode === 'always') return true
          if (typeof window !== 'undefined' && !document.cookie.includes('logged_in=true')) {
            return !localStorage.getItem(`dismissed_announcement_${a.id}`)
          }
          return true
        })
        if (filtered.length > 0) {
          setQueue(filtered)
          setCurrent(filtered[0])
          setVisible(true)
        }
      })
      .catch(() => {})
  }, [])

  const handleClose = useCallback(() => {
    if (!current) return
    // once 模式：关闭即标记已读
    if (current.dismissMode === 'once') {
      const isLoggedIn = document.cookie.includes('logged_in=true')
      if (isLoggedIn) {
        dismissToServer(current.id)
      } else {
        localStorage.setItem(`dismissed_announcement_${current.id}`, '1')
      }
    }
    // confirm 模式：关闭不标记，下次还弹
    setVisible(false)
    setTimeout(() => {
      const nextQueue = queue.slice(1)
      setQueue(nextQueue)
      if (nextQueue.length > 0) {
        setCurrent(nextQueue[0])
        setVisible(true)
      } else {
        setCurrent(null)
      }
    }, 300)
  }, [current, queue, dismissToServer])

  const handleConfirm = useCallback(() => {
    if (!current) return
    // once 和 confirm 模式都标记已读
    if (current.dismissMode !== 'always') {
      const isLoggedIn = document.cookie.includes('logged_in=true')
      if (isLoggedIn) {
        dismissToServer(current.id)
      } else {
        localStorage.setItem(`dismissed_announcement_${current.id}`, '1')
      }
    }
    setVisible(false)
    setTimeout(() => {
      const nextQueue = queue.slice(1)
      setQueue(nextQueue)
      if (nextQueue.length > 0) {
        setCurrent(nextQueue[0])
        setVisible(true)
      } else {
        setCurrent(null)
      }
    }, 300)
  }, [current, queue, dismissToServer])

  if (!current) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${visible ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/0 pointer-events-none'}`}
      onClick={handleClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col p-6 transition-all duration-300 ${visible ? 'scale-100 opacity-100 animate-modal-in' : 'scale-95 opacity-0'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">{current.title}</h3>
          <button
            onClick={handleClose}
            className="ml-4 text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap mb-6 overflow-y-auto flex-1 min-h-0">
          {current.content}
        </div>
        <div className="flex justify-end">
          <button
            onClick={handleConfirm}
            className="px-6 py-2 bg-gradient-to-r from-pink-400 to-rose-400 text-white rounded-xl text-sm font-medium hover:shadow-lg transition-all"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}
