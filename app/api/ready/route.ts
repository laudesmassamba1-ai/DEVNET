import { NextResponse } from "next/server";
import { checkDatabase } from "@/platform/infrastructure/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness : `select 1` borné, sans jamais exposer l'URL ni le détail SQL. */
export async function GET(): Promise<NextResponse> {
  const health = await checkDatabase(2_000);
  if (health.ok) {
    return NextResponse.json(
      { status: "ready", database: "ok", latencyMs: health.latencyMs },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { status: "degraded", database: health.reason },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
