"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface PkResult {
  match: {
    id: string;
    status: string;
    creatorScore: number | null;
    opponentScore: number | null;
    creatorTimeMs: number | null;
    opponentTimeMs: number | null;
    winnerId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  };
  creator: { id: string; nickname: string } | null;
  opponent: { id: string; nickname: string } | null;
  questionCount: number;
  isWinner: boolean;
  isDraw: boolean;
}

export default function PkResultPage() {
  const params = useParams();
  const matchId = params.matchId as string;
  const [data, setData] = useState<PkResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/pk/matches/${matchId}/result`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [matchId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">加载失败</p>
      </div>
    );
  }

  const formatTime = (ms: number | null) => {
    if (ms === null) return "--";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}分${s % 60}秒`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center gap-4">
            <Link href="/pk" className="text-gray-600 hover:text-gray-900">
              ← 返回
            </Link>
            <h1 className="text-xl font-bold text-gray-900">⚔️ PK 结果</h1>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* 胜负结果 */}
        <div className="text-center mb-8">
          <div className="text-7xl mb-4">
            {data.isDraw ? "🤝" : data.isWinner ? "🏆" : "😢"}
          </div>
          <h2 className="text-3xl font-bold text-gray-900">
            {data.isDraw ? "平局！" : data.isWinner ? "你赢了！" : "你输了"}
          </h2>
        </div>

        {/* 对战详情 */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="grid grid-cols-3 gap-4 text-center">
            {/* 创建者 */}
            <div>
              <p className="text-sm text-gray-500 mb-1">
                {data.creator?.nickname ?? "创建者"}
              </p>
              <p className="text-3xl font-bold text-gray-900">
                {data.match.creatorScore ?? "--"}
              </p>
              <p className="text-sm text-gray-400">
                {formatTime(data.match.creatorTimeMs)}
              </p>
            </div>

            {/* VS */}
            <div className="flex items-center justify-center">
              <span className="text-2xl font-bold text-gray-300">VS</span>
            </div>

            {/* 挑战者 */}
            <div>
              <p className="text-sm text-gray-500 mb-1">
                {data.opponent?.nickname ?? "挑战者"}
              </p>
              <p className="text-3xl font-bold text-gray-900">
                {data.match.opponentScore ?? "--"}
              </p>
              <p className="text-sm text-gray-400">
                {formatTime(data.match.opponentTimeMs)}
              </p>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t text-center text-sm text-gray-500">
            共 {data.questionCount} 道题
            {data.match.finishedAt && (
              <>
                {" · "}
                {new Date(data.match.finishedAt).toLocaleString("zh-CN")}
              </>
            )}
          </div>
        </div>

        <div className="text-center mt-8">
          <Link
            href="/pk"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            再来一局
          </Link>
        </div>
      </main>
    </div>
  );
}
