/**
 * Notification de test, envoyée à l'appareil courant.
 *
 * Sert à vérifier la chaîne de bout en bout sans attendre un vrai
 * message : abonnement enregistré, clés VAPID, service de push, service
 * worker. La bannière ne part qu'à soi-même — impossible d'en envoyer à
 * quelqu'un d'autre par cette route.
 *
 * Réponse honnête : « envoyé » signifie remis au service de push du
 * navigateur, pas forcément affiché (permission retirée côté système,
 * app non installée sur iOS, appareil hors ligne). « aucun appareil »
 * signifie qu'aucun abonnement n'est enregistré pour ce compte.
 */
import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { getPostgresPool, hasDatabaseUrl } from "@/platform/infrastructure/postgres/pool";
import { pushConfigured, sendPushToUsers } from "@/lib/push/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }
  if (!pushConfigured() || !hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "push non configuré" },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const count = await getPostgresPool().query<{ n: string }>(
      `select count(*)::int::text as n from public.push_subscriptions where user_id = $1`,
      [userId],
    );
    const devices = Number(count.rows[0]?.n ?? 0);
    if (devices === 0) {
      return NextResponse.json(
        { ok: false, reason: "aucun_appareil", devices: 0 },
        { headers: NO_STORE },
      );
    }

    await sendPushToUsers([userId], {
      title: "DevNet",
      body: "Si tu vois ceci, les alertes écran verrouillé fonctionnent.",
      url: "/settings",
      tag: "test-push",
    });
    return NextResponse.json({ ok: true, devices }, { headers: NO_STORE });
  } catch (error) {
    console.error(
      "[push] test impossible",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "test impossible" }, { status: 500, headers: NO_STORE });
  }
}
