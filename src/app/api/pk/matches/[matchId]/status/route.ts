import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { pkMatches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";


// 获取 PK 状态（轮询用）

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
    const isCreator = m.creatorId === user.userId;
    const isOpponent = m.opponentId === user.userId;

    if (!isCreator && !isOpponent) {
      return jsonError("无权查看", 403);
    }

    return jsonOk({
      id: m.id,
      status: m.status,
      bankId: m.bankId,
      creatorId: m.creatorId,
      opponentId: m.opponentId,
      creatorScore: m.creatorScore,
      opponentScore: m.opponentScore,
      creatorTimeMs: m.creatorTimeMs,
      opponentTimeMs: m.opponentTimeMs,
      winnerId: m.winnerId,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
      myRole: isCreator ? "creator" : "opponent",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
