export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, string> = {};

  try {
    await import("@/lib/db/client");
    results.db = "ok";
  } catch (e) {
    results.db = e instanceof Error ? e.message : String(e);
  }

  try {
    await import("@/lib/db/schema");
    results.schema = "ok";
  } catch (e) {
    results.schema = e instanceof Error ? e.message : String(e);
  }

  try {
    await import("@/lib/auth/password");
    results.password = "ok";
  } catch (e) {
    results.password = e instanceof Error ? e.message : String(e);
  }

  try {
    await import("@/lib/auth/session");
    results.session = "ok";
  } catch (e) {
    results.session = e instanceof Error ? e.message : String(e);
  }

  try {
    await import("@/lib/validation/auth");
    results.validation = "ok";
  } catch (e) {
    results.validation = e instanceof Error ? e.message : String(e);
  }

  try {
    await import("@/lib/api-helpers");
    results.helpers = "ok";
  } catch (e) {
    results.helpers = e instanceof Error ? e.message : String(e);
  }

  return Response.json(results);
}
