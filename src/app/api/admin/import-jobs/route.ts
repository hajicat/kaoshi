import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/permissions";
import { nanoid } from "nanoid";
import { jsonOk, handleApiError } from "@/lib/api-helpers";
import { eq } from "drizzle-orm";
import { parseWithDeepSeek } from "@/lib/ai/deepseek";


// 获取导入任务列表

export const dynamic = 'force-dynamic';

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

    try {
      const parsed = await parseWithDeepSeek(content);

      await db
        .update(importJobs)
        .set({
          parsedJson: JSON.stringify(parsed),
          status: "parsed",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(importJobs.id, id));

      return jsonOk({ id, status: "parsed" }, 201);
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : "AI 解析失败";
      await db
        .update(importJobs)
        .set({
          status: "failed",
          errorMessage: msg,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(importJobs.id, id));

      return jsonOk({ id, status: "failed", errorMessage: msg }, 201);
    }
  } catch (error) {
    return handleApiError(error);
  }
}

