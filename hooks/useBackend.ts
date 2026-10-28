"use client";

import { useSyncExternalStore } from "react";
import { getBackend, subscribe, type BackendProbe } from "@/lib/backend";

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
 * `getServerSnapshot` renvoie `getBackend()` : sur le serveur, la sonde
 * n'a pas tourné, l'état est `unknown`, et les composants client rendent
 * leur état de chargement avant l'hydratation. C'est le comportement
 * voulu — afficher le fil puis le vider en erreur serait pire.
 */
export function useBackend(): BackendProbe {
  return useSyncExternalStore(subscribe, getBackend, getBackend);
}