import { NextResponse } from "next/server";

/**
 * Sonde de disponibilité du backend, exécutée **côté serveur**.
 *
 * Le navigateur qui sonde `/rest/v1/posts` pendant que Supabase est coupé
 * récolte un 500 du proxy — et Chromium consigne toute réponse 4xx/5xx
 * dans la console, même gérée : le mode démo s'affichait avec des erreurs
 * « échec de ressource » qui ne signalaient rien de cassé. En interrog-
 * eant côté serveur, la réponse du navigateur est toujours un 200 JSON :
 * l'état (en ligne ou hors ligne) est une donnée, pas un échec.
 */
export async function GET() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!base) {
    return NextResponse.json({
      state: "offline",
      reason: "NEXT_PUBLIC_SUPABASE_URL n'est pas défini",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/rest/v1/posts?select=id&limit=1`,
      {
        signal: controller.signal,
        cache: "no-store",
        headers: anonKey ? { apikey: anonKey } : undefined,
      }
    );
    if (res.status >= 500) {
      return NextResponse.json({
        state: "offline",
        reason: `Le backend répond ${res.status} — la base est injoignable.`,
      });
    }
    return NextResponse.json({ state: "online", status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      state: "offline",
      reason: `Le backend ne répond pas (${msg}).`,
    });
  } finally {
    clearTimeout(timer);
  }
}
