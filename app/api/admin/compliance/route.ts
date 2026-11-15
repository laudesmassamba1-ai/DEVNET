import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Demandes de conformité : export ou suppression des données d'un compte.
 *
 * Le module « Conformité » était marqué « indisponible ». Il n'y avait ni
 * table ni route : un utilisateur qui demandait ses données n'avait aucun
 * chemin, et l'administration aucun moyen de tracer la réponse.
 *
 * Deux chemins, et deux seulement :
 *  - un compte dépose sa demande (`submit_compliance_request`), une seule
 *    à la fois par type — un clic répété ne doit pas remplir la file ;
 *  - l'administration la traite (`resolve_compliance_request`).
 *
 * La lecture suit la même règle que la table : un compte voit les
 * siennes, l'administration voit tout. C'est la politique RLS qui le
 * garantit, pas cette route.
 */

type ComplianceRow = {
  id: string;
  kind: "export" | "deletion";
  note: string;
  status: "pending" | "in_progress" | "done" | "refused";
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  user_id: string;
  user_pseudo: string | null;
  handled_by_pseudo: string | null;
};

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const rows = await withUser(admin.userId, (query) =>
      query<ComplianceRow>(`
        select c.id, c.kind, c.note, c.status, c.resolution,
               c.created_at, c.resolved_at, c.user_id,
               u.pseudo as user_pseudo,
               h.pseudo as handled_by_pseudo
          from public.compliance_requests c
          left join public.users u on u.id = c.user_id
          left join public.users h on h.id = c.handled_by
         order by c.status in ('done', 'refused') asc, c.created_at desc
         limit 200
      `),
    );
    return NextResponse.json({ requests: rows }, { headers: ADMIN_NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "demandes indisponibles" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  let body: { id?: unknown; status?: unknown; resolution?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "corps JSON invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  const id = typeof body.id === "string" ? body.id : "";
  const status =
    body.status === "in_progress" || body.status === "done" || body.status === "refused"
      ? body.status
      : null;
  const resolution =
    typeof body.resolution === "string" ? body.resolution.slice(0, 500) : null;

  if (!id || !status) {
    return NextResponse.json(
      { error: "identifiant ou statut invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    await withUser(admin.userId, (query) =>
      query("select public.resolve_compliance_request($1::uuid, $2, $3)", [
        id,
        status,
        resolution,
      ]),
    );
    return NextResponse.json({ ok: true }, { headers: ADMIN_NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("introuvable")) {
      return NextResponse.json({ error: message }, { status: 404, headers: ADMIN_NO_STORE });
    }
    if (/statut|réservé/.test(message)) {
      return NextResponse.json({ error: message }, { status: 400, headers: ADMIN_NO_STORE });
    }
    return NextResponse.json(
      { error: "mise à jour impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}
