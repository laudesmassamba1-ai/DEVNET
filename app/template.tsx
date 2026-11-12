"use client";

import type { ReactNode } from "react";

/**
 * Le passage d'une page à l'autre.
 *
 * Un `template` remonte à chaque navigation — contrairement à un
 * `layout`, qui persiste. C'est exactement le cycle d'une transition
 * d'écran : le contenu arrive, la coque (barre, navigation) reste en
 * place. `mo-rise` est la même famille d'entrée que le reste de
 * l'application : un fondu avec un léger soulèvement, assez court pour
 * qu'une navigation ne se sente jamais ralentie.
 *
 * Le `fill-mode` de `mo-rise` est `backwards` : aucun `transform` ne
 * subsiste une fois l'animation finie, donc les panneaux `fixed`
 * (feuilles, overlays, tchat plein écran) gardent leur référentiel — le
 * piège des ancêtres transformés ne se referme pas ici.
 *
 * `prefers-reduced-motion` est couvert par la règle globale
 * (`globals.css`) : l'animation tombe, le contenu est simplement là.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="mo-rise">{children}</div>;
}
