"use client";

import { useEffect, useState } from "react";

interface AttemptRecord {
  id: string;
  userId: string;
  bankId: string;
  status: string;
  totalScore: number | null;
  earnedScore: number | null;
  startedAt: string;
  submittedAt: string | null;
  username: string | null;
  nickname: string | null;
  bankTitle: string | null;
}

export default function AdminAttemptsPage() {
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/attempts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAttempts(data);
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">📝 答题记录</h1>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                用户
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                题库
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                状态
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                成绩
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                时间
              </th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr
                key={a.id}
                className="border-b last:border-b-0 hover:bg-gray-50"
              >
                <td className="px-4 py-3 text-sm">
                  {a.nickname ?? a.username ?? "--"}
                </td>
                <td className="px-4 py-3 text-sm">{a.bankTitle ?? "--"}</td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      a.status === "submitted"
                        ? "bg-green-50 text-green-700"
                        : a.status === "graded"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-yellow-50 text-yellow-700"
                    }`}
                  >
                    {a.status === "submitted"
                      ? "已提交"
                      : a.status === "graded"
                        ? "已批改"
                        : "进行中"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {a.earnedScore !== null ? (
                    <span>
                      {a.earnedScore}/{a.totalScore}
                    </span>
                  ) : (
                    "--"
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(a.startedAt).toLocaleString("zh-CN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {attempts.length === 0 && (
          <div className="text-center py-8 text-gray-500">暂无记录</div>
        )}
      </div>
    </div>
  );
}
