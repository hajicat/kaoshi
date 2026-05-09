import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { questionBanks, questions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/permissions";
import { UpdateQuestionBankSchema } from "@/lib/validation/question";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";

// 获取题库详情
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  try {
    await requireAdmin();
    const { bankId } = await params;

    const bank = await db
      .select()
      .from(questionBanks)
      .where(eq(questionBanks.id, bankId))
      .limit(1);

    if (!bank[0]) {
      return jsonError("题库不存在", 404);
    }

    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.bankId, bankId));

    return jsonOk({ ...bank[0], questions: qs });
  } catch (error) {
    return handleApiError(error);
  }
}

// 更新题库
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  try {
    await requireAdmin();
    const { bankId } = await params;
    const body = await req.json();
    const data = UpdateQuestionBankSchema.parse(body);

    const existing = await db
      .select()
      .from(questionBanks)
      .where(eq(questionBanks.id, bankId))
      .limit(1);

    if (!existing[0]) {
      return jsonError("题库不存在", 404);
    }

    await db
      .update(questionBanks)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(questionBanks.id, bankId));

    return jsonOk({ message: "更新成功" });
  } catch (error) {
    return handleApiError(error);
  }
}

// 删除题库
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  try {
    await requireAdmin();
    const { bankId } = await params;

    // 先删题目
    await db.delete(questions).where(eq(questions.bankId, bankId));
    // 再删题库
    await db.delete(questionBanks).where(eq(questionBanks.id, bankId));

    return jsonOk({ message: "已删除" });
  } catch (error) {
    return handleApiError(error);
  }
}
