/**
 * Sentinelles planifiées.
 *
 * Déclenchement par Vercel Cron (`/api/cron/sentinels`, toutes les 30 min)
 * avec `Authorization: Bearer $CRON_SECRET`, ou par un administrateur depuis
 * l'onglet Radar. Sans secret, la route refuse : elle scanne du contenu et
 * écrit des alertes, elle ne doit pas être publique.
 *
 * La réponse ne contient aucun contenu de message : seulement des constats,
 * des compteurs et des catégories.
 */
import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { runSentinels } from "@/lib/ai/sentinels";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

async function isAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const rows = await withUser(userId, (query) =>
      query<{ is_admin: boolean }>(
        "select is_admin from public.users where id = $1 limit 1",
        [userId],
      ),
    );
    return rows[0]?.is_admin === true;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  const cronAllowed = Boolean(secret) && authorization === `Bearer ${secret}`;
  const adminAllowed = await isAdmin(await currentUserId().catch(() => null));

  if (!cronAllowed && !adminAllowed) {
    return NextResponse.json(
      {
        error: secret
          ? "non autorisé"
          : "sentinelles non configurées : CRON_SECRET est absent et la session n'est pas administratrice",
      },
      { status: secret ? 401 : 503, headers: NO_STORE },
    );
  }

  try {
    const report = await runSentinels();
    return NextResponse.json({ ok: true, ...report }, { headers: NO_STORE });
  } catch (error) {
    console.error(
      "[sentinels] exécution impossible",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "sentinelles indisponibles" },
      { status: 503, headers: NO_STORE },
    );
  }
}
