import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/permissions";
import { UpdateUserSchema } from "@/lib/validation/auth";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";

// 获取单个用户
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin();
    const { userId } = await params;
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return jsonError("用户不存在", 404);
    }

    return jsonOk({
      id: user[0].id,
      username: user[0].username,
      nickname: user[0].nickname,
      role: user[0].role,
      status: user[0].status,
      createdAt: user[0].createdAt,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// 更新用户
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin();
    const { userId } = await params;
    const body = await req.json();
    const data = UpdateUserSchema.parse(body);

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!existing[0]) {
      return jsonError("用户不存在", 404);
    }

    await db
      .update(users)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));

    return jsonOk({ message: "更新成功" });
  } catch (error) {
    return handleApiError(error);
  }
}

// 删除用户（软删除 → 禁用）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin();
    const { userId } = await params;

    await db
      .update(users)
      .set({ status: "disabled", updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));

    return jsonOk({ message: "已禁用" });
  } catch (error) {
    return handleApiError(error);
  }
}
