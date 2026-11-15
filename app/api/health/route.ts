import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness : le processus répond. Ne touche pas la base. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { status: "ok", uptimeSeconds: Math.round(process.uptime()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
