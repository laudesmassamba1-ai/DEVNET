/**
 * La session de démonstration.
 *
 * Isolé de `client.ts` parce que le moteur de requête en a besoin
 * aussi : une RLS qui dit « tu ne peux écrire que sur tes propres
 * notifications » n'est simulable que si le moteur sait **qui** est
 * connecté. Or `client.ts` importe `query.ts` — l'y mettre aurait
 * créé un cycle d'imports, et le sens de la flèche est important :
 * le client connaît le moteur, pas l'inverse.
 */

const SESSION_KEY = "devnet.demo.session";

/**
 * Repli en mémoire.
 *
 * `localStorage` peut être indisponible — navigation privée, quota,
 * et simplement l'exécution des tests, qui n'ont pas de `window`. Sans
 * ce repli, la session serait perdue entre deux appels dans ces
 * cas, et le moteur de requête — qui doit savoir qui est connecté pour
 * appliquer la RLS — croirait à tort que personne ne l'est.
 */
let memory: string | null = null;

/** L'identifiant du compte connecté, ou `null` si personne ne l'est. */
export function loadSessionId(): string | null {
  if (typeof window === "undefined") return memory;
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return memory;
  }
}

/** Pose la session (`null` pour la fermer). */
export function saveSessionId(id: string | null): void {
  memory = id;
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(SESSION_KEY, id);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* stockage indisponible : la session tient en mémoire, pas plus */
  }
}