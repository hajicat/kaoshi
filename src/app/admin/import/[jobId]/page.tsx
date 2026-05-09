"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface ParsedQuestion {
  type: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  answer: string[];
  analysis?: string;
  score: number;
}

interface JobData {
  id: string;
  filename: string;
  status: string;
  bankId: string | null;
  parsedData: { questions: ParsedQuestion[] } | null;
}

interface Bank {
  id: string;
  title: string;
}

export default function AdminImportPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;
  const [job, setJob] = useState<JobData | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [selectedBank, setSelectedBank] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/import-jobs/${jobId}`).then((r) => r.json()),
      fetch("/api/admin/banks").then((r) => r.json()),
    ])
      .then(([j, b]) => {
        setJob(j);
        if (Array.isArray(b)) setBanks(b);
      })
      .finally(() => setLoading(false));
  }, [jobId]);

  const handleConfirm = async () => {
    if (!selectedBank) {
      alert("请选择题库");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch(`/api/admin/import-jobs/${jobId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankId: selectedBank }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        router.push("/admin/import");
      } else {
        alert(data.message);
      }
    } catch {
      alert("确认失败");
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-8 text-gray-500">任务不存在</div>
    );
  }

  const questions = job.parsedData?.questions ?? [];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        📥 导入预览
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        文件：{job.filename} · 共 {questions.length} 道题
      </p>

      {/* 选择题库 */}
      <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">导入到题库：</span>
          <select
            value={selectedBank}
            onChange={(e) => setSelectedBank(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg"
          >
            <option value="">-- 选择题库 --</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          <button
            onClick={handleConfirm}
            disabled={!selectedBank || confirming}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {confirming ? "导入中..." : "确认导入"}
          </button>
        </div>
      </div>

      {/* 题目预览 */}
      <div className="space-y-4">
        {questions.map((q, i) => (
          <div
            key={i}
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
              </span>
            </div>
            <p className="text-gray-900 mb-2">{q.stem}</p>
            {q.options.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {q.options.map((opt) => (
                  <span
                    key={opt.key}
                    className={`px-2 py-1 text-xs rounded ${
                      q.answer.includes(opt.key)
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {opt.key}. {opt.text}
                  </span>
                ))}
              </div>
            )}
            {q.analysis && (
              <p className="text-xs text-blue-600">解析：{q.analysis}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
