import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/permissions";
import { nanoid } from "nanoid";
import { jsonOk, handleApiError } from "@/lib/api-helpers";
import { eq } from "drizzle-orm";
import { parseWithDeepSeek } from "@/lib/ai/deepseek";

async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const { extractText: extractPdfText } = await import("unpdf");
    const buffer = await file.arrayBuffer();
    const { text } = await extractPdfText(new Uint8Array(buffer), { mergePages: true });
    if (!text || text.trim().length === 0) {
      throw new Error("PDF 内容为空或无法提取文字（可能是扫描件）");
    }
    return text;
  }

  // txt, md, 其他文本文件
  return file.text();
}

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const jobs = await db.select().from(importJobs);
    return jsonOk(jobs);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  console.log("[import] POST 收到请求, content-type:", req.headers.get("content-type"), "content-length:", req.headers.get("content-length"));
  try {
    const admin = await requireAdmin();
    console.log("[import] admin 认证通过:", admin.userId);
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return jsonOk({ message: "请上传文件" }, 400);
    }

    const now = new Date().toISOString();
    const id = nanoid();

    await db.insert(importJobs).values({
      id,
      filename: file.name,
      status: "parsing",
      createdBy: admin.userId,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const content = await extractText(file);
      const parsed = await parseWithDeepSeek(content);

      await db
        .update(importJobs)
        .set({
          parsedJson: JSON.stringify(parsed),
          status: "parsed",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(importJobs.id, id));

      return jsonOk({ id, status: "parsed" }, 201);
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : "AI 解析失败";
      console.error("[import] 解析失败:", msg);
      await db
        .update(importJobs)
        .set({
          status: "failed",
          errorMessage: msg,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(importJobs.id, id));

      return jsonOk({ id, status: "failed", message: msg }, 422);
    }
  } catch (error) {
    return handleApiError(error);
  }
}

