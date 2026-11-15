/**
 * Abonnement aux notifications poussées.
 *
 * `GET` dit si l'appareil peut s'abonner — c'est-à-dire si le serveur a
 * des clés VAPID — et rend la clé publique, la seule qui puisse être
 * envoyée au navigateur. `POST` enregistre l'abonnement de l'appareil
 * courant, `DELETE` le retire.
 *
 * L'identité vient de la session, jamais du corps de la requête : une
 * personne n'enregistre que ses propres appareils. La politique RLS le
 * redit, mais la route ne compte pas sur elle seule.
 */
import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import { pushConfigured, vapidPublicKey } from "@/lib/push/web-push";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const ENDPOINT = /^https:\/\/[^\s"'<>]{1,900}$/;
const KEY = /^[A-Za-z0-9_-]{8,240}$/;

type Incoming = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

function readSubscription(body: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  const raw = (body as { subscription?: Incoming } | null)?.subscription;
  const endpoint = typeof raw?.endpoint === "string" ? raw.endpoint.trim() : "";
  const p256dh = typeof raw?.keys?.p256dh === "string" ? raw.keys.p256dh : "";
  const auth = typeof raw?.keys?.auth === "string" ? raw.keys.auth : "";
  if (!ENDPOINT.test(endpoint) || !KEY.test(p256dh) || !KEY.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { configured: pushConfigured(), publicKey: vapidPublicKey() },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: NO_STORE });
  }

  const subscription = readSubscription(body);
  if (!subscription) {
    return NextResponse.json({ error: "abonnement invalide" }, { status: 400, headers: NO_STORE });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;

  try {
    await withUser(userId, (query) =>
      query(
        `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
         values ($1, $2, $3, $4, $5)
         on conflict (endpoint) do update
           set user_id = excluded.user_id,
               p256dh = excluded.p256dh,
               auth = excluded.auth,
               user_agent = excluded.user_agent,
               last_seen_at = now(),
               last_error = null`,
        [userId, subscription.endpoint, subscription.p256dh, subscription.auth, userAgent],
      ),
    );
  } catch (error) {
    console.error(
      "[push] enregistrement impossible",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "enregistrement impossible" }, { status: 503, headers: NO_STORE });
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const endpoint = readSubscription(body)?.endpoint;
  if (!endpoint) {
    return NextResponse.json({ error: "abonnement invalide" }, { status: 400, headers: NO_STORE });
  }

  try {
    await withUser(userId, (query) =>
      query(`delete from public.push_subscriptions where endpoint = $1 and user_id = $2`, [
        endpoint,
        userId,
      ]),
    );
  } catch {
    // Un abonnement déjà parti n'est pas un échec : le résultat attendu
    // est le même, l'appareil ne recevra plus rien.
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
