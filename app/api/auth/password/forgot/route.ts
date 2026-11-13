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
 *
 * Deux fournisseurs sont acceptés, dans cet ordre :
 *
 * 1. **EmailJS** (`EMAILJS_*`) — un modèle d'email est défini dans le
 *    tableau de bord, on n'envoie que des variables. Attention : EmailJS
 *    refuse par défaut les appels hors navigateur ; il faut activer
 *    « API access » dans Account → Security, sinon la réponse est un 403
 *    explicite.
 * 2. **Resend** (`RESEND_API_KEY` + `EMAIL_FROM`) — l'ancien chemin, gardé
 *    pour ne pas casser une installation déjà configurée.
 */

/**
 * Envoie le lien par EmailJS.
 *
 * `template_params` est le contrat du modèle : `to_email`, `reset_url`,
 * `expires_minutes`. Le modèle doit les utiliser (`{{reset_url}}` dans le
 * corps, `{{to_email}}` dans le destinataire).
 */
async function sendWithEmailjs(input: {
  serviceId: string;
  templateId: string;
  publicKey: string;
  privateKey?: string;
  to: string;
  resetUrl: string;
}): Promise<Response | null> {
  return fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: input.serviceId,
      template_id: input.templateId,
      user_id: input.publicKey,
      ...(input.privateKey ? { accessToken: input.privateKey } : {}),
      template_params: {
        to_email: input.to,
        reset_url: input.resetUrl,
        expires_minutes: 30,
      },
    }),
  }).catch(() => null);
}
export async function POST(request: Request): Promise<NextResponse> {
  const body = await readObjectBody(request);
  const email = (body ? (stringField(body, "email") ?? "") : "").trim().toLowerCase();
  if (!body || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "adresse email invalide" },
      { status: 400, headers: NO_STORE },
    );
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const emailjs = {
    serviceId: process.env.EMAILJS_SERVICE_ID?.trim() ?? "",
    templateId: process.env.EMAILJS_TEMPLATE_ID?.trim() ?? "",
    publicKey: process.env.EMAILJS_PUBLIC_KEY?.trim() ?? "",
    privateKey: process.env.EMAILJS_PRIVATE_KEY?.trim() ?? "",
  };
  const useEmailjs = Boolean(
    emailjs.serviceId && emailjs.templateId && emailjs.publicKey,
  );
  const useResend = Boolean(resendKey && from);
  if (!useEmailjs && !useResend) {
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

  const emailResponse = useEmailjs
    ? await sendWithEmailjs({
        serviceId: emailjs.serviceId,
        templateId: emailjs.templateId,
        publicKey: emailjs.publicKey,
        privateKey: emailjs.privateKey || undefined,
        to: email,
        resetUrl,
      })
    : await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
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
    const detail = await emailResponse?.text().catch(() => "");
    console.error(
      "[auth] envoi du lien de réinitialisation impossible",
      useEmailjs ? "emailjs" : "resend",
      emailResponse?.status,
      detail?.slice(0, 200),
    );
    return NextResponse.json(
      { error: "L'email n'a pas pu être envoyé. Réessaie dans un instant." },
      { status: 502, headers: NO_STORE },
    );
  }

  return NextResponse.json({ sent: true }, { headers: NO_STORE });
}
