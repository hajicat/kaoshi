"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Bank {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  status: string;
  createdAt: string;
}

export default function AdminBanksPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    subject: "",
  });
  const [creating, setCreating] = useState(false);

  const loadBanks = () => {
    fetch("/api/admin/banks")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setBanks(data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBanks();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/banks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreate(false);
        setForm({ title: "", description: "", subject: "" });
        loadBanks();
      } else {
        alert(data.message);
      }
    } catch {
      alert("创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handlePublish = async (bankId: string) => {
    await fetch(`/api/admin/banks/${bankId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published" }),
    });
    loadBanks();
  };

  const handleDelete = async (bankId: string) => {
    if (!confirm("确定删除？题目也会一并删除。")) return;
    await fetch(`/api/admin/banks/${bankId}`, { method: "DELETE" });
    loadBanks();
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
        <h1 className="text-2xl font-bold text-gray-900">📚 题库管理</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + 创建题库
        </button>
      </div>

      {/* 创建弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">创建题库</h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="题库标题"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg"
              />
              <input
                type="text"
                placeholder="学科（可选）"
                value={form.subject}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subject: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg"
              />
              <textarea
                placeholder="描述（可选）"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg"
                rows={3}
              />
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 py-2 border rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 题库列表 */}
      <div className="space-y-4">
        {banks.map((bank) => (
          <div
            key={bank.id}
            className="bg-white rounded-xl shadow-sm border p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900">{bank.title}</h3>
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      bank.status === "published"
                        ? "bg-green-50 text-green-700"
                        : bank.status === "draft"
                          ? "bg-yellow-50 text-yellow-700"
                          : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {bank.status === "published"
                      ? "已发布"
                      : bank.status === "draft"
                        ? "草稿"
                        : "已归档"}
                  </span>
                  {bank.subject && (
                    <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded-full">
                      {bank.subject}
                    </span>
                  )}
                </div>
                {bank.description && (
                  <p className="text-sm text-gray-500 mt-1">
                    {bank.description}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/admin/banks/${bank.id}/questions`}
                  className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  管理题目
                </Link>
                {bank.status === "draft" && (
                  <button
                    onClick={() => handlePublish(bank.id)}
                    className="px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 rounded-lg"
                  >
                    发布
                  </button>
                )}
                <button
                  onClick={() => handleDelete(bank.id)}
                  className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
        {banks.length === 0 && (
          <div className="text-center py-12 text-gray-500">暂无题库</div>
        )}
      </div>
    </div>
  );
}
