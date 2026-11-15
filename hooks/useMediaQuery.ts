"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Crochet de requête média.
 *
 * L'état d'une requête média est un **store externe** au composant : il
 * appartient à `matchMedia`, pas au composant. Le gérer à la main dans un
 * effet (`useState` + `useEffect`) coûte deux rendus à chaque bascule et
 * laisse une fenêtre pendant laquelle la largeur observée est fausse — donc
 * le mauvais layout affiché. `useSyncExternalStore` lit la source au moment
 * du rendu : une seule passe, jamais de valeur périmée.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );

  // Côté serveur on ne connaît pas la largeur : on rend la disposition la
  // plus étroite, et `useSyncExternalStore` remplace par la vraie dès le
  // premier rendu client — sans jamais faire diverger l'hydratation, parce
  // que le snapshot serveur est utilisé jusqu'à la reprise.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Vrai au-dessus de 880 px — la largeur à partir de laquelle le panneau de
 * gauche tient sans rogner le contenu.
 *
 * Ce n'est pas un seuil esthétique mais un calcul de capacité : 236 px de
 * panneau + les 560 px que la colonne affiche déjà en mobile + 2 × 40 px de
 * gouttière = 836. Le `md:` de Tailwind (768 px) laissait 532 px de contenu
 * collé aux bords — plus étroit que le mobile qu'on venait de quitter, donc
 * franchir le seuil rétrécissait la page.
 *
 * La valeur doit rester **identique** à `--breakpoint-shell` dans
 * `globals.css` : l'un décide du rendu JavaScript, l'autre du rendu CSS, et
 * une divergence ferait coexister deux dispositions dans la même plage de
 * largeurs.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 880px)");
}
