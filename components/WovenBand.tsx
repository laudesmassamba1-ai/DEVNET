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
  signal: "text-signal/45",
  phosphor: "text-phosphor/45",
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
    <div aria-hidden="true" className={`h-2 w-full overflow-hidden ${TONES[tone]} ${className}`}>
      <svg className="h-full w-full" role="presentation" focusable="false">
        <defs>
          <pattern
            id={patternId}
            width="12"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            {/* Deux fils croisés : la trame. */}
            <path d="M0 8L8 0" stroke="currentColor" strokeWidth="1.2" />
            <path d="M-4 8L4 0" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 8L12 3.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 8L12 0" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
