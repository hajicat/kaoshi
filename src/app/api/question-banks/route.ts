import { db } from "@/lib/db/client";
import { questionBanks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, handleApiError } from "@/lib/api-helpers";


// 获取已发布的题库列表（用户端）

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();

    const banks = await db
      .select()
      .from(questionBanks)
      .where(eq(questionBanks.status, "published"));

    return jsonOk(banks);
  } catch (error) {
    return handleApiError(error);
  }
}
