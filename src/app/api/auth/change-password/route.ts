import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/permissions";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { ChangePasswordSchema } from "@/lib/validation/auth";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";



export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await requireUser();
    const body = await req.json();
    const data = ChangePasswordSchema.parse(body);

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user[0]) {
      return jsonError("用户不存在", 404);
    }

    const ok = await verifyPassword(data.oldPassword, user[0].passwordHash);
    if (!ok) {
      return jsonError("旧密码错误", 400);
    }

    const newHash = await hashPassword(data.newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date().toISOString() })
      .where(eq(users.id, session.userId));

    return jsonOk({ message: "密码修改成功" });
  } catch (error) {
    return handleApiError(error);
  }
}
