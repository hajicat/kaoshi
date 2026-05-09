import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "刷题平台",
  description: "在线刷题与 PK 系统",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
