import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { questionBanks, questions, attempts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";

// 开始答题（创建 attempt）
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  try {
    const user = await requireUser();
    const { bankId } = await params;

    // 验证书库存在且已发布
    const bank = await db
      .select()
      .from(questionBanks)
      .where(
        and(
          eq(questionBanks.id, bankId),
          eq(questionBanks.status, "published")
        )
      )
      .limit(1);

    if (!bank[0]) {
      return jsonError("题库不存在或未发布", 404);
    }

    // 获取题目
    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.bankId, bankId));

    if (qs.length === 0) {
      return jsonError("题库暂无题目", 400);
    }

    const now = new Date().toISOString();
    const attemptId = nanoid();

    // 计算总分
    const totalScore = qs.reduce((sum, q) => sum + q.score, 0);

    await db.insert(attempts).values({
      id: attemptId,
      userId: user.userId,
      bankId,
      status: "in_progress",
      totalScore,
      startedAt: now,
      createdAt: now,
    });

    // 返回题目（不包含答案）
    const questionsForUser = qs.map((q) => ({
      id: q.id,
      type: q.type,
      stem: q.stem,
      options: JSON.parse(q.optionsJson),
      score: q.score,
      sortOrder: q.sortOrder,
    }));

    return jsonOk({
      attemptId,
      bank: { id: bank[0].id, title: bank[0].title },
      questions: questionsForUser,
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
