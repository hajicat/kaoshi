"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  username: string;
  nickname: string;
  role: string;
  status: string;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    username: "",
    nickname: "",
    password: "",
    role: "user" as "admin" | "user",
  });
  const [creating, setCreating] = useState(false);

  const loadUsers = () => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setUsers(data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreate(false);
        setForm({ username: "", nickname: "", password: "", role: "user" });
        loadUsers();
      } else {
        alert(data.message);
      }
    } catch {
      alert("创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "disabled" : "active";
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    loadUsers();
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
        <h1 className="text-2xl font-bold text-gray-900">👥 用户管理</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + 创建用户
        </button>
      </div>

      {/* 创建用户弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">创建用户</h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="用户名"
                value={form.username}
                onChange={(e) =>
                  setForm((f) => ({ ...f, username: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg"
              />
              <input
                type="text"
                placeholder="昵称"
                value={form.nickname}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nickname: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg"
              />
              <input
                type="password"
                placeholder="密码（至少 6 位）"
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg"
              />
              <select
                value={form.role}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    role: e.target.value as "admin" | "user",
                  }))
                }
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
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

      {/* 用户列表 */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                用户名
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                昵称
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                角色
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                状态
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                创建时间
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-600">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-b-0 hover:bg-gray-50">
                <td className="px-4 py-3 text-sm">{u.username}</td>
                <td className="px-4 py-3 text-sm">{u.nickname}</td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      u.role === "admin"
                        ? "bg-purple-50 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {u.role === "admin" ? "管理员" : "用户"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      u.status === "active"
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {u.status === "active" ? "正常" : "禁用"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {new Date(u.createdAt).toLocaleDateString("zh-CN")}
                </td>
                <td className="px-4 py-3 text-sm text-right">
                  <button
                    onClick={() => handleToggle(u.id, u.status)}
                    className={`px-3 py-1 text-xs rounded-lg ${
                      u.status === "active"
                        ? "text-red-600 hover:bg-red-50"
                        : "text-green-600 hover:bg-green-50"
                    }`}
                  >
                    {u.status === "active" ? "禁用" : "启用"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="text-center py-8 text-gray-500">暂无用户</div>
        )}
      </div>
    </div>
  );
}
