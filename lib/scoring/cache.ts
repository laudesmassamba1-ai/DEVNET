/**
 * Cache par **SHA de blob**.
 *
 * ## Pourquoi un SHA, et pas un chemin
 *
 * Le moteur git de DevNet calcule déjà le SHA-1 du contenu de chaque blob
 * (`hashBlob`). Ce nom **est** la version du fichier : deux contenus
 * identiques ont le même SHA, deux SHA différents sont deux versions. Un
 * cache indexé par chemin répondrait « je connais ce fichier » à un
 * fichier qui a changé ; indexé par SHA, il répond « je connais ce
 * **contenu** », ce qui est la seule question qui vaille.
 *
 * Deux conséquences directes :
 *
 * - un fichier inchangé n'est **jamais** ré-analysé : l'analyse est la
 *   partie coûteuse (masquage, fonctions, Halstead) ;
 * - l'historique devient presque gratuit. Tracer le score à chaque commit
 *   (`scoreEvolution`) ne recalcule que les fichiers qui ont bougé — donc
 *   un commit de dix fichiers sur mille coûte dix analyses.
 *
 * ## Borné, et pour une raison
 *
 * Un cache sans limite transforme un dépôt suivi sur cent commits en fuite
 * de mémoire : chaque version de chaque fichier y entrerait. On garde donc
 * les `limit` entrées les plus récentes (l'ordre d'insertion d'une `Map`
 * est garanti), et l'API dit combien de fois elle a servi — un cache dont
 * on ne mesure pas l'efficacité est un cache dont on ne sait pas s'il sert.
 */

import { hashBlob } from "../git/objects";

/** Entrées conservées par défaut : un dépôt moyen tient largement dedans. */
export const DEFAULT_CACHE_LIMIT = 512;

export interface BlobCache<T = unknown> {
  /** SHA de blob → valeur, avec le chemin qui l'a produite. */
  entries: Map<string, { path: string; value: T }>;
  /** Nombre maximal d'entrées ; au-delà, les plus anciennes sont évincées. */
  limit: number;
  /** Requêtes servies par le cache. */
  hits: number;
  /** Requêtes qui ont dû être recalculées. */
  misses: number;
}

export function newBlobCache<T>(limit = DEFAULT_CACHE_LIMIT): BlobCache<T> {
  return { entries: new Map(), limit: Math.max(1, limit), hits: 0, misses: 0 };
}

/**
 * Valeur en cache pour ce contenu, ou `null`.
 *
 * Le chemin est vérifié **en plus** du SHA : `analyse` choisit ses règles
 * lexicales d'après l'extension, donc le même contenu lu sous deux
 * chemins différents n'est pas analysable de la même façon. Le SHA seul
 * serait une optimisation fausse.
 */
export function cacheLookup<T>(
  cache: BlobCache<T> | undefined,
  path: string,
  content: string,
): T | null {
  if (!cache) return null;
  const sha = hashBlob(content);
  const hit = cache.entries.get(sha);
  if (!hit || hit.path !== path) {
    cache.misses++;
    return null;
  }
  // Un contenu relu redevient « récent » : il survit à l'éviction.
  cache.entries.delete(sha);
  cache.entries.set(sha, hit);
  cache.hits++;
  return hit.value;
}

/** Mémorise la valeur d'un contenu, en évitant les plus anciennes entrées. */
export function cacheRemember<T>(
  cache: BlobCache<T> | undefined,
  path: string,
  content: string,
  value: T,
): void {
  if (!cache) return;
  const sha = hashBlob(content);
  cache.entries.delete(sha);
  cache.entries.set(sha, { path, value });
  while (cache.entries.size > cache.limit) {
    const oldest = cache.entries.keys().next();
    if (oldest.done) break;
    cache.entries.delete(oldest.value);
  }
}

/** Efficacité du cache — affichée dans les tests et dans les diagnostics. */
export function cacheStats(cache: BlobCache<unknown>): {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
} {
  const total = cache.hits + cache.misses;
  return {
    size: cache.entries.size,
    hits: cache.hits,
    misses: cache.misses,
    hitRate: total > 0 ? cache.hits / total : 0,
  };
}
