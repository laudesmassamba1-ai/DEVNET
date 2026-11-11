/**
 * Rendu d'une icône du jeu maison.
 *
 * Les dessins vivent tous dans `components/icons/drawings.tsx`. Ce composant
 * ne s'occupe que du contrat SVG : grille 24 × 24, trait 1,7 par défaut,
 * bouts ronds, `currentColor`, jamais de couleur en dur.
 *
 * Les noms de section gardent leur ancienne liste (`SectionIconName`) : les
 * barres de navigation et les surfaces qui importaient déjà ce composant
 * continuent de fonctionner sans changement d'API. `Icon` s'appuie sur le
 * même rendu, ce qui garantit qu'il n'existe plus qu'un seul trait dans
 * l'application.
 */
import type { SVGProps } from "react";
import { GLYPHS, type GlyphName } from "./icons/drawings";

export type SectionIconName = GlyphName;

export function SectionIcon({
  name,
  size = 18,
  strokeWidth = 1.7,
  className,
  fill = "none",
  ...rest
}: {
  name: SectionIconName;
  size?: number;
  fill?: string;
} & Omit<SVGProps<SVGSVGElement>, "name">) {
  const drawing = GLYPHS[name];
  if (!drawing) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {drawing}
    </svg>
  );
}
