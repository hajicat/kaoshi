import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/permissions";
import { nanoid } from "nanoid";
import { jsonOk, handleApiError } from "@/lib/api-helpers";

// 获取导入任务列表
export async function GET() {
  try {
    await requireAdmin();
    const jobs = await db.select().from(importJobs);
    return jsonOk(jobs);
  } catch (error) {
    return handleApiError(error);
  }
}

// 创建导入任务（上传文件）
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return jsonOk({ message: "请上传文件" }, 400);
    }

    const now = new Date().toISOString();
    const id = nanoid();

    // 读取文件内容
    const content = await file.text();

    await db.insert(importJobs).values({
      id,
      filename: file.name,
      status: "parsing",
      createdBy: admin.userId,
      createdAt: now,
      updatedAt: now,
    });

    // 异步解析：这里简化为同步处理
    // 实际项目中可以用队列或后台任务
    try {
      // 简单的文本解析逻辑（实际应调用 AI）
      const parsed = parseTextContent(content);

      await db
        .update(importJobs)
        .set({
          parsedJson: JSON.stringify(parsed),
          status: "parsed",
          updatedAt: new Date().toISOString(),
        })
        .where(importJobs.id);

      return jsonOk({ id, status: "parsed" }, 201);
    } catch {
      await db
        .update(importJobs)
        .set({
          status: "failed",
          errorMessage: "文件解析失败",
          updatedAt: new Date().toISOString(),
        })
        .where(importJobs.id);

      return jsonOk({ id, status: "failed" }, 201);
    }
  } catch (error) {
    return handleApiError(error);
  }
}

// 简单的文本解析（占位，实际应调用 AI）
function parseTextContent(content: string) {
  // 基础解析：按行分割，尝试识别题目格式
  const lines = content.split("\n").filter((l) => l.trim());
  const questions: Array<{
    type: string;
    stem: string;
    options: Array<{ key: string; text: string }>;
    answer: string[];
    analysis?: string;
    score: number;
  }> = [];

  // 这里只是一个非常简化的解析器
  // 实际项目中应该调用 AI API 来解析
  let current: Record<string, unknown> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测题号（1. 2. 3. 或 1、2、3、）
    if (/^\d+[.、]/.test(trimmed)) {
      if (current) questions.push(current as unknown as (typeof questions)[0]);
      current = {
        type: "single",
        stem: trimmed.replace(/^\d+[.、]\s*/, ""),
        options: [],
        answer: [],
        score: 1,
      };
    }
    // 检测选项（A. B. C. D.）
    else if (/^[A-Da-d][.、]/.test(trimmed) && current) {
      const key = trimmed[0].toUpperCase();
      const text = trimmed.replace(/^[A-Da-d][.、]\s*/, "");
      (current.options as Array<{ key: string; text: string }>).push({
        key,
        text,
      });
    }
    // 检测答案行
    else if (/^(答案|正确答案)[：:]/.test(trimmed) && current) {
      const answerStr = trimmed.replace(/^(答案|正确答案)[：:]\s*/, "");
      current.answer = answerStr.split(/[,，\s]+/).map((a: string) => a.trim().toUpperCase());
    }
    // 检测解析行
    else if (/^(解析|说明)[：:]/.test(trimmed) && current) {
      current.analysis = trimmed.replace(/^(解析|说明)[：:]\s*/, "");
    }
  }

  if (current) questions.push(current as unknown as (typeof questions)[0]);

  return { questions };
}
