/**
 * La notation de projets par les pairs.
 *
 * ## Le problème que ça résout
 *
 * Un projet avec **un seul 5/5** n'est pas meilleur qu'un projet avec
 * vingt 4/5 : il est juste moins mesuré. Présenter la moyenne brute
 * classe en tête exactement les projets les moins évalués — c'est le
 * piège classique des petits échantillons.
 *
 * ## Le remède : trois garde-fous superposés
 *
 * 1. **Moyenne bayésienne** (`bayesianMean`) : les votes PARTENT d'un
 *    prior — la moyenne de tous les projets de la plateforme — et la
 *    gagnent à mesure que les votes arrivent. Noté par 2 personnes, un
 *    projet reste près du plat de départ ; noté par 50, son vrai
 *    visage apparaît.
 * 2. **Incertitude de Wilson** (`wilsonCenter`) sur la proportion de
 *    votes « utiles » (4–5), affichée comme indicateur de solidité.
 * 3. **Entropie de Shannon** sur le langage des votants, affichée comme
 *    indicateur de diversité du jury.
 *
 * La note reste la moyenne bayésienne. La confiance et la diversité
 * décrivent les votes, pas la qualité intrinsèque du projet : elles ne
 * doivent pas pénaliser un projet récent ou une communauté spécialisée.
 * Le module est pur : il transforme des listes de votes en un score
 * affichable, sans jamais lire ou écrire de données.
 */

import { bayesianMean, normalizedEntropy, wilsonCenter } from "./mathx";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface RatingVote {
  /** Note de 1 à 5. */
  stars: number;
  /** Identifiant du votant — un votant, une voix, par projet. */
  voterId: string;
  /** Langage principal du votant, pour la prime de diversité. */
  voterLang?: string;
  created_at?: string;
}

export interface RatingResult {
  /** Note bayésienne sur 5, prête à afficher. */
  stars: number;
  /** Part de l'estimation soutenue par des votes réels plutôt que par le prior. */
  evidence: number;
  /** Proportion estimée de notes favorables (4–5), corrigée par Wilson. */
  favorableEstimate: number;
  /** Score de diversité 0–1 des votants (entropie normalisée). */
  diversity: number;
  /** Note triée et affichée sur 5, égale à la moyenne bayésienne. */
  score: number;
  votes: number;
}

/* ------------------------------------------------------------------ */
/* Barème                                                             */
/* ------------------------------------------------------------------ */

/** Confiance du prior : combien de votes « virtuels » pèsent au départ. */
export const PRIOR_CONFIDENCE = 5;

/** Poids des trois facteurs du score géométrique. */
/** Filtre les votes valides : 1–5 étoiles, un votant par carte. */
export function validVotes(votes: RatingVote[]): RatingVote[] {
  const seen = new Set<string>();
  const out: RatingVote[] = [];
  for (const v of votes) {
    if (!Number.isFinite(v.stars) || v.stars < 1 || v.stars > 5) continue;
    const voterId = v.voterId.trim();
    if (!voterId || seen.has(voterId)) continue;
    seen.add(voterId);
    out.push(v);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Score de note                                                      */
/* ------------------------------------------------------------------ */

/**
 * Calcule le score complet d'un projet à partir de ses votes.
 *
 * `globalMean` — la moyenne des étoiles sur toute la plateforme — sert
 * de prior bayésien. Sans vote du tout, la note affichée **est** ce
 * prior : un projet pas encore juré hérite du niveau de la communauté
 * et ne se taille pas d'avantage par l'absence d'évaluation.
 */
export function rateProject(votes: RatingVote[], globalMean = 3): RatingResult {
  const clean = validVotes(votes);
  const n = clean.length;
  const prior = Number.isFinite(globalMean) ? Math.min(5, Math.max(1, globalMean)) : 3;

  if (!n) {
    return {
      stars: prior,
      evidence: 0,
      favorableEstimate: 0.5,
      diversity: 0,
      score: 0,
      votes: 0,
    };
  }

  // 1. Moyenne bayésienne : le prior pèse PRIOR_CONFIDENCE votes.
  const stars = bayesianMean(
    clean.map((v) => v.stars),
    prior,
    PRIOR_CONFIDENCE,
  );

  // Wilson's adjusted proportion describes favorable votes; it is not a
  // probability that the overall rating is correct.
  const geeks = clean.filter((v) => v.stars >= 4).length;
  const favorableEstimate = wilsonCenter(geeks, n);
  const evidence = n / (n + PRIOR_CONFIDENCE);

  // 3. Diversité : entropie normalisée des langages des votants.
  const byLang = new Map<string, number>();
  for (const v of clean) {
    const lang = v.voterLang?.trim().toLocaleLowerCase() || "n/a";
    byLang.set(lang, (byLang.get(lang) ?? 0) + 1);
  }
  const diversity = normalizedEntropy([...byLang.values()]);

  // Confidence and jury diversity are descriptive signals, not rating
  // penalties: a small or specialized jury does not make a project worse.
  const score = stars;

  return { stars, evidence, favorableEstimate, diversity, score, votes: n };
}

/**
 * Classe des projets : score décroissant. Le classement intègre la
 * note bayésienne et la confiance — PAS la moyenne brute.
 */
export function rankProjects<T extends { rating: RatingResult }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.rating.score - a.rating.score);
}

/**
 * La **moyenne globale de la plateforme** : la moyenne de tous les
 * votes passés. C'est le prior naturel du moteur — on ne juge pas un
 * projet de Kisangani sur l'échelle de Lagos.
 */
export function platformMean(allVotes: RatingVote[]): number {
  const clean = validVotes(allVotes);
  if (!clean.length) return 3;
  return clean.reduce((a, v) => a + v.stars, 0) / clean.length;
}
