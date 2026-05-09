import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { pkMatches, questions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";


// 获取 PK 结果

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const user = await requireUser();
    const { matchId } = await params;

    const match = await db
      .select()
      .from(pkMatches)
      .where(eq(pkMatches.id, matchId))
      .limit(1);

    if (!match[0]) {
      return jsonError("对战不存在", 404);
    }

    const m = match[0];

    if (m.status !== "finished") {
      return jsonError("对战尚未结束", 400);
    }

    // 获取题目
    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.bankId, m.bankId));

    // 获取双方信息
    const [creator, opponent] = await Promise.all([
      db.select().from(users).where(eq(users.id, m.creatorId)).limit(1),
      m.opponentId
        ? db.select().from(users).where(eq(users.id, m.opponentId)).limit(1)
        : Promise.resolve([null]),
    ]);

    return jsonOk({
      match: {
        id: m.id,
        status: m.status,
        creatorScore: m.creatorScore,
        opponentScore: m.opponentScore,
        creatorTimeMs: m.creatorTimeMs,
        opponentTimeMs: m.opponentTimeMs,
        winnerId: m.winnerId,
        startedAt: m.startedAt,
        finishedAt: m.finishedAt,
      },
      creator: creator[0]
        ? { id: creator[0].id, nickname: creator[0].nickname }
        : null,
      opponent: opponent?.[0]
        ? { id: opponent[0].id, nickname: opponent[0].nickname }
        : null,
      questionCount: qs.length,
      isWinner: m.winnerId === user.userId,
      isDraw: m.winnerId === null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
