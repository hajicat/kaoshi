"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface MatchStatus {
  id: string;
  status: string;
  bankId: string;
  creatorId: string;
  opponentId: string | null;
  myRole: string;
  startedAt: string | null;
}

export default function PkMatchPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = params.matchId as string;
  const [match, setMatch] = useState<MatchStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/pk/matches/${matchId}/status`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setMatch(data);
      setLoading(false);

      // 如果已结束，跳转结果页
      if (data.status === "finished") {
        router.push(`/pk/${matchId}/result`);
      }
    };

    load();

    // 轮询状态
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [matchId, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!match) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">对战不存在</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center gap-4">
            <Link href="/pk" className="text-gray-600 hover:text-gray-900">
              ← 返回
            </Link>
            <h1 className="text-xl font-bold text-gray-900">⚔️ PK 对战</h1>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          {match.status === "waiting" && (
            <div>
              <div className="text-6xl mb-4">⏳</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                等待对手加入
              </h2>
              <p className="text-gray-500">
                分享这个链接给你的对手：
              </p>
              <div className="mt-4 p-3 bg-gray-100 rounded-lg inline-block">
                <code className="text-sm">
                  {typeof window !== "undefined" ? window.location.href : ""}
                </code>
              </div>
              <p className="text-sm text-gray-400 mt-4">
                页面每 5 秒自动刷新状态
              </p>
            </div>
          )}

          {match.status === "active" && (
            <div>
              <div className="text-6xl mb-4">🔥</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                对战进行中
              </h2>
              <p className="text-gray-500 mb-6">
                等待对方提交答案...（轮询中）
              </p>
              <div className="animate-pulse">
                <div className="w-16 h-16 bg-red-200 rounded-full mx-auto" />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
