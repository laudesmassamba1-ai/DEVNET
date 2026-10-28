/**
 * La géométrie des **graphes du score**.
 *
 * ## Pourquoi elle n'est pas dans le composant
 *
 * Le tracé vivait au fond de `ScorePanel`, mélangé au JSX. C'est l'endroit
 * habituel, et c'est aussi l'endroit où un défaut de géométrie ne se voit
 * pas : une division par zéro sur une série d'un seul point, une échelle qui
 * colle la courbe au bord, une ligne plate qui passe pour un écroulement,
 * une classe vide qui produit une barre de hauteur négative. Toutes ces
 * erreurs sont **invisibles à l'œil** sur un petit dessin, et impossibles à
 * vérifier sans navigateur.
 *
 * Une fonction pure règle les deux problèmes : elle se teste en Node, et
 * l'écran n'a plus qu'à afficher ce qu'elle renvoie.
 *
 * ## Ce que les tracés doivent garantir
 *
 * - **borné** : aucun point ne sort du cadre, même si deux scores sont
 *   identiques, si l'écart est énorme, ou si une valeur est `NaN` — un
 *   chemin SVG contenant `NaN` ne s'affiche pas du tout ;
 * - **centré quand c'est plat** : une série constante se dessine au milieu
 *   du cadre, pas sur un bord — une ligne collée en bas se lirait comme une
 *   chute à zéro ;
 * - **lisible quand c'est serré** : deux points séparés de trois unités sont
 *   étirés pour être visibles, mais l'amplitude minimale est bornée pour
 *   qu'une variation de 2 points ne remplisse pas tout le cadre et ne fasse
 *   pas croire à un bouleversement ;
 * - **muet quand il n'y a rien** : une suite vide rend un dessin vide, pas
 *   un cadre avec une barre à zéro.
 *
 * ## Les repères, et pourquoi ils se calculent ici
 *
 * La moyenne et la médiane tracées sur la courbe doivent être **le même
 * nombre** que celui affiché à côté. Les recalculer dans le composant, c'est
 * se donner deux occasions de diverger ; elles viennent donc de `stats.ts` —
 * les mêmes fonctions que celles qui alimentent les étiquettes.
 *
 * L'histogramme suit la même règle : une classe non vide garde toujours une
 * hauteur visible. Sans cela, un unique fichier noté 300 dans un dépôt de
 * cent fichiers produirait une barre de 0,3 pixel — c'est-à-dire
 * l'information qu'on venait chercher, invisible.
 */

import { clamp } from "../mathx";
import { maxOf, meanOf, medianOf, minOf } from "./stats";

/** Le dessin de la courbe : un chemin, une aire, et de quoi placer le curseur. */
export interface CurveGeometry {
  /** Chemin SVG de la ligne : `M… L… L…`. Vide si aucun point. */
  line: string;
  /** Le même chemin, refermé sur le bas du cadre — pour la surface teintée. */
  area: string;
  /** Ordonnée du **dernier** point, en unités du `viewBox`. `null` si vide. */
  markerY: number | null;
  /** Ordonnée de la **moyenne** de la série — le repère horizontal. */
  meanY: number | null;
  /** Ordonnée de la **médiane**. */
  medianY: number | null;
  /** Bornes de l'échelle verticale, après arrondi — affichées si besoin. */
  top: number;
  bottom: number;
}

export interface CurveOptions {
  /** Largeur du `viewBox`. */
  width?: number;
  /** Hauteur du `viewBox`. */
  height?: number;
  /** Marge verticale, pour que le trait ne touche pas les bords extrêmes. */
  pad?: number;
  /**
   * Amplitude **minimale** de l'échelle.
   *
   * Sans elle, deux scores séparés de 1 point occuperaient toute la hauteur
   * et une révision banale ressemblerait à un séisme. Quarante points est
   * l'ordre de grandeur d'un vrai mouvement sur ce barème.
   */
  minSpan?: number;
}

/**
 * Le tracé d'une suite de scores, du premier au dernier.
 *
 * Les abscisses sont régulièrement espacées : une courbe de score se lit par
 * révision, pas par date. Espacer selon le temps écoulé écraserait dix
 * commits du même jour sur une largeur nulle — et c'est très exactement le
 * cas d'un dépôt qu'on vient de créer.
 */
