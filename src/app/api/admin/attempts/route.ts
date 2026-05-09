import { db } from "@/lib/db/client";
import { attempts, users, questionBanks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/permissions";
import { jsonOk, handleApiError } from "@/lib/api-helpers";

export async function GET() {
  try {
    await requireAdmin();

    const allAttempts = await db
      .select({
        id: attempts.id,
        userId: attempts.userId,
        bankId: attempts.bankId,
        status: attempts.status,
        totalScore: attempts.totalScore,
        earnedScore: attempts.earnedScore,
        startedAt: attempts.startedAt,
        submittedAt: attempts.submittedAt,
        username: users.username,
        nickname: users.nickname,
        bankTitle: questionBanks.title,
      })
      .from(attempts)
      .leftJoin(users, eq(attempts.userId, users.id))
      .leftJoin(questionBanks, eq(attempts.bankId, questionBanks.id));

    return jsonOk(allAttempts);
  } catch (error) {
    return handleApiError(error);
  }
}
