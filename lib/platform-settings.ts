/**
 * Lecture des réglages d'exploitation.
 *
 * Une seule requête, un seul endroit. Les réglages vivent dans
 * `plugin_state` (`plugin_id = 'platform'`), écrits uniquement par
 * `set_platform_settings` — cette fonction ne fait que lire.
 *
 * Elle est volontairement **tolérante à la panne** : si la table n'existe
 * pas encore (base antérieure à la migration 071) ou si la lecture échoue,
 * on renvoie les valeurs par défaut. Une plateforme qui refuse de démarrer
 * parce qu'elle ne peut pas lire son propre drapeau de maintenance serait
 * une panne causée par la protection contre la panne.
 */

export type PlatformSettings = {
  maintenance: boolean;
  maintenance_message: string;
  signups_enabled: boolean;
};

export const PLATFORM_SETTINGS_DEFAULTS: PlatformSettings = {
  maintenance: false,
  maintenance_message: "DevNet revient dans un instant. Merci de patienter.",
  signups_enabled: true,
};

type Query = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
) => Promise<T[]>;

function normalise(raw: unknown): PlatformSettings {
  const value = (raw ?? {}) as Partial<PlatformSettings>;
  return {
    maintenance: value.maintenance === true,
    maintenance_message:
      typeof value.maintenance_message === "string" && value.maintenance_message.trim()
        ? value.maintenance_message
        : PLATFORM_SETTINGS_DEFAULTS.maintenance_message,
    signups_enabled: value.signups_enabled !== false,
  };
}

/**
 * Lit les réglages avec une fonction de requête fournie.
 *
 * `query` vient de `withUser` (identité de l'appelant, RLS appliqué) ou du
 * pool direct pour les chemins sans session, comme l'inscription.
 */
export async function readPlatformSettings(query: Query): Promise<PlatformSettings> {
  try {
    const rows = await query<{ settings: unknown }>(
      "select settings from public.plugin_state where plugin_id = 'platform' limit 1",
    );
    return normalise(rows[0]?.settings);
  } catch {
    return { ...PLATFORM_SETTINGS_DEFAULTS };
  }
}
