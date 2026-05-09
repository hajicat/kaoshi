import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { pkMatches, questionBanks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";


// 获取 PK 列表（等待中的 + 我参与的）

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();

    const matches = await db
      .select({
        id: pkMatches.id,
        bankId: pkMatches.bankId,
        creatorId: pkMatches.creatorId,
        opponentId: pkMatches.opponentId,
        status: pkMatches.status,
        creatorScore: pkMatches.creatorScore,
        opponentScore: pkMatches.opponentScore,
        winnerId: pkMatches.winnerId,
        createdAt: pkMatches.createdAt,
        bankTitle: questionBanks.title,
      })
      .from(pkMatches)
      .leftJoin(questionBanks, eq(pkMatches.bankId, questionBanks.id));

    return jsonOk(matches);
  } catch (error) {
    return handleApiError(error);
  }
}

// 创建 PK 对战

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const { bankId } = body;

    if (!bankId) {
      return jsonError("请选择题库", 400);
    }

    // 验证书库
    const bank = await db
      .select()
      .from(questionBanks)
      .where(
        and(eq(questionBanks.id, bankId), eq(questionBanks.status, "published"))
      )
      .limit(1);

    if (!bank[0]) {
      return jsonError("题库不存在", 404);
    }

    const now = new Date().toISOString();
    const id = nanoid();

    await db.insert(pkMatches).values({
      id,
      bankId,
      creatorId: user.userId,
      status: "waiting",
      createdAt: now,
    });

    return jsonOk({ id, status: "waiting" }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
