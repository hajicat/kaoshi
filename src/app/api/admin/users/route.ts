import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireAdmin } from "@/lib/auth/permissions";
import { hashPassword } from "@/lib/auth/password";
import { CreateUserSchema } from "@/lib/validation/auth";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";

// 获取用户列表
export async function GET() {
  try {
    await requireAdmin();
    const allUsers = await db.select().from(users);
    return jsonOk(
      allUsers.map((u) => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}

// 创建用户
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const data = CreateUserSchema.parse(body);

    // 检查用户名是否已存在
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, data.username))
      .limit(1);

    if (existing[0]) {
      return jsonError("用户名已存在", 400);
    }

    const now = new Date().toISOString();
    const id = nanoid();
    const passwordHash = await hashPassword(data.password);

    await db.insert(users).values({
      id,
      username: data.username,
      nickname: data.nickname,
      passwordHash,
      role: data.role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return jsonOk({ id, username: data.username }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
