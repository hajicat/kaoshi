"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ImportJob {
  id: string;
  filename: string;
  status: string;
  bankId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export default function AdminImportPage() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadJobs = () => {
    fetch("/api/admin/import-jobs")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setJobs(data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert(`文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大支持 10MB`);
      e.target.value = "";
      return;
    }

    setUploading(true);
    try {
      // 读取文件为 base64，用 JSON 发送（避免 Cloudflare Workers 对 multipart/form-data 的兼容问题）
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      console.log("[upload] 开始上传:", file.name, file.size, "bytes");
      const res = await fetch("/api/admin/import-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content: base64 }),
      });
      console.log("[upload] 响应状态:", res.status, res.statusText);
      const data = await res.json();
      console.log("[upload] 响应数据:", data);
      if (res.ok) {
        loadJobs();
      } else {
        alert(data.message || `上传失败 (HTTP ${res.status})`);
      }
    } catch (err) {
      console.error("[upload] 上传异常:", err);
      console.error("[upload] 错误类型:", err instanceof TypeError ? "TypeError" : typeof err);
      console.error("[upload] 错误信息:", err instanceof Error ? err.message : String(err));
      alert("上传失败: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">📥 AI 导入</h1>
        <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
          {uploading ? "上传中..." : "上传文件"}
          <input
            type="file"
            accept=".txt,.md,.csv,.pdf"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      <div className="bg-blue-50 rounded-lg p-4 mb-6 text-sm text-blue-800">
        <p className="font-medium mb-1">支持的文件格式：</p>
        <p>.pdf .txt .md .csv — AI 自动识别题目类型、选项、答案和解析</p>
      </div>

      {/* 任务列表 */}
      <div className="space-y-4">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="bg-white rounded-xl shadow-sm border p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {job.filename}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      job.status === "done"
                        ? "bg-green-50 text-green-700"
                        : job.status === "parsed"
                          ? "bg-blue-50 text-blue-700"
                          : job.status === "failed"
                            ? "bg-red-50 text-red-700"
                            : job.status === "parsing"
                              ? "bg-yellow-50 text-yellow-700"
                              : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {job.status === "done"
                      ? "已完成"
                      : job.status === "parsed"
                        ? "待确认"
                        : job.status === "failed"
                          ? "失败"
                          : job.status === "parsing"
                            ? "解析中"
                            : job.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(job.createdAt).toLocaleString("zh-CN")}
                </p>
                {job.errorMessage && (
                  <p className="text-xs text-red-600 mt-1">
                    {job.errorMessage}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {job.status === "parsed" && (
                  <Link
                    href={`/admin/import/${job.id}`}
                    className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                  >
                    预览 & 确认
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
        {jobs.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            暂无导入任务，上传一个文件开始
          </div>
        )}
      </div>
    </div>
  );
}
