import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { MIN_PASSWORD_LENGTH, hashPassword } from "@/modules/auth";
import { readObjectBody, stringField } from "@/modules/auth/http/request";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Consomme un jeton valide, remplace le mot de passe et révoque les sessions. */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await readObjectBody(request);
  const token = body ? (stringField(body, "token") ?? "") : "";
  const newPassword = body ? (stringField(body, "newPassword") ?? "") : "";
  if (!body || !token) {
    return NextResponse.json(
      { error: "Lien invalide ou expiré." },
      { status: 400, headers: NO_STORE },
    );
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Mot de passe : ${MIN_PASSWORD_LENGTH} caractères minimum.` },
      { status: 400, headers: NO_STORE },
    );
  }

  const pool = getPostgresPool();
  const client = await pool.connect().catch(() => null);
  if (!client) {
    return NextResponse.json(
      { error: "Réinitialisation indisponible." },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    await client.query("begin");
    const found = await client.query<{ id: string; user_id: string }>(
      `select id::text as id, user_id::text as user_id
         from public.password_reset_tokens
        where token_hash = $1
          and used_at is null
          and expires_at > now()
        limit 1
        for update`,
      [hashToken(token)],
    );
    const reset = found.rows[0];
    if (!reset) {
      await client.query("rollback");
      return NextResponse.json(
        { error: "Lien invalide ou expiré." },
        { status: 400, headers: NO_STORE },
      );
    }

    const passwordHash = await hashPassword(newPassword);
    await client.query(
      `insert into public.user_credentials (user_id, password_hash, updated_at)
       values ($1, $2, now())
       on conflict (user_id) do update
          set password_hash = excluded.password_hash,
              updated_at = now()`,
      [reset.user_id, passwordHash],
    );
    await client.query(
      "update public.password_reset_tokens set used_at = now() where id = $1",
      [reset.id],
    );
    // Un changement de mot de passe ferme toutes les sessions existantes.
    await client.query("delete from public.sessions where user_id = $1", [reset.user_id]);
    await client.query("commit");
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch {
    await client.query("rollback").catch(() => undefined);
    return NextResponse.json(
      { error: "Réinitialisation indisponible." },
      { status: 503, headers: NO_STORE },
    );
  } finally {
    client.release();
  }
}
