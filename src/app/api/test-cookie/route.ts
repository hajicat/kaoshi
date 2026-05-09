export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    return Response.json({ ok: true, cookieCount: cookieStore.getAll().length });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
