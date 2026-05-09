"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  username: string;
  nickname: string;
  role: string;
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) setUser(data.user);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold text-gray-900">📝 刷题平台</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                {user.nickname} ({user.role === "admin" ? "管理员" : "用户"})
              </span>
              {user.role === "admin" && (
                <Link
                  href="/admin"
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  管理后台
                </Link>
              )}
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/login");
                }}
                className="text-sm text-red-600 hover:text-red-800"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 题库卡片 */}
          <Link
            href="/banks"
            className="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow"
          >
            <div className="text-3xl mb-3">📚</div>
            <h2 className="text-lg font-semibold text-gray-900">题库练习</h2>
            <p className="text-sm text-gray-500 mt-1">
              选择题库开始答题
            </p>
          </Link>

          {/* 答题记录 */}
          <Link
            href="/attempts"
            className="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow"
          >
            <div className="text-3xl mb-3">📊</div>
            <h2 className="text-lg font-semibold text-gray-900">答题记录</h2>
            <p className="text-sm text-gray-500 mt-1">
              查看历史成绩和错题
            </p>
          </Link>

          {/* PK 对战 */}
          <Link
            href="/pk"
            className="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow"
          >
            <div className="text-3xl mb-3">⚔️</div>
            <h2 className="text-lg font-semibold text-gray-900">PK 对战</h2>
            <p className="text-sm text-gray-500 mt-1">
              和同学来一场 PK
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
}
