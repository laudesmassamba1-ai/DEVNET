import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { verifyAuditChain, writeAudit } from "@/lib/admin-audit";
import { recordSecurityEvent } from "@/lib/security/events";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  user_id: string;
  pseudo: string;
  prenom: string;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  active: boolean;
};

/** Sessions et couverture des identifiants — jamais les empreintes. */
export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const pool = getPostgresPool();
    const [counts, sessions, alerts, brute, failed, chain, flags] = await Promise.all([
      pool.query<{
        total: number;
        active: number;
        last_24h: number;
        credentials: number;
        admins: number;
      }>(`
        select
          (select count(*)::int from public.sessions) as total,
          (select count(*)::int from public.sessions where expires_at > now()) as active,
          (select count(*)::int from public.sessions
             where created_at > now() - interval '24 hours') as last_24h,
          (select count(*)::int from public.user_credentials) as credentials,
          (select count(*)::int from public.users where is_admin) as admins
      `),
      pool.query<SessionRow>(`
        select s.id, s.user_id, u.pseudo, u.prenom, s.user_agent,
               s.created_at, s.expires_at,
               (s.expires_at > now()) as active
        from public.sessions s
        join public.users u on u.id = s.user_id
        order by s.created_at desc
        limit 50
      `),
      pool
        .query<{
          id: string;
          kind: string;
          severity: "info" | "warning" | "critical";
          subject: string;
          details: Record<string, unknown>;
          created_at: string;
        }>(`
          select id, kind, severity, subject, details, created_at
            from public.security_events
           order by created_at desc
           limit 50
        `)
        .catch(() => ({ rows: [] })),
      pool
        .query<{ n: string }>(
          `select count(*)::text as n from public.security_events
            where kind = 'auth.bruteforce' and created_at > now() - interval '24 hours'`,
        )
        .then((result) => Number(result.rows[0]?.n ?? 0))
        .catch(() => 0),
      pool
        .query<{ n: string }>(
          `select count(*)::text as n from public.security_events
            where kind = 'auth.failed' and created_at > now() - interval '24 hours'`,
        )
        .then((result) => Number(result.rows[0]?.n ?? 0))
        .catch(() => 0),
      verifyAuditChain(admin.userId).catch(() => null),
      pool
        .query<{ open: string; critical: string }>(
          `select count(*)::text as open,
                  count(*) filter (where severity = 'critical')::text as critical
             from public.moderation_flags where status = 'open'`,
        )
        .then((result) => ({
          open: Number(result.rows[0]?.open ?? 0),
          critical: Number(result.rows[0]?.critical ?? 0),
        }))
        .catch(() => ({ open: 0, critical: 0 })),
    ]);

    return NextResponse.json(
      {
        counts: counts.rows[0],
        sessions: sessions.rows,
        alerts: alerts.rows,
        signals: { bruteForce24h: brute, failedLogins24h: failed },
        auditChain: chain,
        moderation: flags,
      },
      { headers: ADMIN_NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "lecture des sessions impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}

/** Révoque une session. Le jeton courant n'est jamais exposé ni lisible. */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "corps illisible" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json(
      { error: "identifiant invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const result = await getPostgresPool().query(
      "delete from public.sessions where id = $1 returning id",
      [id],
    );
    if (result.rowCount !== 1) {
      return NextResponse.json(
        { error: "session introuvable" },
        { status: 404, headers: ADMIN_NO_STORE },
      );
    }
    await writeAudit({
      actorId: admin.userId,
      action: "security.session.revoke",
      targetType: "session",
      targetId: id,
    });
    await recordSecurityEvent({
      kind: "admin.session.revoked",
      severity: "warning",
      actorId: admin.userId,
      subject: id,
    });
    return NextResponse.json({ revoked: true }, { headers: ADMIN_NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "révocation impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}
