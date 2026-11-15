"use client";

import { useSyncExternalStore } from "react";
import { getBackend, subscribe, type BackendProbe } from "@/lib/backend";

/**
 * Instantané côté serveur, **constant**.
 *
 * La sonde peut avoir déjà tourné quand React hydrate une frontière
 * suspendue : `getSnapshot()` renverrait alors `offline` là où le serveur a
 * rendu `unknown`, et l'hydratation signalerait un écart de texte. Le
 * serveur et la première passe d'hydratation doivent lire la même valeur ;
 * la bascule vers l'état réel se fait ensuite, après l'hydratation.
 */
const SERVER_SNAPSHOT: BackendProbe = {
  state: "unknown",
  url: null,
  reason: null,
  checkedAt: null,
};

/**
 * État du backend, reactive.
 *
 * `probeBackend()` vit dans un module, hors de React : c'est lui qui
 * décide de basculer en mode démonstration, et il peut le faire à n'importe
 * quel moment (sonde, bouton « Réessayer », rechargement). Le seul moyen
 * d'en être prévenu depuis un composant est donc
 * `useSyncExternalStore` sur ce module.
 *
 * Ce hook existe parce que cette inscription était recopiée dans le
 * bandeau, dans la garde et dans l'écran de connexion — trois fois le
 * même couplage au module, donc trois endroits à oublier le jour où la
 * forme du state change.
 *
 * `getServerSnapshot` renvoie un instantané constant `unknown` : sur le
 * serveur comme pendant la première passe d'hydratation, la sonde n'a pas
 * encore parlé. C'est le comportement voulu — afficher le fil puis le vider
 * en erreur serait pire.
 */
export function useBackend(): BackendProbe {
  return useSyncExternalStore(subscribe, getBackend, () => SERVER_SNAPSHOT);
}
