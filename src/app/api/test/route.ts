export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ ok: true, env: !!process.env.TURSO_DATABASE_URL });
}
