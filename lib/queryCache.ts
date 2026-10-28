"use client";

/**
 * Cache de requêtes simple en mémoire.
 *
 * Évite de refaire les mêmes appels Supabase à chaque navigation.
 * TTL par défaut : 30 secondes (assez pour la navigation, pas trop
 * long pour que les données restent fraîches).
 */

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL = 30_000;

function makeKey(prefix: string, args: unknown[]): string {
  return `${prefix}:${JSON.stringify(args)}`;
}

export function cachedQuery<T>(
  keyPrefix: string,
  args: unknown[],
  fetcher: () => Promise<T>,
  ttl = DEFAULT_TTL,
): Promise<T> {
  const key = makeKey(keyPrefix, args);
  const now = Date.now();
  const entry = cache.get(key);

  // L'ordre compte : une requête **en vol** doit être attendue avant tout.
  // `entry.data` n'est renseigné qu'à la résolution ; le lire d'abord
  // renvoyait `undefined` à tout appelant concurrent (le fil monte deux
  // effets qui lisent la même page) — donc un `null` déguisé.
  if (entry?.promise) {
    return entry.promise as Promise<T>;
  }

  if (entry && now - entry.timestamp < ttl) {
    return Promise.resolve(entry.data as T);
  }

  const promise = fetcher().then((data) => {
    cache.set(key, { data, timestamp: Date.now() });
    return data;
  });

  cache.set(key, { data: null as unknown as T, timestamp: now, promise });
  return promise;
}

export function invalidateCache(pattern?: string) {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}

export function getCachedData<T>(keyPrefix: string, args: unknown[]): T | null {
  const key = makeKey(keyPrefix, args);
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < DEFAULT_TTL) {
    return entry.data as T;
  }
  return null;
}