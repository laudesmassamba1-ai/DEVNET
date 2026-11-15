/**
 * Contexte d'exécution remis à un plugin.
 *
 * Aucun type de fournisseur ici : ni `pg`, ni client GitHub, ni Vercel. Un
 * plugin ne reçoit jamais de connexion à la base, de SQL brut, de session ni
 * de secret du cœur — seulement ce que le cœur veut bien exposer.
 */

export type PluginActor = `plugin:${string}`;

export interface PluginLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Espace clé-valeur du plugin. Les clés sont **toujours** préfixées par le
 * plugin côté adaptateur : un plugin ne peut pas lire les clés d'un autre.
 */
export interface PluginKeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Client HTTP restreint aux hôtes déclarés dans le manifeste. */
export interface PluginHttp {
  getJson<T = unknown>(
    url: string,
    options?: { timeoutMs?: number },
  ): Promise<T>;
}

export interface PluginSettings {
  get<T = unknown>(key: string): T | undefined;
  all(): Record<string, unknown>;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly actor: PluginActor;
  readonly log: PluginLogger;
  readonly store: PluginKeyValueStore | null;
  readonly http: PluginHttp | null;
  readonly settings: PluginSettings;
}
