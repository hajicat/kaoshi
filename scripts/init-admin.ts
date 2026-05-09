// 初始化脚本：创建管理员账号
// 用法：npx tsx scripts/init-admin.ts

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { hash } from "bcryptjs";
import { nanoid } from "nanoid";
import * as schema from "../src/lib/db/schema";
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const db = drizzle(client, { schema });

  // 创建管理员
  const adminId = nanoid();
  const passwordHash = await hash("admin123", 10);
  const now = new Date().toISOString();

  try {
    await db.insert(schema.users).values({
      id: adminId,
      username: "admin",
      nickname: "管理员",
      passwordHash,
      role: "admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    console.log("✅ 管理员创建成功：admin / admin123");
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      console.log("ℹ️  管理员已存在，跳过");
    } else {
      throw e;
    }
  }

  // 创建测试用户
  const userId = nanoid();
  const userPasswordHash = await hash("123456", 10);

  try {
    await db.insert(schema.users).values({
      id: userId,
      username: "student1",
      nickname: "张三",
      passwordHash: userPasswordHash,
      role: "user",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    console.log("✅ 测试用户创建成功：student1 / 123456");
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      console.log("ℹ️  测试用户已存在，跳过");
    } else {
      throw e;
    }
  }

  // 创建示例题库
  const bankId = nanoid();
  try {
    await db.insert(schema.questionBanks).values({
      id: bankId,
      title: "示例题库 - 前端基础",
      description: "HTML、CSS、JavaScript 基础题",
      subject: "前端开发",
      version: "1.0",
      status: "published",
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });

    // 插入示例题目
    const questions = [
      {
        id: nanoid(),
        bankId,
        type: "single" as const,
        stem: "HTML 中，哪个标签用于定义超链接？",
        optionsJson: JSON.stringify([
          { key: "A", text: "<link>" },
          { key: "B", text: "<a>" },
          { key: "C", text: "<href>" },
          { key: "D", text: "<url>" },
        ]),
        answerJson: JSON.stringify(["B"]),
        analysis: "<a> 标签用于定义超链接，href 属性指定链接地址。",
        score: 1,
        difficulty: "easy" as const,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        bankId,
        type: "single" as const,
        stem: "CSS 中，以下哪个属性用于设置字体大小？",
        optionsJson: JSON.stringify([
          { key: "A", text: "text-size" },
          { key: "B", text: "font-style" },
          { key: "C", text: "font-size" },
          { key: "D", text: "text-font" },
        ]),
        answerJson: JSON.stringify(["C"]),
        analysis: "font-size 属性用于设置字体大小。",
        score: 1,
        difficulty: "easy" as const,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        bankId,
        type: "multiple" as const,
        stem: "以下哪些是 JavaScript 的数据类型？（多选）",
        optionsJson: JSON.stringify([
          { key: "A", text: "String" },
          { key: "B", text: "Boolean" },
          { key: "C", text: "Float" },
          { key: "D", text: "Symbol" },
        ]),
        answerJson: JSON.stringify(["A", "B", "D"]),
        analysis:
          "JavaScript 基本数据类型包括 String、Number、Boolean、Null、Undefined、Symbol、BigInt。没有单独的 Float 类型。",
        score: 2,
        difficulty: "medium" as const,
        sortOrder: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        bankId,
        type: "boolean" as const,
        stem: "在 JavaScript 中，null === undefined 的结果是 true。",
        optionsJson: JSON.stringify([
          { key: "A", text: "正确" },
          { key: "B", text: "错误" },
        ]),
        answerJson: JSON.stringify(["B"]),
        analysis:
          "null === undefined 返回 false。虽然 null == undefined 是 true，但严格相等（===）比较类型和值，它们类型不同。",
        score: 1,
        difficulty: "medium" as const,
        sortOrder: 3,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        bankId,
        type: "essay" as const,
        stem: "请简述 CSS 盒模型的组成部分。",
        optionsJson: JSON.stringify([]),
        answerJson: JSON.stringify([]),
        referenceAnswer:
          "CSS 盒模型由四个部分组成：content（内容区）、padding（内边距）、border（边框）、margin（外边距）。content 是实际内容区域，padding 是内容与边框之间的空间，border 是盒子的边框，margin 是盒子与其他元素之间的距离。",
        analysis:
          "盒模型是 CSS 布局的基础概念，理解它对页面布局至关重要。",
        score: 5,
        difficulty: "medium" as const,
        sortOrder: 4,
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const q of questions) {
      await db.insert(schema.questions).values(q);
    }
    console.log("✅ 示例题库创建成功：前端基础（5 道题）");
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      console.log("ℹ️  示例题库已存在，跳过");
    } else {
      throw e;
    }
  }

  console.log("\n🎉 初始化完成！");
  console.log("管理员：admin / admin123");
  console.log("测试用户：student1 / 123456");
}

main().catch(console.error);
