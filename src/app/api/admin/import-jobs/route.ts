import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { importJobs } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/permissions";
import { nanoid } from "nanoid";
import { jsonOk, handleApiError } from "@/lib/api-helpers";
import { eq } from "drizzle-orm";
import { parseWithDeepSeek } from "@/lib/ai/deepseek";

async function extractText(filename: string, buffer: Uint8Array): Promise<string> {
  const name = filename.toLowerCase();

  if (name.endsWith(".pdf")) {
    const { extractText: extractPdfText } = await import("unpdf");
    const { text } = await extractPdfText(buffer, { mergePages: true });
    if (!text || text.trim().length === 0) {
      throw new Error("PDF 内容为空或无法提取文字（可能是扫描件）");
    }
    return text;
  }

  // txt, md, 其他文本文件
  return new TextDecoder().decode(buffer);
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
  console.log("[import] POST 收到请求, content-type:", req.headers.get("content-type"));
  try {
    const admin = await requireAdmin();
    console.log("[import] admin 认证通过:", admin.userId);

    let filename: string;
    let fileBuffer: Uint8Array;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      // JSON + base64 模式
      const body = await req.json();
      filename = body.filename;
      const base64Content = body.content;
      if (!filename || !base64Content) {
        return jsonOk({ message: "缺少文件名或内容" }, 400);
      }
      const binary = atob(base64Content);
      fileBuffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        fileBuffer[i] = binary.charCodeAt(i);
      }
    } else {
      // FormData 模式（兼容旧方式）
      const formData = await req.formData();
      const file = formData.get("file") as File;
      if (!file) {
        return jsonOk({ message: "请上传文件" }, 400);
      }
      filename = file.name;
      fileBuffer = new Uint8Array(await file.arrayBuffer());
    }

    const now = new Date().toISOString();
    const id = nanoid();

    await db.insert(importJobs).values({
      id,
      filename,
      status: "parsing",
      createdBy: admin.userId,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const content = await extractText(filename, fileBuffer);
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

