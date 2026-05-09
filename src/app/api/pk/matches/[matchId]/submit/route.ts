import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { pkMatches, questions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { calculateScore } from "@/lib/quiz/grading";
import { finishMatch } from "@/lib/pk/pk-service";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";

// 提交 PK 答案
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const user = await requireUser();
    const { matchId } = await params;
    const body = await req.json();
    const { answers, timeMs } = body;

    if (!Array.isArray(answers) || typeof timeMs !== "number") {
      return jsonError("参数错误", 400);
    }

    const match = await db
      .select()
      .from(pkMatches)
      .where(eq(pkMatches.id, matchId))
      .limit(1);

    if (!match[0]) {
      return jsonError("对战不存在", 404);
    }

    if (match[0].status !== "active") {
      return jsonError("对战未开始或已结束", 400);
    }

    const m = match[0];
    const isCreator = m.creatorId === user.userId;
    const isOpponent = m.opponentId === user.userId;

    if (!isCreator && !isOpponent) {
      return jsonError("无权参与", 403);
    }

    // 获取题目并计算分数
    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.bankId, m.bankId));

    const questionData = qs.map((q) => ({
      questionId: q.id,
      type: q.type,
      answerJson: q.answerJson,
      score: q.score,
    }));

    const result = calculateScore(questionData, answers);

    // 更新 PK 记录
    const updateData: Record<string, unknown> = {};
    if (isCreator) {
      updateData.creatorScore = result.earnedScore;
      updateData.creatorTimeMs = timeMs;
    } else {
      updateData.opponentScore = result.earnedScore;
      updateData.opponentTimeMs = timeMs;
    }

    await db
      .update(pkMatches)
      .set(updateData)
      .where(eq(pkMatches.id, matchId));

    // 如果双方都提交了，判定胜负
    const updatedMatch = await db
      .select()
      .from(pkMatches)
      .where(eq(pkMatches.id, matchId))
      .limit(1);

    if (
      updatedMatch[0].creatorScore !== null &&
      updatedMatch[0].opponentScore !== null
    ) {
      await finishMatch(matchId);
    }

    return jsonOk({
      score: result.earnedScore,
      totalScore: result.totalScore,
      timeMs,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
