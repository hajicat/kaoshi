"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Question {
  id: string;
  type: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  score: number;
}

interface QuizData {
  attemptId: string;
  bank: { id: string; title: string };
  questions: Question[];
}

export default function BankStartPage() {
  const params = useParams();
  const router = useRouter();
  const bankId = params.bankId as string;
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/question-banks/${bankId}/start`, { method: "POST" })
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.attemptId) setQuiz(data);
      })
      .finally(() => setLoading(false));
  }, [bankId, router]);

  // 自动保存答案
  const saveAnswer = async (questionId: string, answer: string[]) => {
    if (!quiz) return;
    await fetch(`/api/attempts/${quiz.attemptId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, answer }),
    });
  };

  const handleAnswer = (questionId: string, key: string) => {
    const question = quiz?.questions.find((q) => q.id === questionId);
    if (!question) return;

    let newAnswer: string[];

    if (question.type === "single" || question.type === "boolean") {
      newAnswer = [key];
    } else {
      // multiple
      const current = answers[questionId] || [];
      if (current.includes(key)) {
        newAnswer = current.filter((k) => k !== key);
      } else {
        newAnswer = [...current, key];
      }
    }

    setAnswers((prev) => ({ ...prev, [questionId]: newAnswer }));
    saveAnswer(questionId, newAnswer);
  };

  const handleSubmit = async () => {
    if (!quiz) return;
    if (!confirm("确认提交？")) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/attempts/${quiz.attemptId}/submit`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/attempts/${quiz.attemptId}/result`);
      } else {
        alert(data.message || "提交失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-gray-500">题库加载失败</p>
          <Link href="/banks" className="text-blue-600 mt-2 block">
            返回题库
          </Link>
        </div>
      </div>
    );
  }

  const current = quiz.questions[currentIdx];
  const total = quiz.questions.length;
  const answered = Object.keys(answers).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部栏 */}
      <nav className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/banks" className="text-gray-600 hover:text-gray-900">
                ← 退出
              </Link>
              <h1 className="text-lg font-semibold text-gray-900">
                {quiz.bank.title}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">
                {answered}/{total} 已答
              </span>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {submitting ? "提交中..." : "提交"}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* 进度条 */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-500 mb-1">
            <span>
              第 {currentIdx + 1} / {total} 题
            </span>
            <span>{current.score} 分</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${((currentIdx + 1) / total) * 100}%` }}
            />
          </div>
        </div>

        {/* 题目 */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="flex items-start gap-2 mb-4">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-medium shrink-0">
              {currentIdx + 1}
            </span>
            <span className="text-sm text-gray-500">
              {current.type === "single" && "【单选题】"}
              {current.type === "multiple" && "【多选题】"}
              {current.type === "boolean" && "【判断题】"}
              {current.type === "essay" && "【论述题】"}
            </span>
          </div>

          <p className="text-gray-900 text-base leading-relaxed mb-6">
            {current.stem}
          </p>

          {/* 选项 */}
          <div className="space-y-3">
            {current.options.map((opt) => {
              const selected = (answers[current.id] || []).includes(opt.key);
              return (
                <button
                  key={opt.key}
                  onClick={() => handleAnswer(current.id, opt.key)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                    selected
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <span className="font-medium text-gray-700">
                    {opt.key}.
                  </span>{" "}
                  {opt.text}
                </button>
              );
            })}
          </div>
        </div>

        {/* 导航按钮 */}
        <div className="flex justify-between">
          <button
            onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            disabled={currentIdx === 0}
            className="px-4 py-2 text-sm text-gray-600 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← 上一题
          </button>

          {/* 题号导航 */}
          <div className="flex gap-1 flex-wrap justify-center">
            {quiz.questions.map((q, i) => (
              <button
                key={q.id}
                onClick={() => setCurrentIdx(i)}
                className={`w-8 h-8 text-xs rounded-lg border ${
                  i === currentIdx
                    ? "bg-blue-600 text-white border-blue-600"
                    : answers[q.id]
                      ? "bg-green-50 text-green-700 border-green-300"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <button
            onClick={() =>
              setCurrentIdx((i) => Math.min(total - 1, i + 1))
            }
            disabled={currentIdx === total - 1}
            className="px-4 py-2 text-sm text-gray-600 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一题 →
          </button>
        </div>
      </main>
    </div>
  );
}
