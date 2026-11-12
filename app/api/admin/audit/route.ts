import { NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Journal des décisions d'administration, en lecture seule. */
export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const result = await getPostgresPool().query(`
      select a.id, a.action, a.target_type, a.target_id, a.details,
             a.created_at, u.pseudo as actor_pseudo
      from public.admin_audit_log a
      left join public.users u on u.id = a.actor_id
      order by a.created_at desc
      limit 250
    `);
    return NextResponse.json({ entries: result.rows }, { headers: ADMIN_NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "journal d'audit indisponible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}
