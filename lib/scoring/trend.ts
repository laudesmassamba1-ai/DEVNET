/**
 * La lecture d'une **suite de scores** : ce qu'une courbe dit, en chiffres.
 *
 * ## Pourquoi un module à part
 *
 * La courbe montrait une pente, l'écran affichait deux nombres (le départ et
 * l'arrivée) : « +40 points ». Ce chiffre est vrai et trompeur. Il ne dit ni
 * si l'effort a été régulier, ni si les vingt points gagnés tiennent, ni si
 * une chute de 300 points au milieu a été rattrapée. Trois lectures
 * manquaient, et ce sont exactement celles qu'on attend d'une trajectoire :
 *
 * - **où est le centre** — moyenne et médiane de la série ;
 * - **de combien ça bouge** — écart-type, étendue ;
 * - **dans quel sens, et est-ce sérieux** — pente et verdict.
 *
 * ## La pente ne doit pas se laisser faire par un commit
 *
 * Une régression linéaire par les moindres carrés donne tout le pouvoir au
 * point le plus éloigné : un unique commit qui importe un fichier généré de
 * 4 000 lignes fait basculer la pente de la série entière. On mesure donc la
 * pente à la **médiane des pentes deux à deux** (Theil–Sen) : une pente
 * aberrante est une pente parmi des milliers, la médiane l'ignore.
 *
 * ## « Stable » n'est pas « je ne sais pas »
 *
 * Le verdict compare la **dérive totale** (dernier − premier) à ce que le
 * bruit seul produirait sur la même longueur de série : le bruit d'un pas
 * multiplié par la racine du nombre de pas. C'est l'écart au-delà duquel
 * une marche aléatoire ne suffit plus à expliquer le mouvement. Un dépôt qui
 * oscille de ±40 points d'une révision à l'autre et dérive de 5 points par
 * révision ne progresse pas, il tremble — et le dire est plus utile que
 * d'afficher « +100 points ».
 *
 * Le bruit est mesuré **autour de la médiane** des pas, pas de leur
 * moyenne : sur une série qui monte de 50 points par révision, la moyenne
 * des pas vaut 50 et le bruit autour d'elle vaut 0 — ce qu'on veut. Sur la
 * même série avec un pas à −10, la moyenne se déplace et le bruit aussi,
 * alors que la médiane ne bouge pas.
 *
 * Le plancher (`MIN_DRIFT`) existe pour les séries **parfaitement lisses** :
 * un bruit nul rendrait significative une dérive de deux points, ce qui est
 * précisément le genre de bruit qu'on veut taire.
 *
 * Le tout est pur, borné, et ne lit que des nombres finis.
 */

import { meanOf, medianOf, minOf, maxOf, stddevOf } from "./stats";

/** Sens d'une trajectoire. */
export type TrendDirection = "hausse" | "baisse" | "stable";

/**
 * Ce qu'une courbe **ignore**.
 *
 * Une courbe de score ne trace que les révisions dont un instantané a été
 * enregistré. Les autres ne sont pas notées zéro : elles sont **absentes**,
 * et comme les points sont espacés régulièrement, un trou ne se voit pas —
 * la courbe relie deux points séparés de trois révisions comme si elles
 * étaient voisines. Une courbe qui ne dit pas ce qu'elle saute est une
 * courbe qui ment par omission, et c'est exactement le genre de mensonge
 * qu'on ne peut pas reprocher à celui qui la lit.
 *
 * Deux manques distincts, et il ne faut pas les confondre :
 *
 * - `missing` — des révisions de la **période lue** n'ont pas d'instantané.
 *   Ce sont des trous dans le tracé ;
 * - `untraced` — des révisions sont plus **anciennes** que la fenêtre lue.
 *   Ce n'est pas un trou, c'est un bord : la courbe commence tard.
 */
export interface HistoryCoverage {
  /** Révisions effectivement tracées. */
  traced: number;
  /** Révisions du dépôt sur la branche, fenêtre comprise. */
  total: number;
  /** Révisions de la fenêtre lue sans instantané — des trous. */
  missing: number;
  /** Révisions plus anciennes que la fenêtre lue — un bord. */
  untraced: number;
  /** Vrai si tout ce que le dépôt contient est tracé. */
  complete: boolean;
}

/**
 * La couverture d'une courbe, à partir des compteurs de la lecture.
 *
 * Les compteurs viennent d'une requête : ils peuvent être incohérents
 * (total plus petit que ce qui a été tracé, valeurs non finies). On ne
 * propage pas ces incohérences à l'écran — on les ramène à un état
 * affichable, quitte à dire « complet » quand on ne sait pas.
 */
export function historyCoverage(counts: {
  /** Révisions tracées (les points de la courbe). */
  traced: number;
  /** Révisions du dépôt, avant troncature. */
  total: number;
  /** Révisions de la fenêtre lue sans instantané. */
  missing: number;
}): HistoryCoverage {
  const entier = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
  const traced = entier(counts.traced);
  const missing = entier(counts.missing);
  // Le total ne peut pas être plus petit que ce qu'on a lu : s'il l'est,
  // c'est le total qui est faux, pas la lecture.
  const total = Math.max(traced + missing, entier(counts.total));
  const untraced = Math.max(0, total - traced - missing);
  return { traced, total, missing, untraced, complete: missing === 0 && untraced === 0 };
}

