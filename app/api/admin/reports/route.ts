import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportRow = {
  id: string;
  target_type: string;
  reason: string;
  details: string;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
  resolved_at: string | null;
  reporter_pseudo: string;
  target_preview: string;
  target_user_pseudo: string | null;
};

/** Tous les signalements, avec un aperçu de la cible — réservé aux admins. */
export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const result = await getPostgresPool().query<ReportRow>(`
      select
        r.id, r.target_type, r.reason, r.details, r.status,
        r.created_at, r.resolved_at,
        reporter.pseudo as reporter_pseudo,
        coalesce(p.text, c.text, m.text, reported.pseudo, '') as target_preview,
        reported.pseudo as target_user_pseudo
      from public.reports r
      join public.users reporter on reporter.id = r.reporter_id
      left join public.posts p on p.id = r.post_id
      left join public.comments c on c.id = r.comment_id
      left join public.group_messages m on m.id = r.message_id
      left join public.users reported on reported.id = r.reported_user
      order by r.status = 'open' desc, r.created_at desc
      limit 250
    `);
    return NextResponse.json({ reports: result.rows }, { headers: ADMIN_NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "lecture des signalements impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}

/** Classe un signalement. Le trigger de la base pose `resolved_at`. */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  let body: { id?: unknown; status?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "corps illisible" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  const id = typeof body.id === "string" ? body.id : "";
  const status =
    body.status === "resolved" || body.status === "dismissed"
      ? body.status
      : null;
  if (!id || !status) {
    return NextResponse.json(
      { error: "identifiant ou statut invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const result = await getPostgresPool().query(
      `update public.reports
          set status = $2
        where id = $1
        returning id, status, resolved_at`,
      [id, status],
    );
    if (result.rowCount !== 1) {
      return NextResponse.json(
        { error: "signalement introuvable" },
        { status: 404, headers: ADMIN_NO_STORE },
      );
    }
    return NextResponse.json(
      { report: result.rows[0] },
      { headers: ADMIN_NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "classement impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}
