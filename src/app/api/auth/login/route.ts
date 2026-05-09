import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { LoginSchema } from "@/lib/validation/auth";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";



export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = LoginSchema.parse(body);

    const user = await db
      .select()
      .from(users)
      .where(eq(users.username, data.username))
      .limit(1);

    if (!user[0] || user[0].status !== "active") {
      return jsonError("账号或密码错误", 401);
    }

    const ok = await verifyPassword(data.password, user[0].passwordHash);
    if (!ok) {
      return jsonError("账号或密码错误", 401);
    }

    await setSessionCookie({
      userId: user[0].id,
      username: user[0].username,
      role: user[0].role as "admin" | "user",
    });

    return jsonOk({
      user: {
        id: user[0].id,
        username: user[0].username,
        nickname: user[0].nickname,
        role: user[0].role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return handleApiError(error);
  }
}
