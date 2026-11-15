/**
 * Limitation de débit, en mémoire du processus.
 *
 * Ce n'est **pas** un pare-feu distribué : sur Vercel, chaque instance a son
 * propre compteur, et un attaquant réparti sur plusieurs instances voit
 * autant de fenêtres. Ce serait malhonnête de le présenter autrement.
 *
 * Ce que ce module fait réellement, et qui suffit contre l'essentiel :
 *  - il arrête une boucle de connexion depuis un même client (le cas le plus
 *    fréquent : un formulaire qui rejoue, un script naïf) ;
 *  - il rend l'attaque par force brute visible dans `security_events`, ce qui
 *    déclenche une alerte et un incident ;
 *  - il ne dépend d'aucun service, donc il fonctionne quand la base est
 *    justement en difficulté.
 *
 * Le compteur est un **verre qui se vide** : on garde les horodatages de la
 * fenêtre, pas un compteur qui se remet à zéro d'un coup. Une rafale à la
 * fin d'une fenêtre ne repart donc pas avec un quota neuf.
 */

type Bucket = { hits: number[]; blockedUntil: number };

const buckets = new Map<string, Bucket>();
/** Au-delà, on purge : sans cela, une attaque par clés aléatoires ferait grossir la carte. */
const MAX_BUCKETS = 5_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimitOptions = {
  /** Nombre d'actions autorisées dans la fenêtre. */
  limit: number;
  /** Durée de la fenêtre. */
  windowMs: number;
  /** Durée du blocage une fois la limite atteinte. */
  blockMs?: number;
};

function purge(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    const last = bucket.hits[bucket.hits.length - 1] ?? 0;
    if (now - last > 10 * 60_000 && bucket.blockedUntil < now) buckets.delete(key);
  }
}

/**
 * Consomme une action pour `key`.
 *
 * Sur un refus, `retryAfterSeconds` est renseigné : les routes l'envoient dans
 * `Retry-After`, ce qui permet à un client correct de patienter au lieu de
 * marteler.
 */
export function rateLimit(
  key: string,
  { limit, windowMs, blockMs = windowMs }: RateLimitOptions,
  now = Date.now(),
): RateLimitResult {
  purge(now);
  const bucket = buckets.get(key) ?? { hits: [], blockedUntil: 0 };

  if (bucket.blockedUntil > now) {
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000),
    };
  }

  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);
  if (bucket.hits.length >= limit) {
    bucket.blockedUntil = now + blockMs;
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(blockMs / 1000) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.hits.length),
    retryAfterSeconds: 0,
  };
}

/** Remet un compteur à zéro — après une connexion réussie, par exemple. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Réponse standard d'un refus, avec l'en-tête que les clients respectent. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (!result.allowed) headers["Retry-After"] = String(result.retryAfterSeconds);
  return headers;
}

/** Remet la carte à zéro. Réservé aux tests. */
export function resetAllRateLimits(): void {
  buckets.clear();
}
