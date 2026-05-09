import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { attempts, attemptAnswers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";

// 获取答题详情（含已保存的答案）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  try {
    const user = await requireUser();
    const { attemptId } = await params;

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

    const answers = await db
      .select()
      .from(attemptAnswers)
      .where(eq(attemptAnswers.attemptId, attemptId));

    return jsonOk({
      attempt: attempt[0],
      answers: answers.map((a) => ({
        questionId: a.questionId,
        userAnswer: a.userAnswerJson ? JSON.parse(a.userAnswerJson) : null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
