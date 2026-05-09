import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { questionBanks, questions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireAdmin } from "@/lib/auth/permissions";
import { CreateQuestionBankSchema } from "@/lib/validation/question";
import { jsonOk, jsonError, handleApiError } from "@/lib/api-helpers";


// 获取题库列表

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const banks = await db.select().from(questionBanks);
    return jsonOk(banks);
  } catch (error) {
    return handleApiError(error);
  }
}

// 创建题库

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const data = CreateQuestionBankSchema.parse(body);

    const now = new Date().toISOString();
    const id = nanoid();

    await db.insert(questionBanks).values({
      id,
      title: data.title,
      description: data.description ?? null,
      subject: data.subject ?? null,
      version: data.version ?? null,
      status: "draft",
      createdBy: admin.userId,
      createdAt: now,
      updatedAt: now,
    });

    return jsonOk({ id }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
