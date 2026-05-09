"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { href: "/admin", label: "📊 数据概览", icon: "📊" },
  { href: "/admin/users", label: "👥 用户管理", icon: "👥" },
  { href: "/admin/banks", label: "📚 题库管理", icon: "📚" },
  { href: "/admin/import", label: "📥 AI 导入", icon: "📥" },
  { href: "/admin/attempts", label: "📝 答题记录", icon: "📝" },
  { href: "/admin/grading", label: "✍️ 论述评分", icon: "✍️" },
  { href: "/admin/pk", label: "⚔️ PK 记录", icon: "⚔️" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user || data.user.role !== "admin") {
          router.push("/login");
        } else {
          setLoading(false);
        }
      });
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 侧边栏 */}
      <aside className="w-64 bg-white border-r shrink-0">
        <div className="p-4 border-b">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← 回到前台
          </Link>
          <h1 className="text-lg font-bold text-gray-900 mt-2">管理后台</h1>
        </div>
        <nav className="p-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded-lg text-sm ${
                pathname === item.href
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
