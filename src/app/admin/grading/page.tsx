"use client";

import { useState } from "react";

// 论述题人工评分页面（简化版）
export default function AdminGradingPage() {
  const [attemptId, setAttemptId] = useState("");

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        ✍️ 论述题评分
      </h1>

      <div className="bg-white rounded-xl shadow-sm border p-6">
        <p className="text-gray-600 mb-4">
          输入答题记录 ID，查看需要人工评分的论述题
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={attemptId}
            onChange={(e) => setAttemptId(e.target.value)}
            placeholder="输入 attempt ID"
            className="flex-1 px-3 py-2 border rounded-lg"
          />
          <button
            onClick={() => {
              if (attemptId) {
                window.open(`/attempts/${attemptId}/result`, "_blank");
              }
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            查看
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          论述题评分功能需要在答题结果页面中进行。在完整版本中，这里会列出所有待批改的论述题。
        </p>
      </div>
    </div>
  );
}
