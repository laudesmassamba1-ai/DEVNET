/**
 * Façade conservée pour ne pas réécrire tous les écrans d'un coup.
 *
 * `api` est le client HTTP maison (`lib/rest/client.ts`) : plus aucun SDK
 * externe. Les appels `from(...)`, `auth.*`, `channel(...)` gardent leur forme,
 * mais chaque requête part vers `/api/rest` ou `/api/auth`, donc vers
 * PostgreSQL et non vers un service tiers.
 *
 * Le mode démonstration reste sélectionné par la sonde (`lib/backend.ts`) :
 * hors backend, le proxy route vers `lib/demo/client.ts`.
 */
import { demoClient } from "@/lib/demo/client";
import { isDemoMode } from "@/lib/backend";
import { restClient, type RestClient } from "@/lib/rest/client";

let warned = false;

function getLiveClient(): RestClient {
  if (!warned && process.env.NEXT_PUBLIC_FORCE_DEMO !== "true") {
    warned = true;
  }
  return restClient;
}

export const api = new Proxy({} as RestClient, {
  get(_target, prop) {
    const live = getLiveClient();
    const active = (isDemoMode() ? demoClient : live) as unknown as Record<
      string,
      unknown
    >;
    const value = active[prop as string];
    return typeof value === "function" ? value.bind(active) : value;
  },
}) as unknown as RestClient;

/** Vrai si les données affichées proviennent du backend local de démonstration. */
export function usingDemoData(): boolean {
  return isDemoMode();
}
