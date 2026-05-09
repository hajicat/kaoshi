import { db } from "@/lib/db/client";
import { pkMatches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export function determineWinner(
  creatorScore: number,
  opponentScore: number,
  creatorTimeMs: number,
  opponentTimeMs: number
): "creator" | "opponent" | "draw" {
  if (creatorScore > opponentScore) return "creator";
  if (opponentScore > creatorScore) return "opponent";
  // 分数相同，用时短者胜
  if (creatorTimeMs < opponentTimeMs) return "creator";
  if (opponentTimeMs < creatorTimeMs) return "opponent";
  return "draw";
}

export async function finishMatch(matchId: string) {
  const match = await db
    .select()
    .from(pkMatches)
    .where(eq(pkMatches.id, matchId))
    .limit(1);

  if (!match[0]) throw new Error("Match not found");
  const m = match[0];

  if (
    m.creatorScore === null ||
    m.opponentScore === null ||
    m.creatorTimeMs === null ||
    m.opponentTimeMs === null
  ) {
    return;
  }

  const result = determineWinner(
    m.creatorScore,
    m.opponentScore,
    m.creatorTimeMs,
    m.opponentTimeMs
  );

  const winnerId =
    result === "draw"
      ? null
      : result === "creator"
        ? m.creatorId
        : m.opponentId;

  await db
    .update(pkMatches)
    .set({
      status: "finished",
      winnerId,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(pkMatches.id, matchId));
}
