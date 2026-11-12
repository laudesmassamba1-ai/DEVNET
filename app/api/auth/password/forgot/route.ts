import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { readObjectBody, stringField } from "@/modules/auth/http/request";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESET_TTL_MS = 30 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function appOrigin(request: Request): string {
  return (
    process.env.APP_PUBLIC_ORIGIN?.trim().replace(/\/+$/, "") ||
    new URL(request.url).origin
  );
}

/**
 * Demande un lien de réinitialisation.
 *
 * La réponse est volontairement identique pour une adresse inconnue et une
 * adresse connue. Si le service d'email n'est pas configuré, on répond 503 :
 * mieux vaut un échec visible qu'un faux « email envoyé ».
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await readObjectBody(request);
  const email = (body ? (stringField(body, "email") ?? "") : "").trim().toLowerCase();
  if (!body || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "adresse email invalide" },
      { status: 400, headers: NO_STORE },
    );
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    return NextResponse.json(
      { error: "L'envoi d'emails n'est pas encore configuré." },
      { status: 503, headers: NO_STORE },
    );
  }

  const pool = getPostgresPool();
  let account: { id: string } | undefined;
  try {
    const result = await pool.query<{ id: string }>(
      "select id::text as id from auth.users where lower(email) = lower($1) limit 1",
      [email],
    );
    account = result.rows[0];
  } catch {
    return NextResponse.json(
      { error: "Réinitialisation indisponible." },
      { status: 503, headers: NO_STORE },
    );
  }

  // Adresse inconnue : même réponse, aucun envoi.
  if (!account) {
    return NextResponse.json({ sent: true }, { headers: NO_STORE });
  }

  const token = randomBytes(32).toString("base64url");
  try {
    await pool.query("begin");
    await pool.query(
      "update public.password_reset_tokens set used_at = now() where user_id = $1 and used_at is null",
      [account.id],
    );
    await pool.query(
      `insert into public.password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, $2, $3)`,
      [account.id, hashToken(token), new Date(Date.now() + RESET_TTL_MS).toISOString()],
    );
    await pool.query("commit");
  } catch {
    await pool.query("rollback").catch(() => undefined);
    return NextResponse.json(
      { error: "Réinitialisation indisponible." },
      { status: 503, headers: NO_STORE },
    );
  }

  const resetUrl = `${appOrigin(request)}/reinitialiser-mot-de-passe?token=${encodeURIComponent(token)}`;
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "Réinitialiser ton mot de passe DevNet",
      text: `Un lien pour choisir un nouveau mot de passe t'attend : ${resetUrl}\n\nIl expire dans 30 minutes et ne peut servir qu'une fois.`,
      html: `<p>Un lien pour choisir un nouveau mot de passe t'attend :</p><p><a href="${resetUrl}">Choisir un nouveau mot de passe</a></p><p>Il expire dans 30 minutes et ne peut servir qu'une fois.</p>`,
    }),
  }).catch(() => null);

  if (!emailResponse?.ok) {
    console.error("[auth] envoi du lien de réinitialisation impossible", emailResponse?.status);
    return NextResponse.json(
      { error: "L'email n'a pas pu être envoyé. Réessaie dans un instant." },
      { status: 502, headers: NO_STORE },
    );
  }

  return NextResponse.json({ sent: true }, { headers: NO_STORE });
}
