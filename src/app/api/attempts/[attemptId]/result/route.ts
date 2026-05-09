import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { attempts, attemptAnswers, questions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";

// 获取答题结果
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

    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.bankId, attempt[0].bankId));

    // 组装结果
    const results = qs.map((q) => {
      const answer = answers.find((a) => a.questionId === q.id);
      return {
        questionId: q.id,
        type: q.type,
        stem: q.stem,
        options: JSON.parse(q.optionsJson),
        correctAnswer: JSON.parse(q.answerJson),
        userAnswer: answer?.userAnswerJson
          ? JSON.parse(answer.userAnswerJson)
          : null,
        isCorrect: answer?.isCorrect,
        earnedScore: answer?.earnedScore ?? 0,
        score: q.score,
        analysis: q.analysis,
        referenceAnswer: q.referenceAnswer,
        needsGrading: answer?.needsGrading === 1,
      };
    });

    return jsonOk({
      attempt: attempt[0],
      results,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