export function curveGeometry(
  values: readonly number[],
  options: CurveOptions = {},
): CurveGeometry {
  const width = options.width ?? 100;
  const height = options.height ?? 34;
  const pad = options.pad ?? 3;
  const minSpan = options.minSpan ?? 40;

  // Les scores non finis sont écartés, pas propagés : `Math.min` sur un
  // tableau contenant `NaN` rend `NaN`, et tout le tracé disparaît.
  const scores = values.filter(Number.isFinite);
  if (scores.length === 0) {
    return { line: "", area: "", markerY: null, meanY: null, medianY: null, top: 0, bottom: 0 };
  }

  const lo = minOf(scores);
  const hi = maxOf(scores);
  const middle = (lo + hi) / 2;
  // `minSpan` nul rendrait l'échelle de hauteur nulle : la borne garde une
  // amplitude strictement positive, donc une division saine.
  const half = Math.max(hi - lo, Math.max(minSpan, 1e-9)) / 2;
  const top = middle + half;
  const bottom = middle - half;

  const usable = Math.max(height - 2 * pad, 0);
  const x = (index: number) =>
    scores.length === 1 ? width / 2 : (index / (scores.length - 1)) * width;
  const y = (value: number) =>
    clamp(pad + (1 - (value - bottom) / (top - bottom)) * usable, 0, height);

  const line = scores
    .map((score, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(score).toFixed(2)}`)
    .join(" ");

  // Une série d'un seul point n'a pas d'aire : refermer le chemin sur le bas
  // produirait un rectangle plein, qui se lirait comme une courbe.
  const area =
    scores.length > 1 ? `${line} L${width.toFixed(2)},${height} L0,${height} Z` : "";

  return {
    line,
    area,
    markerY: y(scores[scores.length - 1]),
    // La moyenne et la médiane d'une série bornée sont **dans** l'étendue :
    // leurs repères tombent donc toujours à l'intérieur du cadre.
    meanY: y(meanOf(scores)),
    medianY: y(medianOf(scores)),
    top,
    bottom,
  };
}

/* ------------------------------------------------------------------ */
/* Histogramme                                                         */
/* ------------------------------------------------------------------ */

/** Une classe de l'histogramme : ses bornes en valeurs, et son rectangle. */
export interface HistogramBar {
  /** Borne basse de la classe, incluse. */
  from: number;
  /** Borne haute de la classe, exclue — sauf pour la dernière. */
  to: number;
  /** Nombre de valeurs tombées dans la classe. */
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HistogramGeometry {
  bars: HistogramBar[];
  /** Effectif de la classe la plus peuplée — l'échelle des hauteurs. */
  maxCount: number;
  /** Plus petite et plus grande valeur représentées, pour graduer l'axe. */
  min: number;
  max: number;
  /** Moyenne de la série, abscisse de son repère vertical. */
  mean: number;
  median: number;
  /** Abscisses des repères — `null` quand il n'y a rien à situer. */
  meanX: number | null;
  medianX: number | null;
}

export interface HistogramOptions {
  /** Nombre de classes demandé. */
  bins?: number;
  width?: number;
  height?: number;
  /** Espace entre deux barres, en unités du `viewBox`. */
  gap?: number;
  /** Marge haute, pour que la classe la plus peuplée ne touche pas le bord. */
  pad?: number;
  /**
   * Part **minimale** de la hauteur pour une classe non vide.
   *
   * C'est la règle qui rend l'histogramme utile : une classe à un fichier
   * sur deux cents mérite un trait visible, sinon le seul point intéressant
   * est celui qu'on ne voit pas.
   */
  minVisibleShare?: number;
}

/** Plafond de classes : au-delà, l'histogramme devient un peigne illisible. */
const MAX_BINS = 20;

/**
 * La distribution d'une série de valeurs, en classes d'égale largeur.
 *
 * Les valeurs non finies sont écartées ; une série vide rend un dessin vide,
 * et une série **constante** rend une barre pleine largeur — toutes les
 * valeurs sont au même endroit, et le dire en une barre vaut mieux que
 * d'inventer une étendue nulle autour d'elle.
 */
export function histogramGeometry(
  values: readonly number[],
  options: HistogramOptions = {},
): HistogramGeometry {
  const width = options.width ?? 100;
  const height = options.height ?? 30;
  const gap = Math.max(options.gap ?? 0.6, 0);
  const pad = Math.max(options.pad ?? 0, 0);
  const minVisible = clamp(options.minVisibleShare ?? 0.12, 0, 1) * height;
  const bins = Math.max(1, Math.min(MAX_BINS, Math.round(options.bins ?? 8) || 1));

  const scores = values.filter(Number.isFinite);
  if (!scores.length) {
    return ({
      bars: [], maxCount: 0, min: 0, max: 0,
      mean: 0, median: 0, meanX: null, medianX: null,
    });
  }

  const lo = minOf(scores);
  const hi = maxOf(scores);
  const mean = meanOf(scores);
  const median = medianOf(scores);
  // Une série constante n'a pas d'étendue : son repère se place au milieu,
  // ce qui est la seule position qui ne mente pas sur une échelle nulle.
  const level = (value: number) =>
    span0(hi, lo) ? width / 2 : clamp(((value - lo) / (hi - lo)) * width, 0, width);
  const span = hi - lo;
  const classes = span > 0 ? bins : 1;

  const counts = new Array<number>(classes).fill(0);
  for (const v of scores) {
    // `span === 0` : toutes les valeurs sont identiques, une seule classe
    // les porte. Sinon la dernière classe est inclusive, pour que le
    // maximum de la série ne tombe pas hors de l'histogramme.
    const index = span > 0
      ? Math.min(classes - 1, Math.floor(((v - lo) / span) * classes))
      : 0;
    counts[index]++;
  }

  const maxCount = maxOf(counts);
  const usable = Math.max(height - pad, 0);
  const slot = width / classes;
  const barWidth = Math.max(slot - gap, slot / 2);

  const bars: HistogramBar[] = [];
  for (let i = 0; i < classes; i++) {
    const count = counts[i];
    const raw = maxCount > 0 ? (count / maxCount) * usable : 0;
    // Une classe non vide garde une hauteur visible ; une classe vide n'a
    // pas de hauteur du tout, et c'est ce qui distingue « rien ici » de
    // « un peu ici ».
    const barHeight = count > 0 ? clamp(Math.max(raw, minVisible), 0, usable) : 0;
    bars.push({
      from: span > 0 ? lo + (i / classes) * span : lo,
      to: span > 0 ? lo + ((i + 1) / classes) * span : hi,
      count,
      x: i * slot + (slot - barWidth) / 2,
      y: height - barHeight,
      width: barWidth,
      height: barHeight,
    });
  }

  return {
    bars,
    maxCount,
    min: lo,
    max: hi,
    mean,
    median,
    meanX: level(mean),
    medianX: level(median),
  };
}

/** L'étendue est-elle nulle ? (Sert à éviter une division par zéro.) */
function span0(hi: number, lo: number): boolean {
  return !(hi > lo);
}
