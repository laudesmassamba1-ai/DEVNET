import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registre des incidents d'exploitation.
 *
 * Le module existait dans la navigation et n'avait ni table ni route :
 * il annonçait « à instrumenter ». Il lit maintenant un vrai registre,
 * et l'écriture passe par `open_incident` / `resolve_incident`, qui
 * vérifient le rôle et journalisent.
 *
 * La lecture est ouverte à tout compte authentifié : savoir que la
 * plateforme traverse un incident n'est pas une information sensible, et
 * c'est même ce qu'un utilisateur veut comprendre quand quelque chose
 * casse.
 */

type IncidentRow = {
  id: string;
  title: string;
  body: string;
  severity: "minor" | "major" | "critical";
  status: "open" | "monitoring" | "resolved";
  created_at: string;
  resolved_at: string | null;
  opened_by_pseudo: string | null;
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
      query<IncidentRow>(`
        select i.id, i.title, i.body, i.severity, i.status,
               i.created_at, i.resolved_at,
               u.pseudo as opened_by_pseudo
          from public.platform_incidents i
          left join public.users u on u.id = i.opened_by
         order by i.status <> 'resolved' desc, i.created_at desc
         limit 200
      `),
    );
    return NextResponse.json({ incidents: rows }, { headers: ADMIN_NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "registre indisponible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  let body: { title?: unknown; body?: unknown; severity?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "corps JSON invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.body === "string" ? body.body.slice(0, 2000) : "";
  const severity =
    body.severity === "major" || body.severity === "critical" ? body.severity : "minor";

  if (title.length < 3 || title.length > 140) {
    return NextResponse.json(
      { error: "titre : 3 à 140 caractères" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const rows = await withUser(admin.userId, (query) =>
      query<{ id: string }>("select public.open_incident($1, $2, $3) as id", [
        title,
        text,
        severity,
      ]),
    );
    return NextResponse.json({ id: rows[0]?.id ?? null }, { headers: ADMIN_NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/gravité|réservé/.test(message)) {
      return NextResponse.json({ error: message }, { status: 400, headers: ADMIN_NO_STORE });
    }
    return NextResponse.json(
      { error: "ouverture impossible" },
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
    body.status === "open" || body.status === "monitoring" || body.status === "resolved"
      ? body.status
      : null;
  const resolution = typeof body.resolution === "string" ? body.resolution.slice(0, 500) : null;

  if (!id || !status) {
    return NextResponse.json(
      { error: "identifiant ou statut invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    await withUser(admin.userId, (query) =>
      query("select public.resolve_incident($1::uuid, $2, $3)", [id, status, resolution]),
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
