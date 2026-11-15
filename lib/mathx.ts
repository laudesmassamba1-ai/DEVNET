/**
 * Les primitives mathématiques des moteurs DevNet.
 *
 * ## Pourquoi un module à part
 *
 * Les moteurs de notation (`lib/rating.ts`), de fork (`lib/fork.ts`), de
 * succès (`lib/achievements.ts`) et de défis quotidiens (`lib/challenges.ts`)
 * réutilisent les mêmes chaînes d'agrégation. Les dupliquer exposerait
 * chaque module à une dérive locale : une moyenne harmonique écrite en
 * trois endroits finit en trois moyennes différentes. Ici, **une seule
 * définition**, testée une fois, utilisée partout.
 *
 * Le module est **pur** : aucune dépendance au projet, donc testable tel
 * quel. Une primitive qui dérive d'une autre est bien notée.
 */

/* ------------------------------------------------------------------ */
/* Bornes                                                              */
/* ------------------------------------------------------------------ */

/** Serre `x` dans `[lo, hi]`. Une borne inversée retourne le milieu. */
export function clamp(x: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(Math.max(x, lo), hi);
}

/* ------------------------------------------------------------------ */
/* Moyennes pondérées                                                  */
/* ------------------------------------------------------------------ */

/**
 * La **moyenne harmonique** — le vrai outil quand les facteurs sont
 * multiplicatifs (vitesse ↔ longueur, qualité ↔ volume).
 *
 * Contrairement à la moyenne arithmétique, elle est **dominée par le
 * facteur le plus faible** : savoir faire un seul langage superbement
 * donne une meilleure note que trois langages bâclés en parallèle
 * (à condition naturellement que le barème récompense la maîtrise).
 */
export function harmonicMean(values: number[]): number {
  const valuesSafe = values.filter((v) => Number.isFinite(v) && v > 0);
  if (!valuesSafe.length) return 0;
  const sum = valuesSafe.reduce((a, v) => a + 1 / v, 0);
  return valuesSafe.length / sum;
}

/** Moyenne géométrique pondérée `exp(Σ w log(max(v, ε)) / Σ w)` — le « plancher ». */
export function geometricMean(
  values: number[],
  weights: number[] = [],
  eps = 0.02,
): number {
  const n = values.length;
  if (!n) return 0;
  let acc = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? 1;
    acc += w * Math.log(Math.max(values[i], eps));
    total += w;
  }
  return total > 0 ? Math.exp(acc / total) : 0;
}

/* ------------------------------------------------------------------ */
/* Entropie de Shannon                                                 */
/* ------------------------------------------------------------------ */

/**
 * **Entropie de Shannon** d'une distribution — mesurée en *bits*.
 *
 * `H = −Σ pᵢ·log₂(pᵢ)` — mesurée en bits. Elle atteint son maximum
 * (log₂ k) quand la distribution est uniforme.
 *
 * Elle sert ici à mesurer la **diversité** d'une contribution : un
 * utilisateur qui code trois langages à égalité a une entropie de
 * `log₂(3) ≈ 1.58 bits` — le maximum —, autrement dit sa réputation
 * est **répartie** ; un utilisateur qui ne fait qu'un langage a une
 * entropie de 0, et sa réputation est *concentrée sur un seul poste*.
 * On préfère le premier : c'est un collègue, pas un outil.
 */
export function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + Math.max(b, 0), 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * L'entropie **normalisée** entre 0 et 1 : `H / log₂(k)` où `k` est le
 * nombre de valeurs. 1 signifie « répartition uniforme », 0 signifie
 * « tout au même endroit ». C'est la mesure d'ouvrage utilisée par les
 * systèmes de recommandation — on la préfère ici à l'entropie brute.
 */
export function normalizedEntropy(counts: number[]): number {
  const k = counts.filter((c) => c > 0).length;
  if (k <= 1) return 0;
  return clamp(shannonEntropy(counts) / Math.log2(k), 0, 1);
}

/**
 * **Loi de Heaps** : le nombre de valeurs distinctes vues après `n`
 * items, si chaque item rajoute ~κ·nᵇ nouveaux.
 *
 * Placée dans le moteur de notation, elle mesure l'étendue d'un profil :
 * un profil de 100 fichiers ne révèle pas 100 fois plus de choses qu'un
 * profil de 10 — la croissance sous-linéaire est **attendue**, et la
 * dévier signale une redondance.
 */
export function heapsLaw(n: number, kappa = 10, beta = 0.5): number {
  if (n <= 0) return 0;
  return Math.max(1, Math.round(kappa * Math.pow(n, beta)));
}

