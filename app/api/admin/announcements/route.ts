import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Annonces de l'administration.
 *
 * Une annonce publiée est faite pour être lue : la lecture est ouverte à
 * tout compte authentifié, y compris pour les annonces retirées, qui
 * restent dans l'historique avec leur date de retrait. L'écriture passe
 * par `publish_announcement` / `retract_announcement`.
 *
 * Rien n'est supprimé : retirer une annonce la dépublie. Un message qui a
 * été lu par des gens ne s'efface pas parce qu'il n'est plus d'actualité.
 */

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning" | "critical";
  published: boolean;
  created_at: string;
  retracted_at: string | null;
  created_by_pseudo: string | null;
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
      query<AnnouncementRow>(`
        select a.id, a.title, a.body, a.level, a.published,
               a.created_at, a.retracted_at,
               u.pseudo as created_by_pseudo
          from public.platform_announcements a
          left join public.users u on u.id = a.created_by
         order by a.created_at desc
         limit 200
      `),
    );
    return NextResponse.json({ announcements: rows }, { headers: ADMIN_NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "annonces indisponibles" },
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

  let body: { title?: unknown; body?: unknown; level?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "corps JSON invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const level =
    body.level === "warning" || body.level === "critical" ? body.level : "info";

  if (title.length < 3 || title.length > 140) {
    return NextResponse.json(
      { error: "titre : 3 à 140 caractères" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }
  if (text.length < 1 || text.length > 2000) {
    return NextResponse.json(
      { error: "message : 1 à 2000 caractères" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const rows = await withUser(admin.userId, (query) =>
      query<{ id: string }>("select public.publish_announcement($1, $2, $3) as id", [
        title,
        text,
        level,
      ]),
    );
    return NextResponse.json({ id: rows[0]?.id ?? null }, { headers: ADMIN_NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/niveau|réservé/.test(message)) {
      return NextResponse.json({ error: message }, { status: 400, headers: ADMIN_NO_STORE });
    }
    return NextResponse.json(
      { error: "publication impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}

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
      { error: "corps JSON invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json(
      { error: "identifiant requis" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    await withUser(admin.userId, (query) =>
      query("select public.retract_announcement($1::uuid)", [id]),
    );
    return NextResponse.json({ ok: true }, { headers: ADMIN_NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("introuvable")) {
      return NextResponse.json({ error: message }, { status: 404, headers: ADMIN_NO_STORE });
    }
    return NextResponse.json(
      { error: "retrait impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}
