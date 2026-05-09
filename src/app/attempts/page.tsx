"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Attempt {
  id: string;
  bankId: string;
  status: string;
  totalScore: number | null;
  earnedScore: number | null;
  startedAt: string;
  submittedAt: string | null;
}

export default function AttemptsPage() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/attempts")
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return;
        }
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setAttempts(data);
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center gap-4">
            <Link href="/" className="text-gray-600 hover:text-gray-900">
              ← 返回
            </Link>
            <h1 className="text-xl font-bold text-gray-900">📊 答题记录</h1>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {attempts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            暂无答题记录
          </div>
        ) : (
          <div className="space-y-4">
            {attempts.map((a) => (
              <Link
                key={a.id}
                href={
                  a.status === "submitted" || a.status === "graded"
                    ? `/attempts/${a.id}/result`
                    : "#"
                }
                className="block bg-white rounded-xl shadow-sm border p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span
                      className={`inline-block px-2 py-1 text-xs rounded-full ${
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
                    <p className="text-sm text-gray-500 mt-1">
                      {new Date(a.startedAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <div className="text-right">
                    {a.earnedScore !== null && a.totalScore !== null ? (
                      <div>
                        <span className="text-2xl font-bold text-gray-900">
                          {a.earnedScore}
                        </span>
                        <span className="text-gray-400">/{a.totalScore}</span>
                      </div>
                    ) : (
                      <span className="text-gray-400">--</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
