import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/permissions";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";

// 获取导入任务详情
export async function GET(
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

    return jsonOk({
      ...job[0],
      parsedData: job[0].parsedJson
        ? JSON.parse(job[0].parsedJson)
        : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
