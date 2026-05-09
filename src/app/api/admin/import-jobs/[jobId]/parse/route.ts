import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/permissions";
import { buildParsePrompt } from "@/lib/ai/prompt";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";


// 触发 AI 解析

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    await requireAdmin();
    const { jobId } = await params;

    const job = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .limit(1);

    if (!job[0]) {
      return jsonError("任务不存在", 404);
    }

    if (job[0].status !== "uploading" && job[0].status !== "failed") {
      return jsonError("当前状态不允许解析", 400);
    }

    // 更新状态为解析中
    await db
      .update(importJobs)
      .set({ status: "parsing", updatedAt: new Date().toISOString() })
      .where(eq(importJobs.id, jobId));

    // 实际项目中这里应该调用 AI API
    // 目前返回一个提示，让用户手动确认
    // AI 解析需要配合外部 API（如 OpenAI、Workers AI）

    return jsonOk({
      message: "解析任务已提交。在完整实现中，此处会调用 AI API 进行解析。",
      prompt: buildParsePrompt("（文件内容将在这里）"),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
