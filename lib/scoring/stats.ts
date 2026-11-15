/**
 * Statistiques des faits mesurés.
 *
 * ## Pourquoi ces fonctions, et pas `Math`
 *
 * `Math.max(...xs)` **plante** au-delà de quelques dizaines de milliers
 * d'éléments (`RangeError: Maximum call stack size exceeded`). Le moteur
 * note des dépôts d'utilisateurs ; un fichier de 150 000 lignes suffisait à
 * faire tomber l'analyse. Une boucle ne connaît pas cette limite.
 *
 * ## Pourquoi la médiane, à côté de la moyenne
 *
 * Une moyenne se laisse tirer par un seul point. Un fichier de 4 000 lignes
 * dans un dépôt de vingt fichiers fait croire que le dépôt est énorme, et
 * un unique commit catastrophique déplace la note moyenne d'une série sans
 * que rien d'autre n'ait bougé. La médiane répond à la même question sans
 * donner ce pouvoir à un point isolé — c'est pourquoi le barème s'en sert
 * pour décrire une trajectoire, et l'écran pour décrire une distribution.
 *
 * ## Le bruit n'est pas une valeur
 *
 * Une mesure peut sortir non finie : une division par zéro dans une rampe,
 * un compteur qui déborde, un `NaN` hérité d'un contenu illisible. Une
 * seule de ces valeurs suffisait à empoisonner tout ce qu'elle touchait —
 * une moyenne devenait `NaN`, un score devenait `NaN`, et un chemin SVG
 * contenant `NaN` ne s'affiche pas du tout. Chaque fonction **écarte** donc
 * les valeurs non finies au lieu de les propager : le résultat porte sur ce
 * qui a été mesuré, et il reste un nombre.
 *
 * Le module est pur, sans dépendance, testable directement.
 */

/** Les valeurs finies d'un tableau, dans leur ordre d'origine. */
function finite(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of values) if (Number.isFinite(v)) out.push(v);
  return out;
}

/** Maximum des valeurs finies ; `0` sur un ensemble vide. */
export function maxOf(values: readonly number[]): number {
  // L'accumulateur part de `-Infinity` : initialisé à 0, il rendait `0` pour
  // un tableau entièrement négatif — un maximum faux, silencieux.
  let best = -Infinity;
  for (const v of values) if (Number.isFinite(v) && v > best) best = v;
  return best === -Infinity ? 0 : best;
}

/** Minimum des valeurs finies ; `0` sur un ensemble vide. */
export function minOf(values: readonly number[]): number {
  let best = Infinity;
  for (const v of values) if (Number.isFinite(v) && v < best) best = v;
  return best === Infinity ? 0 : best;
}

/** Moyenne arithmétique des valeurs finies ; `0` s'il n'y en a aucune. */
export function meanOf(values: readonly number[]): number {
  let total = 0;
  let count = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    total += v;
    count++;
  }
  return count > 0 ? total / count : 0;
}

/**
 * Écart-type de population des valeurs finies ; `0` sur moins de deux
 * valeurs.
 *
 * Sur une seule valeur, l'écart-type d'échantillon serait `NaN` ou
 * indéfini : une série d'un point n'a pas de dispersion, donc zéro. C'est
 * la réponse qui se compose avec le reste.
 */
export function stddevOf(values: readonly number[]): number {
  const mean = meanOf(values);
  let squares = 0;
  let count = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    squares += (v - mean) * (v - mean);
    count++;
  }
  return count > 1 ? Math.sqrt(squares / count) : 0;
}

/**
 * Copie triée croissante, valeurs non finies écartées.
 *
 * Les appelants triaient à la main (`[...xs].sort((a, b) => a - b)`) avant
 * d'appeler `percentile` : trois copies du même geste, et un tri qui laisse
 * passer un `NaN` produit un ordre arbitraire — donc un centile arbitraire.
 */
export function sortedCopy(values: readonly number[]): number[] {
  const out = finite(values);
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Centile d'un tableau **trié** (interpolation linéaire, la méthode des
 * tableaux de bord).
 *
 * Le p90 est préféré à la moyenne pour agréger des fonctions : dix
 * fonctions propres et une illisible donnent une belle moyenne et un p90
 * qui, lui, dit la vérité.
 */
export function percentile(sorted: readonly number[], p: number): number {
  // `sorted` est trié, donc retirer des valeurs préserve l'ordre : le
  // centile porte sur ce qui est mesurable.
  const xs = finite(sorted);
  if (!xs.length) return 0;
  const rank = Math.min(1, Math.max(0, p)) * (xs.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return xs[low];
  return xs[low] + (xs[high] - xs[low]) * (rank - low);
}

/** Médiane des valeurs finies, **dans n'importe quel ordre** ; `0` si vide. */
export function medianOf(values: readonly number[]): number {
  return percentile(sortedCopy(values), 0.5);
}
