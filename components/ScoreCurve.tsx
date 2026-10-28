"use client";

import { useMemo } from "react";
import { curveGeometry } from "@/lib/scoring";

/**
 * Le tracé d'une suite de scores, en SVG à la main.
 *
 * Pas de bibliothèque de graphiques : le projet n'en a aucune, et une courbe
 * de vingt points n'en justifie pas une de plus. Le `viewBox` est
 * volontairement étiré (`preserveAspectRatio="none"`) pour remplir la
 * largeur, avec un trait **non mis à l'échelle** — sans cela, étirer la
 * courbe épaissirait le trait horizontalement et pas verticalement.
 *
 * La géométrie vit dans `lib/scoring/curve.ts` : elle s'y vérifie en Node,
 * y compris ses cas limites — série plate, écart minuscule, un seul point,
 * valeur non finie, série de cinquante mille points. Ici, on ne fait que la
 * peindre.
 *
 * Le composant est **partagé** : la courbe d'un dépôt (nombre de révisions)
 * et la trajectoire des dépôts d'une personne sont le même dessin, à la
 * grille et à la hauteur près. Deux tracés séparés auraient fini par
 * diverger — l'un avec les repères de moyenne, l'autre sans, l'un qui
 * plante sur un seul point, l'autre non.
 */

/**
 * Les deux repères, et ce qui les distingue.
 *
 * Le trait long est la moyenne, le pointillé serré la médiane — deux motifs
 * plutôt que deux couleurs, parce qu'une couleur seule ne se lit pas dans un
 * rapport imprimé en noir et blanc, et que la légende qui les nomme les
 * reprend à l'identique.
 */
export const MEAN_TONE = "text-chalk-2";
export const MEDIAN_TONE = "text-chalk-3";
export const MEAN_DASH = "3 2";
export const MEDIAN_DASH = "1 2.5";

export function ScoreCurve({
  scores,
  label,
  width = 100,
  height = 34,
  /** La grille de lecture (trois niveaux) : utile sur une courbe, du bruit sur une vignette. */
  grid = false,
  /** Tracer la moyenne et la médiane, qui disent où se situe le dernier point. */
  guides = true,
  className = "h-[68px] w-full text-signal",
}: {
  /** Les scores, du plus ancien au plus récent. */
  scores: readonly number[];
  /** Ce que le dessin montre, pour qui ne le voit pas. */
  label: string;
  width?: number;
  height?: number;
  grid?: boolean;
  guides?: boolean;
  className?: string;
}) {
  const { line, area, markerY, meanY, medianY } = useMemo(
    () => curveGeometry(scores, { width, height }),
    [scores, width, height],
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={className}
    >
      {grid &&
        [0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={height * f}
            y2={height * f}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="1 2"
            vectorEffect="non-scaling-stroke"
            opacity={0.18}
          />
        ))}

      {/* Les repères passent **sous** la courbe : la donnée mesurée reste le
          trait le plus visible, les niveaux de référence sont un fond. */}
      {guides && meanY !== null && (
        <line
          x1={0}
          x2={width}
          y1={meanY}
          y2={meanY}
          className={MEAN_TONE}
          stroke="currentColor"
          strokeWidth={1.2}
          strokeDasharray={MEAN_DASH}
          vectorEffect="non-scaling-stroke"
          opacity={0.7}
        />
      )}
      {guides && medianY !== null && (
        <line
          x1={0}
          x2={width}
          y1={medianY}
          y2={medianY}
          className={MEDIAN_TONE}
          stroke="currentColor"
          strokeWidth={1.2}
          strokeDasharray={MEDIAN_DASH}
          vectorEffect="non-scaling-stroke"
          opacity={0.8}
        />
      )}

      <path d={area} fill="currentColor" fillOpacity={0.12} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {markerY !== null && (
        <circle
          cx={width}
          cy={markerY}
          r={2.4}
          fill="currentColor"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/**
 * Une **légende de repère** : le motif exact tracé sur la courbe, et sa valeur.
 *
 * Le petit trait est dessiné avec le même `strokeDasharray` que la ligne
 * au-dessus — une légende qui ne reproduit pas le motif qu'elle décrit ne
 * sert à rien.
 */
export function GuideLegend({
  label,
  value,
  tone,
  dash,
}: {
  label: string;
  value: number;
  tone: string;
  dash: string;
}) {
  return (
    <p className="flex items-center gap-2">
      <svg
        viewBox="0 0 18 6"
        aria-hidden="true"
        className={`h-[6px] w-[18px] shrink-0 ${tone}`}
      >
        <line
          x1={0}
          x2={18}
          y1={3}
          y2={3}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeDasharray={dash}
        />
      </svg>
      <span className="label-micro text-chalk-4">{label}</span>
      <span className="tnum font-mono text-[11.5px] text-chalk-2">{Math.round(value)}</span>
    </p>
  );
}
