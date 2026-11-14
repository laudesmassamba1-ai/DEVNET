/**
 * Purge des stories expirées.
 *
 * La fonction SQL `public.purge_expired_stories` est `security definer` :
 * l'appelant n'a pas besoin de `service_role` pour supprimer des lignes
 * dont la seule condition est l'horloge. Elle borne la rétention entre 0
 * et 168 heures et retourne le nombre de stories supprimées.
 */
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export const MEDIA_PURGE_DEFAULT_HOURS = 24;
export const MEDIA_PURGE_MAX_HOURS = 168;

export async function purgeExpiredStories(
  retentionHours: number = MEDIA_PURGE_DEFAULT_HOURS,
): Promise<number> {
  const hours = Number.isFinite(retentionHours)
    ? Math.min(Math.max(Math.trunc(retentionHours), 0), MEDIA_PURGE_MAX_HOURS)
    : MEDIA_PURGE_DEFAULT_HOURS;

  const { rows } = await getPostgresPool().query<{ removed: number }>(
    "select public.purge_expired_stories($1)::int as removed",
    [hours],
  );
  return Number(rows[0]?.removed ?? 0);
}