export interface HistoryStats {
  /** Nombre de points retenus (les scores non finis sont écartés). */
  count: number;
  /** Premier score de la série. */
  first: number;
  /** Dernier score de la série. */
  last: number;
  /** Écart entre le dernier et le premier — ce que la courbe montre. */
  delta: number;
  min: number;
  max: number;
  /** Moyenne de la série : le niveau autour duquel le dépôt vit. */
  mean: number;
  /** Médiane : la même idée, sans donner de poids à un point isolé. */
  median: number;
  /** Écart-type : de combien la série s'écarte de sa moyenne. */
  stddev: number;
  /** Pente robuste, en **points par révision**. */
  slope: number;
  /**
   * Bruit d'une révision à l'autre, en points : ce à quoi la **dérive** est
   * comparée pour décider si le mouvement est une tendance.
   */
  noise: number;
  trend: TrendDirection;
}

/**
 * Dérive minimale, en points, pour qu'une série **parfaitement lisse** soit
 * déclarée en mouvement. Sans ce plancher, un bruit nul rendrait
 * significative une dérive de deux points.
 */
const MIN_DRIFT = 20;

/**
 * Au-delà, la pente se mesure sur un échantillon régulier de la série.
 *
 * La médiane des pentes deux à deux coûte n² / 2 : sur 5 000 commits, douze
 * millions de pentes pour un chiffre qui ne bougerait pas — 60 points
 * régulièrement espacés en portent 1 770, et le premier comme le dernier
 * sont conservés. C'est un plafond de coût, pas une approximation choisie.
 */
const MAX_TREND_POINTS = 60;

/**
 * Échantillon régulier de la série, premier et dernier points compris.
 *
 * Le **pas** est rendu avec l'échantillon : une pente calculée sur un point
 * sur deux est deux fois trop grande, et une pente fausse d'un facteur 2 est
 * plus difficile à repérer qu'une pente absente. C'est l'appelant qui
 * renormalise.
 */
function sample(values: readonly number[], max: number): { values: number[]; stride: number } {
  if (values.length <= max) return { values: [...values], stride: 1 };
  const stride = Math.ceil(values.length / max);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += stride) out.push(values[i]);
  if (out[out.length - 1] !== values[values.length - 1]) out.push(values[values.length - 1]);
  return { values: out, stride };
}

/**
 * Pente robuste : médiane des pentes entre **toutes** les paires de points.
 *
 * Deux points donnent exactement la pente de la droite ; trois points en
 * donnent trois, dont la médiane est déjà insensible au point aberrant.
 */
function robustSlope(scores: readonly number[]): number {
  if (scores.length < 2) return 0;
  const slopes: number[] = [];
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      slopes.push((scores[j] - scores[i]) / (j - i));
    }
  }
  return medianOf(slopes);
}

/**
 * Bruit d'un pas : l'écart quadratique moyen des pas **autour de leur
 * médiane**.
 *
 * La médiane comme centre, et non la moyenne : elle ne se déplace pas quand
 * un pas est aberrant. L'écart quadratique plutôt que la médiane des écarts,
 * parce qu'il doit **compter** les pas violents — c'est tout l'enjeu : une
 * série qui fait ±40 d'une révision à l'autre est plus bruitée qu'une série
 * qui fait ±5, même si, dans les deux cas, la moitié des pas sont petits.
 */
function stepNoise(steps: readonly number[]): number {
  if (!steps.length) return 0;
  const middle = medianOf(steps);
  let squares = 0;
  for (const s of steps) squares += (s - middle) * (s - middle);
  return Math.sqrt(squares / steps.length);
}

/**
 * Les chiffres d'une trajectoire de scores.
 *
 * Accepte n'importe quelle suite : vide, d'un point, plate, non finie. Une
 * série inexploitable rend des zéros et `stable` — jamais `NaN`, parce que
 * ces nombres finissent à l'écran, et qu'un `NaN` affiché est un défaut.
 */
export function historyStats(values: readonly number[]): HistoryStats {
  const scores = values.filter(Number.isFinite);
  if (!scores.length) {
    return {
      count: 0, first: 0, last: 0, delta: 0, min: 0, max: 0,
      mean: 0, median: 0, stddev: 0, slope: 0, noise: 0, trend: "stable",
    };
  }

  const first = scores[0];
  const last = scores[scores.length - 1];
  const steps = scores.slice(1).map((s, i) => s - scores[i]);
  const noise = stepNoise(steps);
  const sampled = sample(scores, MAX_TREND_POINTS);
  // La pente est ramenée à l'unité d'origine : points **par révision**,
  // même quand la série a été échantillonnée.
  const slope = robustSlope(sampled.values) / sampled.stride;

  // Ce qu'une marche aléatoire produirait sur cette longueur de série : le
  // bruit d'un pas multiplié par la racine du nombre de pas. Une dérive
  // qui reste en dessous n'est pas une tendance, c'est du mouvement.
  const delta = last - first;
  const tolerance = Math.max(MIN_DRIFT, noise * Math.sqrt(Math.max(steps.length, 1)));
  const trend: TrendDirection =
    Math.abs(delta) > tolerance ? (delta > 0 ? "hausse" : "baisse") : "stable";

  return {
    count: scores.length,
    first,
    last,
    delta,
    min: minOf(scores),
    max: maxOf(scores),
    mean: meanOf(scores),
    median: medianOf(scores),
    stddev: stddevOf(scores),
    slope,
    noise,
    trend,
  };
}
