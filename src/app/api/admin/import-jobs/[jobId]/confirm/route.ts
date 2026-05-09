import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { importJobs, questions, questionBanks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireAdmin } from "@/lib/auth/permissions";
import { ParsedQuestionBankSchema } from "@/lib/validation/question";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";

// 确认导入题目到题库
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const admin = await requireAdmin();
    const { jobId } = await params;
    const body = await req.json();
    const { bankId } = body;

    if (!bankId) {
      return jsonError("请选择题库", 400);
    }

    const job = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .limit(1);

    if (!job[0]) {
      return jsonError("任务不存在", 404);
    }

    if (job[0].status !== "parsed") {
      return jsonError("任务状态不允许确认导入", 400);
    }

    // 验证书库存在
    const bank = await db
      .select()
      .from(questionBanks)
      .where(eq(questionBanks.id, bankId))
      .limit(1);

    if (!bank[0]) {
      return jsonError("题库不存在", 404);
    }

    // 解析并验证题目数据
    const parsedData = JSON.parse(job[0].parsedJson!);
    const validated = ParsedQuestionBankSchema.parse(parsedData);

    const now = new Date().toISOString();

    // 批量插入题目
    for (let i = 0; i < validated.questions.length; i++) {
      const q = validated.questions[i];
      await db.insert(questions).values({
        id: nanoid(),
        bankId,
        type: q.type,
        stem: q.stem,
        optionsJson: JSON.stringify(q.options),
        answerJson: JSON.stringify(q.answer),
        referenceAnswer: q.referenceAnswer ?? null,
        analysis: q.analysis ?? null,
        score: q.score,
        difficulty: q.difficulty ?? null,
        tagsJson: q.tags.length > 0 ? JSON.stringify(q.tags) : null,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 更新导入任务状态
    await db
      .update(importJobs)
      .set({
        status: "done",
        bankId,
        updatedAt: now,
      })
      .where(eq(importJobs.id, jobId));

    return jsonOk({
      message: `成功导入 ${validated.questions.length} 道题目`,
      count: validated.questions.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
