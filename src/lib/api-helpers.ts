import { NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/permissions";

export function jsonOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

export function handleApiError(error: unknown) {
  if (error instanceof AuthError) {
    const status = error.code === "UNAUTHORIZED" ? 401 : 403;
    return jsonError(error.code, status);
  }
  if (error instanceof Error) {
    return jsonError(error.message, 500);
  }
  return jsonError("Internal Server Error", 500);
}

export function requireRole(user: SessionPayload, role: "admin" | "user") {
  if (user.role !== role) {
    throw new AuthError("FORBIDDEN");
  }
}
