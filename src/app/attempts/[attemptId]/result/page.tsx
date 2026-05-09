"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface ResultItem {
  questionId: string;
  type: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  correctAnswer: string[];
  userAnswer: string[] | null;
  isCorrect: number | null;
  earnedScore: number;
  score: number;
  analysis: string | null;
  referenceAnswer: string | null;
  needsGrading: boolean;
}

interface AttemptData {
  attempt: {
    id: string;
    status: string;
    totalScore: number;
    earnedScore: number | null;
  };
  results: ResultItem[];
}

export default function AttemptResultPage() {
  const params = useParams();
  const attemptId = params.attemptId as string;
  const [data, setData] = useState<AttemptData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/attempts/${attemptId}/result`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [attemptId]);

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

  const correctCount = data.results.filter((r) => r.isCorrect === 1).length;
  const wrongCount = data.results.filter((r) => r.isCorrect === 0).length;
  const pendingCount = data.results.filter((r) => r.needsGrading).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center gap-4">
            <Link href="/attempts" className="text-gray-600 hover:text-gray-900">
              ← 返回
            </Link>
            <h1 className="text-xl font-bold text-gray-900">📊 答题结果</h1>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 成绩卡片 */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="text-center">
            <div className="text-5xl font-bold text-gray-900 mb-2">
              {data.attempt.earnedScore ?? "--"}
              <span className="text-2xl text-gray-400">
                /{data.attempt.totalScore}
              </span>
            </div>
            <div className="flex justify-center gap-6 mt-4 text-sm">
              <span className="text-green-600">✓ 正确 {correctCount}</span>
              <span className="text-red-600">✗ 错误 {wrongCount}</span>
              {pendingCount > 0 && (
                <span className="text-yellow-600">
                  ⏳ 待批改 {pendingCount}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 题目详情 */}
        <div className="space-y-4">
          {data.results.map((r, i) => (
            <div
              key={r.questionId}
              className={`bg-white rounded-xl shadow-sm border p-6 ${
                r.isCorrect === 0
                  ? "border-l-4 border-l-red-400"
                  : r.isCorrect === 1
                    ? "border-l-4 border-l-green-400"
                    : "border-l-4 border-l-yellow-400"
              }`}
            >
              <div className="flex items-start gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-700 text-xs font-medium shrink-0">
                  {i + 1}
                </span>
                <span className="text-xs text-gray-500">
                  {r.type === "single" && "单选"}
                  {r.type === "multiple" && "多选"}
                  {r.type === "boolean" && "判断"}
                  {r.type === "essay" && "论述"}
                  {" · "}
                  {r.score}分
                </span>
                <span className="ml-auto">
                  {r.isCorrect === 1 && (
                    <span className="text-green-600 text-sm font-medium">
                      ✓ +{r.earnedScore}
                    </span>
                  )}
                  {r.isCorrect === 0 && (
                    <span className="text-red-600 text-sm font-medium">
                      ✗ 0
                    </span>
                  )}
                  {r.needsGrading && (
                    <span className="text-yellow-600 text-sm">待批改</span>
                  )}
                </span>
              </div>

              <p className="text-gray-900 mb-4">{r.stem}</p>

              <div className="space-y-2 mb-4">
                {r.options.map((opt) => {
                  const isCorrect = r.correctAnswer.includes(opt.key);
                  const isUserSelected = (r.userAnswer || []).includes(
                    opt.key
                  );

                  let cls = "p-3 rounded-lg border ";
                  if (isCorrect && isUserSelected) {
                    cls += "border-green-300 bg-green-50";
                  } else if (isCorrect) {
                    cls += "border-green-300 bg-green-50";
                  } else if (isUserSelected) {
                    cls += "border-red-300 bg-red-50";
                  } else {
                    cls += "border-gray-200";
                  }

                  return (
                    <div key={opt.key} className={cls}>
                      <span className="font-medium">{opt.key}.</span> {opt.text}
                      {isCorrect && (
                        <span className="ml-2 text-green-600 text-xs">
                          ✓ 正确答案
                        </span>
                      )}
                      {isUserSelected && !isCorrect && (
                        <span className="ml-2 text-red-600 text-xs">
                          ✗ 你的选择
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {r.analysis && (
                <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-900">
                  <strong>解析：</strong>
                  {r.analysis}
                </div>
              )}

              {r.referenceAnswer && (
                <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 mt-2">
                  <strong>参考答案：</strong>
                  {r.referenceAnswer}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
