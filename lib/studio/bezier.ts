/**
 * Géométrie des courbes de Bézier — une seule source pour les deux moteurs.
 *
 * L'aperçu (SVG dans le DOM) et l'export (canvas) lisaient deux codes
 * différents : l'aperçu construisait une courbe à partir de trois points,
 * l'export reliait les points par des **droites** en ignorant les points de
 * contrôle. Résultat : ce qu'on voyait n'était pas ce qui était publié, et
 * une courbe redevenait un segment au moment de l'envoi.
 *
 * Ici, le chemin est calculé une fois et renvoyé au format SVG ; le canvas
 * le relit avec `Path2D`, qui accepte exactement la même chaîne. Les deux
 * rendus ne peuvent donc plus diverger.
 *
 * Repères : les points du calque sont des fractions de sa boîte (0 = bord
 * gauche, 1 = bord droit). `width` et `height` sont ceux de la boîte cible,
 * ce qui rend le chemin valable en pixels comme en unités de `viewBox`.
 */

export type BezierPoint = [number, number];

function scale(point: BezierPoint, width: number, height: number): BezierPoint {
  return [point[0] * width, point[1] * height];
}

function round(value: number): number {
  // Trois décimales suffisent et gardent la chaîne courte.
  return Math.round(value * 1000) / 1000;
}

/**
 * Chemin SVG de la courbe.
 *
 * Chaque segment entre deux points consécutifs utilise deux points de
 * contrôle (`controlPoints[2i]` et `[2i + 1]`). Si un segment n'en a pas,
 * il est tracé en ligne droite : une courbe partiellement réglée reste
 * affichable au lieu de disparaître.
 */
export function bezierPath(
  points: BezierPoint[],
  controlPoints: BezierPoint[] | undefined,
  width: number,
  height: number,
): string {
  if (!points?.length) return "";
  const [start, ...rest] = points.map((point) => scale(point, width, height));
  let path = `M ${round(start[0])} ${round(start[1])}`;

  rest.forEach((point, index) => {
    const c1 = controlPoints?.[index * 2];
    const c2 = controlPoints?.[index * 2 + 1];
    if (c1 && c2) {
      const [x1, y1] = scale(c1, width, height);
      const [x2, y2] = scale(c2, width, height);
      path += ` C ${round(x1)} ${round(y1)}, ${round(x2)} ${round(y2)}, ${round(point[0])} ${round(point[1])}`;
    } else {
      path += ` L ${round(point[0])} ${round(point[1])}`;
    }
  });

  return path;
}

/** Nombre de points de contrôle qu'un calque devrait avoir pour ses points. */
export function controlCount(points: BezierPoint[]): number {
  return Math.max(0, points.length - 1) * 2;
}
