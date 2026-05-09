import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { attempts, attemptAnswers, questions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { calculateScore } from "@/lib/quiz/grading";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";


// 提交答题

export const dynamic = 'force-dynamic';

export async function POST(
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

    if (attempt[0].status !== "in_progress") {
      return jsonError("已提交过", 400);
    }

    // 获取所有题目
    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.bankId, attempt[0].bankId));

    // 获取用户答案
    const answers = await db
      .select()
      .from(attemptAnswers)
      .where(eq(attemptAnswers.attemptId, attemptId));

    const userAnswers = answers.map((a) => ({
      questionId: a.questionId,
      answer: a.userAnswerJson ? (JSON.parse(a.userAnswerJson) as string[]) : [],
    }));

    // 计算成绩
    const questionData = qs.map((q) => ({
      questionId: q.id,
      type: q.type,
      answerJson: q.answerJson,
      score: q.score,
    }));

    const result = calculateScore(questionData, userAnswers);
    const now = new Date().toISOString();

    // 更新答题记录
    await db
      .update(attempts)
      .set({
        status: "submitted",
        earnedScore: result.earnedScore,
        submittedAt: now,
      })
      .where(eq(attempts.id, attemptId));

    // 更新每题的判定结果
    for (const r of result.results) {
      const existing = answers.find((a) => a.questionId === r.questionId);
      if (existing) {
        await db
          .update(attemptAnswers)
          .set({
            isCorrect: r.isCorrect === null ? null : r.isCorrect ? 1 : 0,
            earnedScore: r.earnedScore,
            needsGrading: r.needsGrading ? 1 : 0,
          })
          .where(eq(attemptAnswers.id, existing.id));
      }
    }

    return jsonOk({
      totalScore: result.totalScore,
      earnedScore: result.earnedScore,
      needsGrading: result.results.some((r) => r.needsGrading),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
