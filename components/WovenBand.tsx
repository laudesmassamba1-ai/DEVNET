"use client";

import { useId } from "react";

/**
 * Bande tissée — la signature de la direction « Atelier de nuit ».
 *
 * Un réseau de développeurs se tisse : chaque fil seul ne tient rien, c'est
 * le croisement qui fait la toile. Cette bande sépare les **grandes zones**
 * (en-tête / contenu, contenu / fil) et se teinte selon la section. Elle ne
 * décore jamais une ligne de contenu : deux usages par écran au maximum.
 *
 * Le motif est un SVG de quelques centaines d'octets, en `currentColor` :
 * il prend la couleur du token posé par `tone`, ne dépend d'aucune image et
 * reste net à toutes les densités. Aucun mouvement — une texture qui
 * clignote serait du bruit.
 */
const TONES = {
  // Une trame se lit de près, pas comme une rayure : à 45 % elle traversait
  // l'écran comme un trait de glitch, surtout sur mobile. À 28 %, elle reste
  // une texture et redevient un séparateur.
  signal: "text-signal/25",
  phosphor: "text-phosphor/25",
  line: "text-line-3",
} as const;

export function WovenBand({
  tone = "signal",
  className = "",
}: {
  tone?: keyof typeof TONES;
  className?: string;
}) {
  // Un identifiant par instance : deux bandes sur la même page partagent
  // sinon le même `<pattern>`, et la seconde pourrait peindre avec le
  // remplissage de la première.
  const patternId = useId().replace(/:/g, "");

  return (
    <div aria-hidden="true" className={`h-1 w-full overflow-hidden ${TONES[tone]} ${className}`}>
      <svg className="h-full w-full" role="presentation" focusable="false">
        <defs>
          <pattern
            id={patternId}
            width="8"
            height="4"
            patternUnits="userSpaceOnUse"
          >
            {/* Le motif est taillé pour la hauteur de la bande : à 8 px de
                haut dans 4 px, les fils étaient rognés en pointillés. */}
            <path d="M0 4L4 0" stroke="currentColor" strokeWidth="1" />
            <path d="M-4 4L0 0" stroke="currentColor" strokeWidth="1" />
            <path d="M4 4L8 0" stroke="currentColor" strokeWidth="1" />
            <path d="M2 4L6 0" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
