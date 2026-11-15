import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Suppression de contenu signalé.
 *
 * Le module « Contenu » listait les signalements et ne permettait rien :
 * la migration 011 renvoie la suppression « aux politiques habituelles, à
 * l'auteur ». Un administrateur voyait donc un contenu condamnable et
 * devait attendre que son auteur veuille bien l'effacer.
 *
 * La suppression passe par `admin_delete_content`, qui vérifie
 * `is_admin()`, n'accepte qu'une liste blanche de types (un nom de table
 * fourni par l'appelant serait une injection, même en `security definer`)
 * et journalise l'auteur, l'aperçu et le motif avant de rendre la main.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  let body: { targetType?: unknown; targetId?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "corps JSON invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  const targetType = typeof body.targetType === "string" ? body.targetType : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 280) : null;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(targetId)) {
    return NextResponse.json(
      { error: "identifiant invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const rows = await withUser(admin.userId, (query) =>
      query<{ result: unknown }>(
        "select public.admin_delete_content($1, $2::uuid, $3) as result",
        [targetType, targetId, reason],
      ),
    );
    return NextResponse.json({ result: rows[0]?.result ?? null }, { headers: ADMIN_NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/inconnu|introuvable|réservé/.test(message)) {
      return NextResponse.json(
        { error: message },
        { status: message.includes("introuvable") ? 404 : 400, headers: ADMIN_NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "suppression impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}