/* ------------------------------------------------------------------ */
/* Sigmoïdes                                                           */
/* ------------------------------------------------------------------ */

/**
 * **Sigmoïde logistique** : une valeur douce en 0 et en 1, et une pente
 * maximale au point `mid`. Utilisée pour les paliers à rendement
 * décroissant : un rôle à 5 preuves vaut déjà beaucoup ; 40 preuves
 * dans le même sujet ne valent que 5 de plus.
 */
export function sigmoid(x: number, mid = 10, k = 0.5): number {
  if (Number.isNaN(x)) return 0;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  return 1 / (1 + Math.exp(-k * (x - mid)));
}

/* ------------------------------------------------------------------ */
/* Notations statis­tiques                                             */
/* ------------------------------------------------------------------ */

/**
 * **Intervalle de Wilson** — la *demi-largeur* d'un score de pondération
 * à `z` écarts-types.
 *
 * Contrairement à la moyenne simple, il **corrige pour la taille de
 * l'échantillon** : 3 votes de 5/5 ont un centre Wilson de ~4.4/5,
 * pas 5/5. C'est la seule façon honnête de présenter une note quand n est petit —
 * et sur DevNet, n est presque toujours petit.
 */
export function wilsonCenter(likes: number, total: number, z = 1.96): number {
  if (total <= 0) return 0.5;
  const p = likes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  return clamp(centre, 0, 1);
}

/**
 * **Moyenne bayésienne** — moyenne avec un *prior* de confiance pris
 * sur l'ensemble.
 *
 *     score = (C·m + Σx) / (C + n)
 *
 * où `m` est la note de référence de l'ensemble et `C` un poids de
 * certitude. Contrairement à Wilson (bon pour les proportions 0/1),
 * la bayésienne s'applique aux notes allant de 1 à 5 : le prior
 * reproduit la *distribution* de l'ensemble plutôt que d'écraser les
 * notes rares.
 */
export function bayesianMean(
  values: number[],
  globalMean: number,
  confidence = 10,
): number {
  if (!values.length) return globalMean;
  const sum = values.reduce((a, b) => a + b, 0);
  return (confidence * globalMean + sum) / (confidence + values.length);
}

/* ------------------------------------------------------------------ */
/* Distances                                                           */
/* ------------------------------------------------------------------ */

/**
 * **Distance de Levenshtein** (plus petite substitution qu'il faudrait
 * pour transformer `a` en `b`). Utilisée pour détecter les doublons de
 * défis et de notation : une même preuve soumise deux fois ne paie
 * qu'une ligne d'historique, pas deux.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Une seule ligne d'états — le tableau classique coûte O(|a|·|b|
  // ) de mémoire, ici on n'en garde que la ligne précédente.
  let prev = new Array(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Distance normalisée 0–1 (0 = identique, 1 = rien en commun). */
export function normalizedDistance(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return levenshtein(a, b) / max;
}

/* ------------------------------------------------------------------ */
/* Hachage déterministe                                                */
/* ------------------------------------------------------------------ */

/**
 * **FNV-1a** sur 32 bits. Ce hachage est réputé pour trois raisons :
 * l'implémentation tient en cinq lignes, il n'y a **aucune** dépendance
 * crypto à tirer, et il est déterministe sur toutes les plateformes.
 *
 * Il sert aux **seeds du générateur de défis** : la chaîne
 * `devnet::2026-06-12::defi-1` doit donner la même valeur 32 bits sur
 * toutes les machines, de sorte que le défi du jour ne tire pas une
 * combinaison différente selon le fuseau horaire du lecteur.
 */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h = h ^ input.charCodeAt(i);
    // FNV-1a multiplie par le premier 2ⁿ premier : 16777619 = 2²⁴ + 2⁸ + 0x93.
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Générateur de nombres pseudo-aléatoires **mulberry32**.
 *
 * La propriété qui compte ici n'est pas la cryptographie — ce n'est
 * pas une seed secrète, c'est une seed **publique** : la date suffit,
 * et le tirage est connu de tous. Ce qui compte, c'est que *un même
 * jour = un même défi*, ce que garantit l'exécution déterministe de
 * l'algo sur la même graine.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Échantillonne sans répétition depuis un tableau d'au moins `k` éléments. */
export function sampleUnique<T>(items: T[], k: number, rand: () => number): T[] {
  if (k >= items.length) return [...items];
  const pool = [...items];
  const out: T[] = [];
  while (out.length < k) {
    const i = Math.floor(rand() * pool.length) % pool.length;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
