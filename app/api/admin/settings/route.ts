import { NextRequest, NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Réglages d'exploitation — lecture et écriture.
 *
 * L'écriture ne passe pas par un `update` direct : elle appelle
 * `set_platform_settings`, qui vérifie `is_admin()` en base et journalise
 * dans `admin_audit_log`. Le rôle est donc vérifié deux fois — ici pour
 * rendre un 403 lisible, et en base pour que la règle tienne même si
 * cette route changeait de garde.
 *
 * La lecture est ouverte à tout compte authentifié : sans elle, le mode
 * maintenance ne pourrait s'afficher qu'aux administrateurs, c'est-à-dire
 * à personne de concerné.
 */

type Settings = {
  maintenance: boolean;
  maintenance_message: string;
  signups_enabled: boolean;
};

const DEFAULTS: Settings = {
  maintenance: false,
  maintenance_message: "DevNet revient dans un instant. Merci de patienter.",
  signups_enabled: true,
};

function normalise(raw: unknown): Settings {
  const value = (raw ?? {}) as Partial<Settings>;
  return {
    maintenance: value.maintenance === true,
    maintenance_message:
      typeof value.maintenance_message === "string" && value.maintenance_message.trim()
        ? value.maintenance_message
        : DEFAULTS.maintenance_message,
    signups_enabled: value.signups_enabled !== false,
  };
}

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
      query<{ settings: unknown; updated_at: string }>(
        "select settings, updated_at from public.plugin_state where plugin_id = 'platform' limit 1",
      ),
    );
    const row = rows[0];
    return NextResponse.json(
      {
        settings: normalise(row?.settings),
        updatedAt: row?.updated_at ?? null,
      },
      { headers: ADMIN_NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "réglages indisponibles" },
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

  let patch: unknown;
  try {
    patch = await request.json();
  } catch {
    return NextResponse.json(
      { error: "corps JSON invalide" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return NextResponse.json(
      { error: "objet de réglages attendu" },
      { status: 400, headers: ADMIN_NO_STORE },
    );
  }

  try {
    const rows = await withUser(admin.userId, (query) =>
      query<{ settings: unknown }>(
        "select public.set_platform_settings($1::jsonb) as settings",
        [JSON.stringify(patch)],
      ),
    );
    return NextResponse.json(
      { settings: normalise(rows[0]?.settings) },
      { headers: ADMIN_NO_STORE },
    );
  } catch (error) {
    // Les refus de la fonction sont des erreurs de saisie, pas des pannes :
    // les rendre en 400 avec leur message évite un « 503 » trompeur.
    const message = error instanceof Error ? error.message : "";
    if (/réservé|inconnue|booléen|chaîne|280|objet JSON|absents/.test(message)) {
      return NextResponse.json(
        { error: message },
        { status: 400, headers: ADMIN_NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "écriture impossible" },
      { status: 503, headers: ADMIN_NO_STORE },
    );
  }
}
