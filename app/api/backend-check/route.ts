import { NextResponse } from "next/server";
import { checkDatabase } from "@/platform/infrastructure/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sonde de disponibilité du backend, exécutée **côté serveur**.
 *
 * Le navigateur n'interroge jamais PostgreSQL directement : il demande un
 * verdict à cette route. La réponse est toujours un 200 JSON — l'état est une
 * donnée, pas un échec réseau — et ne contient ni URL, ni détail SQL.
 */
export async function GET() {
  if (process.env.NEXT_PUBLIC_FORCE_DEMO === "true") {
    return NextResponse.json({
      state: "offline",
      reason: "Mode démonstration forcé.",
    });
  }

  const health = await checkDatabase(3_000);
  if (health.ok) {
    return NextResponse.json({ state: "online", latencyMs: health.latencyMs });
  }

  return NextResponse.json({
    state: "offline",
    reason:
      health.reason === "not_configured"
        ? "DATABASE_URL n'est pas défini : la base n'est pas configurée."
        : "La base de données ne répond pas.",
  });
}
