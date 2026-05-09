"use client";

import { useEffect, useState } from "react";

interface Stats {
  userCount: number;
  bankCount: number;
  attemptCount: number;
  matchCount: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 简化：分别获取数据统计
    Promise.all([
      fetch("/api/admin/users").then((r) => r.json()),
      fetch("/api/admin/banks").then((r) => r.json()),
      fetch("/api/admin/attempts").then((r) => r.json()),
      fetch("/api/pk/matches").then((r) => r.json()),
    ])
      .then(([users, banks, attempts, matches]) => {
        setStats({
          userCount: Array.isArray(users) ? users.length : 0,
          bankCount: Array.isArray(banks) ? banks.length : 0,
          attemptCount: Array.isArray(attempts) ? attempts.length : 0,
          matchCount: Array.isArray(matches) ? matches.length : 0,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">📊 数据概览</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="text-3xl mb-2">👥</div>
          <p className="text-3xl font-bold text-gray-900">
            {stats?.userCount ?? 0}
          </p>
          <p className="text-sm text-gray-500">用户总数</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="text-3xl mb-2">📚</div>
          <p className="text-3xl font-bold text-gray-900">
            {stats?.bankCount ?? 0}
          </p>
          <p className="text-sm text-gray-500">题库总数</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="text-3xl mb-2">📝</div>
          <p className="text-3xl font-bold text-gray-900">
            {stats?.attemptCount ?? 0}
          </p>
          <p className="text-sm text-gray-500">答题次数</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="text-3xl mb-2">⚔️</div>
          <p className="text-3xl font-bold text-gray-900">
            {stats?.matchCount ?? 0}
          </p>
          <p className="text-sm text-gray-500">PK 对战</p>
        </div>
      </div>
    </div>
  );
}
