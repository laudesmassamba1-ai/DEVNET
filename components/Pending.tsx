"use client";

import { useEffect, useSyncExternalStore, useState } from "react";
import { getPendingCount, subscribePending } from "@/lib/pending";
import { motionDuration } from "./Motion";
import { LoadingLogo } from "./LoadingLogo";

/**
 * Activité réseau dans la barre d'état.
 *
 * La pastille « en ligne » dit que le backend est joignable ; elle ne dit
 * pas s'il travaille. Quand une requête part, le mini-logo prend sa place
 * — le chargement vit là où l'information d'état vit déjà, pas dans un
 * filament qui tourne au hasard au-dessus du contenu.
 *
 * Deux règles posées ici :
 *
 * 1. **pas de clignotement pour une requête plus rapide que
 *    `--d-fast`** — l'apparition attend la durée lue dans le jeton, de
 *    la même façon que `waitForExit` lit une durée de sortie. Rien n'est
 *    écrit en dur dans le composant ;
 * 2. **une rafale de requêtes chaînées ne fait pas disparaître le
 *    logo entre deux** — le retrait attend le même répit, donc un
 *    silence plus court que le jeton ne remonte jamais à l'œil.
 */

/** Compte de requêtes en vol, tel quel. */
export function usePendingCount(): number {
  return useSyncExternalStore(subscribePending, getPendingCount, () => 0);
}

/** Vrai quand l'activité doit être visible (délais du jeton appliqués). */
export function usePendingVisible(): boolean {
  const count = usePendingCount();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (count > 0) {
      if (visible) return;
      const t = setTimeout(() => setVisible(true), motionDuration("--d-fast", 0));
      return () => clearTimeout(t);
    }
    // Retour au calme : un répit avant de cacher, pour que les requêtes
    // chaînées d'un même écran ne fassent pas clignoter la barre.
    const t = setTimeout(() => setVisible(false), motionDuration("--d-fast", 0));
    return () => clearTimeout(t);
  }, [count, visible]);

  return visible;
}

/** Le mini-logo affiché quand le réseau travaille. */
export function PendingStatus({ className = "" }: { className?: string }) {
  const visible = usePendingVisible();
  if (!visible) return null;

  return (
    <span className={`mo-fade inline-flex shrink-0 items-center ${className}`.trim()}>
      <LoadingLogo size="sm" ariaLabel="Requête en cours" />
    </span>
  );
}
