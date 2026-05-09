"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Bank {
  id: string;
  title: string;
  subject: string | null;
}

interface Match {
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

export default function PkPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedBank, setSelectedBank] = useState("");
  const router = useRouter();

  const loadData = async () => {
    const [matchesRes, banksRes] = await Promise.all([
      fetch("/api/pk/matches"),
      fetch("/api/question-banks"),
    ]);
    if (matchesRes.status === 401) {
      router.push("/login");
      return;
    }
    const [m, b] = await Promise.all([matchesRes.json(), banksRes.json()]);
    if (Array.isArray(m)) setMatches(m);
    if (Array.isArray(b)) setBanks(b);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [router]);

  const handleCreate = async () => {
    if (!selectedBank) return;
    setCreating(true);
    try {
      const res = await fetch("/api/pk/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankId: selectedBank }),
      });
      const data = await res.json();
      if (res.ok) {
        loadData();
      } else {
        alert(data.message);
      }
    } catch {
      alert("创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleAccept = async (matchId: string) => {
    const res = await fetch(`/api/pk/matches/${matchId}/accept`, {
      method: "POST",
    });
    const data = await res.json();
    if (res.ok) {
      router.push(`/pk/${matchId}`);
    } else {
      alert(data.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const waitingMatches = matches.filter((m) => m.status === "waiting");
  const activeMatches = matches.filter((m) => m.status === "active");
  const finishedMatches = matches.filter((m) => m.status === "finished");

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center gap-4">
            <Link href="/" className="text-gray-600 hover:text-gray-900">
              ← 返回
            </Link>
            <h1 className="text-xl font-bold text-gray-900">⚔️ PK 对战</h1>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 创建 PK */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">发起挑战</h2>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">
                选择题库
              </label>
              <select
                value={selectedBank}
                onChange={(e) => setSelectedBank(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">-- 请选择 --</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={!selectedBank || creating}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {creating ? "创建中..." : "🔥 发起 PK"}
            </button>
          </div>
        </div>

        {/* 等待中的 PK */}
        {waitingMatches.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-4">等待对手</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {waitingMatches.map((m) => (
                <div
                  key={m.id}
                  className="bg-white rounded-xl shadow-sm border p-4"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">{m.bankTitle}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(m.createdAt).toLocaleString("zh-CN")}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAccept(m.id)}
                      className="px-4 py-1.5 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700"
                    >
                      应战
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 进行中的 PK */}
        {activeMatches.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-4">进行中</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeMatches.map((m) => (
                <Link
                  key={m.id}
                  href={`/pk/${m.id}`}
                  className="bg-white rounded-xl shadow-sm border p-4 hover:shadow-md"
                >
                  <p className="font-medium">{m.bankTitle}</p>
                  <p className="text-sm text-orange-600 mt-1">进行中 →</p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 已结束的 PK */}
        {finishedMatches.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">对战记录</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {finishedMatches.map((m) => (
                <Link
                  key={m.id}
                  href={`/pk/${m.id}/result`}
                  className="bg-white rounded-xl shadow-sm border p-4 hover:shadow-md"
                >
                  <p className="font-medium">{m.bankTitle}</p>
                  <div className="flex gap-4 mt-2 text-sm">
                    <span>创建者: {m.creatorScore ?? "--"}分</span>
                    <span>挑战者: {m.opponentScore ?? "--"}分</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {matches.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            暂无 PK 记录，发起一个挑战吧！
          </div>
        )}
      </main>
    </div>
  );
}
