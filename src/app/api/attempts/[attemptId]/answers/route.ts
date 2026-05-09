import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { attempts, attemptAnswers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";


// 保存/更新单题答案（答题过程中自动保存）

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  try {
    const user = await requireUser();
    const { attemptId } = await params;
    const body = await req.json();
    const { questionId, answer } = body;

    if (!questionId || !Array.isArray(answer)) {
      return jsonError("参数错误", 400);
    }

    // 验证 attempt 属于当前用户
    const attempt = await db
      .select()
      .from(attempts)
      .where(
        and(eq(attempts.id, attemptId), eq(attempts.userId, user.userId))
      )
      .limit(1);

    if (!attempt[0]) {
      return jsonError("记录不存在", 404);
    }

    if (attempt[0].status !== "in_progress") {
      return jsonError("答题已结束", 400);
    }

    const now = new Date().toISOString();

    // 查找是否已有该题答案
    const existing = await db
      .select()
      .from(attemptAnswers)
      .where(
        and(
          eq(attemptAnswers.attemptId, attemptId),
          eq(attemptAnswers.questionId, questionId)
        )
      )
      .limit(1);

    if (existing[0]) {
      // 更新
      await db
        .update(attemptAnswers)
        .set({ userAnswerJson: JSON.stringify(answer) })
        .where(eq(attemptAnswers.id, existing[0].id));
    } else {
      // 新建
      await db.insert(attemptAnswers).values({
        id: nanoid(),
        attemptId,
        questionId,
        userAnswerJson: JSON.stringify(answer),
        createdAt: now,
      });
    }

    return jsonOk({ message: "已保存" });
  } catch (error) {
    return handleApiError(error);
  }
}
