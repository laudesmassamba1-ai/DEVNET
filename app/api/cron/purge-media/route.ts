/**
 * Job de purge des stories expirées.
 *
 * Déclenchement prévu par Vercel Cron (ou tout ordonnanceur) avec
 * `Authorization: Bearer $CRON_SECRET`. Sans secret configuré, la route
 * répond 503 : elle ne doit jamais devenir un endpoint public qui supprime
 * des données.
 *
 * `retentionHours` est optionnel et borné par la fonction SQL (0-168).
 * La réponse ne contient aucune donnée personnelle, seulement le nombre
 * de lignes supprimées.
 */
import { NextResponse } from "next/server";
import {
  MEDIA_PURGE_DEFAULT_HOURS,
  MEDIA_PURGE_MAX_HOURS,
  purgeExpiredStories,
} from "@/lib/media-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "purge non configurée" },
      { status: 503, headers: NO_STORE },
    );
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401, headers: NO_STORE });
  }

  const requested = new URL(request.url).searchParams.get("retentionHours");
  const parsed = requested === null ? MEDIA_PURGE_DEFAULT_HOURS : Number(requested);
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > MEDIA_PURGE_MAX_HOURS
  ) {
    return NextResponse.json(
      { error: `retentionHours doit être compris entre 0 et ${MEDIA_PURGE_MAX_HOURS}` },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const removed = await purgeExpiredStories(parsed);
    return NextResponse.json({ ok: true, removed }, { headers: NO_STORE });
  } catch (error) {
    console.error(
      "[purge] stories expirées",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "purge indisponible" }, { status: 503, headers: NO_STORE });
  }
}
