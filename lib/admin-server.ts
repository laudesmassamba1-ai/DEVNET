/**
 * Garde commune des routes d'administration.
 *
 * Le rôle est lu dans `public.users` sous l'identité de la session, jamais
 * dans un en-tête ni dans un cookie. Les routes qui en dépendent ne doivent
 * pas refaire cette vérification chacune à leur manière.
 */
import { currentUserId } from "@/lib/api/server";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export type AdminCheck =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

export type ModeratorLevel = "view" | "moderate" | "sanction" | "manage";

/**
 * Garde de modération, distincte de l'administration.
 *
 * `is_admin` reste un pouvoir plein, mais un modérateur nommé ne doit pas
 * devenir administrateur pour traiter un signalement. Le rôle effectif est
 * calculé en base (`trust_safety_role`), jamais lu dans un en-tête.
 */
export async function requireModerator(level: ModeratorLevel = "moderate"): Promise<AdminCheck> {
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch {
    return { ok: false, status: 503, error: "session indisponible" };
  }
  if (!userId) return { ok: false, status: 401, error: "session requise" };

  const check = {
    view: "can_view_trust_safety",
    moderate: "can_moderate",
    sanction: "can_sanction",
    manage: "can_manage_roles",
  }[level];

  try {
    const rows = await withUser(userId, (query) =>
      query<{ ok: boolean }>(`select public.${check}() as ok`),
    );
    if (rows[0]?.ok !== true) {
      return { ok: false, status: 403, error: "réservé à la modération" };
    }
  } catch {
    return { ok: false, status: 503, error: "rôle indisponible" };
  }

  return { ok: true, userId };
}

export async function requireAdmin(): Promise<AdminCheck> {
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch {
    return { ok: false, status: 503, error: "session indisponible" };
  }

  if (!userId) {
    return { ok: false, status: 401, error: "session requise" };
  }

  try {
    const rows = await withUser(userId, (query) =>
      query<{ is_admin: boolean }>(
        "select is_admin from public.users where id = $1 limit 1",
        [userId],
      ),
    );
    if (rows[0]?.is_admin !== true) {
      return { ok: false, status: 403, error: "réservé à l'administration" };
    }
  } catch {
    return { ok: false, status: 503, error: "rôle indisponible" };
  }

  return { ok: true, userId };
}

export const ADMIN_NO_STORE = { "Cache-Control": "no-store" } as const;
