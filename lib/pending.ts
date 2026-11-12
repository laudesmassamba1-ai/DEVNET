/**
 * Requêtes en vol — la barre d'état lit ce qui circule **réellement**.
 *
 * Le chargement ne doit pas être un décor qui tourne au hasard : quand
 * le réseau travaille, la barre d'état le dit, et quand il se tait, elle
 * se tait avec lui. Le compteur est incrémenté par l'adaptateur de
 * `fetch` branché sur le client navigateur Supabase
 * (`lib/api/client.ts`, option `global.fetch`) — donc chaque requête
 * REST ou auth passée par le client compte, et rien d'autre.
 *
 * C'est un store minimal, pas un contexte : rien à monter dans l'arbre,
 * rien à propager à la main. La barre d'état (`components/Pending.tsx`) s'y branche
 * avec `useSyncExternalStore`, avec un instantané serveur à zéro pour
 * que l'hydratation ne diverge jamais.
 */

type Listener = () => void;

let inFlight = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Appelé par l'adaptateur de fetch, avant chaque requête. */
export function beginPending(): void {
  inFlight += 1;
  emit();
}

/** Appelé par l'adaptateur de fetch, réponse reçue ou échouée. */
export function endPending(): void {
  inFlight = Math.max(0, inFlight - 1);
  emit();
}

/** Abonnement pour `useSyncExternalStore`. */
export function subscribePending(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Nombre de requêtes Supabase actuellement en vol. */
export function getPendingCount(): number {
  return inFlight;
}
