import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
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
    const [counts, sessions] = await Promise.all([
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
    ]);

    return NextResponse.json(
      { counts: counts.rows[0], sessions: sessions.rows },
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
    return NextResponse.json({ revoked: true }, { headers: ADMIN_NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "révocation impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}
