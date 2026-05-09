"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PkMatch {
  id: string;
  bankId: string;
  creatorId: string;
  opponentId: string | null;
  status: string;
  creatorScore: number | null;
  opponentScore: number | null;
  winnerId: string | null;
  createdAt: string;
  bankTitle: string | null;
}

export default function AdminPkPage() {
  const [matches, setMatches] = useState<PkMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pk/matches")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMatches(data);
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">⚔️ PK 记录</h1>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                题库
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                状态
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                创建者分数
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                挑战者分数
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                时间
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-600">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr
                key={m.id}
                className="border-b last:border-b-0 hover:bg-gray-50"
              >
                <td className="px-4 py-3 text-sm">{m.bankTitle ?? "--"}</td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      m.status === "finished"
                        ? "bg-green-50 text-green-700"
                        : m.status === "active"
                          ? "bg-orange-50 text-orange-700"
                          : m.status === "waiting"
                            ? "bg-yellow-50 text-yellow-700"
                            : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {m.status === "finished"
                      ? "已结束"
                      : m.status === "active"
                        ? "进行中"
                        : m.status === "waiting"
                          ? "等待中"
                          : m.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {m.creatorScore ?? "--"}
                </td>
                <td className="px-4 py-3 text-sm">
                  {m.opponentScore ?? "--"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(m.createdAt).toLocaleString("zh-CN")}
                </td>
                <td className="px-4 py-3 text-sm text-right">
                  {m.status === "finished" && (
                    <Link
                      href={`/pk/${m.id}/result`}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      查看结果
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {matches.length === 0 && (
          <div className="text-center py-8 text-gray-500">暂无 PK 记录</div>
        )}
      </div>
    </div>
  );
}
