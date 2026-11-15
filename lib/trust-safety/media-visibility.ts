/**
 * Visibilité des médias sensibles.
 *
 * L'heuristique de peau ne bloque rien : elle ouvre un constat. Le compte
 * peut demander à ne pas recevoir ces médias avant d'avoir cliqué. La
 * décision se prend donc à la lecture, pas au stockage : le même fichier
 * reste visible pour un compte qui n'a pas activé le filtre.
 */
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export async function isSensitiveMedia(path: string): Promise<boolean> {
  try {
    const result = await getPostgresPool().query<{ sensitive: boolean }>(
      `select exists (
         select 1 from public.moderation_flags
          where target_type = 'media'
            and target_id = $1
            and status in ('open', 'confirmed')
            and (source = 'heuristic' or reason ilike 'Heuristique%')
       ) as sensitive`,
      [path],
    );
    return result.rows[0]?.sensitive === true;
  } catch {
    return false;
  }
}

export async function hidesSensitiveMedia(userId: string): Promise<boolean> {
  try {
    const rows = await withUser(userId, (query) =>
      query<{ hide_sensitive_media: boolean }>(
        "select hide_sensitive_media from public.user_safety_settings where user_id = $1",
        [userId],
      ),
    );
    return rows[0]?.hide_sensitive_media === true;
  } catch {
    return false;
  }
}
