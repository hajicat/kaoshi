"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Question {
  id: string;
  type: string;
  stem: string;
  optionsJson: string;
  answerJson: string;
  score: number;
  difficulty: string | null;
  sortOrder: number;
}

export default function AdminQuestionsPage() {
  const params = useParams();
  const bankId = params.bankId as string;
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/banks/${bankId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.questions) setQuestions(data.questions);
      })
      .finally(() => setLoading(false));
  }, [bankId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">📝 题目管理</h1>

      {questions.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          暂无题目，请通过 AI 导入添加
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, i) => {
            const options = JSON.parse(q.optionsJson);
            const answer = JSON.parse(q.answerJson);
            return (
              <div
                key={q.id}
                className="bg-white rounded-xl shadow-sm border p-4"
              >
                <div className="flex items-start gap-2 mb-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-medium shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-xs text-gray-500">
                    {q.type === "single" && "单选"}
                    {q.type === "multiple" && "多选"}
                    {q.type === "boolean" && "判断"}
                    {q.type === "essay" && "论述"}
                    {" · "}
                    {q.score}分
                    {q.difficulty &&
                      ` · ${
                        q.difficulty === "easy"
                          ? "简单"
                          : q.difficulty === "medium"
                            ? "中等"
                            : "困难"
                      }`}
                  </span>
                </div>
                <p className="text-gray-900 mb-2">{q.stem}</p>
                <div className="flex flex-wrap gap-2">
                  {options.map((opt: { key: string; text: string }) => (
                    <span
                      key={opt.key}
                      className={`px-2 py-1 text-xs rounded ${
                        answer.includes(opt.key)
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {opt.key}. {opt.text}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-green-600 mt-2">
                  答案：{answer.join(", ")}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
