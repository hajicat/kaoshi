import { db } from "@/lib/db/client";
import { attempts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { jsonOk, handleApiError } from "@/lib/api-helpers";


// 获取用户的答题记录列表

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();

    const userAttempts = await db
      .select()
      .from(attempts)
      .where(eq(attempts.userId, user.userId));

    return jsonOk(userAttempts);
  } catch (error) {
    return handleApiError(error);
  }
}
