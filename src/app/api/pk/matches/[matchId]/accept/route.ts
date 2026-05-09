import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { pkMatches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";


// 接受 PK 挑战

export const dynamic = 'force-dynamic';

export async function POST(
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

    if (match[0].status !== "waiting") {
      return jsonError("对战已开始或已结束", 400);
    }

    if (match[0].creatorId === user.userId) {
      return jsonError("不能和自己 PK", 400);
    }

    const now = new Date().toISOString();

    await db
      .update(pkMatches)
      .set({
        opponentId: user.userId,
        status: "active",
        startedAt: now,
      })
      .where(eq(pkMatches.id, matchId));

    return jsonOk({ message: "已接受挑战" });
  } catch (error) {
    return handleApiError(error);
  }
}
