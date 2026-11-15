/**
 * Mode hors-ligne : marqueur de session et purge du cache de données.
 *
 * Le service worker (`public/sw.js`) met en cache les lectures de l'API
 * (`devnet-pwa-*-data`) : tant qu'une session a été établie au moins une
 * fois sur l'appareil, l'app peut s'ouvrir et se **lire** hors-ligne.
 * Trois pièces :
 *
 * - `markLastOnline` — posé par `useSession` au premier profil résolu ;
 *   `BackendGate` laisse passer l'app hors-ligne tant que le marqueur
 *   est frais (30 jours) ;
 * - `clearLastOnline` + `purgeOfflineCache` — appelés à la déconnexion :
 *   les données mises en cache sont personnelles, elles partent avec la
 *   session ;
 * - `readLastOnline` — lecture pure, garde SSR (`typeof window`).
 *
 * Ce fichier est neutre (pas de directive `"use client"`) : la couche
 * auth (`lib/rest/client.ts`) l'importe aussi, et elle est évaluée côté
 * serveur par les scripts.
 */

export const LAST_ONLINE_KEY = "devnet:last-online";
/**
 * Identité qui a rempli le cache hors-ligne. Si elle change sans
 * déconnexion explicite (OAuth, nouvel onglet, lien magique), les données
 * de l'ancien compte ne doivent pas se peindre sous le nouveau.
 */
export const SESSION_USER_KEY = "devnet:session-user";
/** Signal local : le cache hors-ligne vient d'être purgé. */
export const OFFLINE_CACHE_PURGED_EVENT = "devnet:offline-cache-purged";

/** Période de validité du marqueur, en millisecondes (30 jours). */
const LAST_ONLINE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function markLastOnline(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_ONLINE_KEY, String(Date.now()));
  } catch {
    /* stockage indisponible : hors-ligne restera bloqué, honnêtement */
  }
}

export function rememberSessionUser(id: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_USER_KEY, id);
  } catch {
    /* pas de marqueur : le cache restera celui de la session courante */
  }
}

export function previousSessionUser(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SESSION_USER_KEY);
  } catch {
    return null;
  }
}

export function forgetSessionUser(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SESSION_USER_KEY);
  } catch {
    /* rien à oublier */
  }
}

export function clearLastOnline(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LAST_ONLINE_KEY);
  } catch {
    /* rien à purger */
  }
}

export function readLastOnline(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(LAST_ONLINE_KEY);
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < LAST_ONLINE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Purge le cache de données hors-ligne du service worker.
 *
 * Le SW vit dans un autre thread : la purge passe par un message.
 * Sans SW actif (première visite), il n'y a rien à purger.
 */
export function purgeOfflineCache(): void {
  if (typeof window === "undefined") return;
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "PURGE_DATA" });
  } catch {
    /* le SW répondra à son rythme ou pas du tout — la déconnexion
       elle-même n'en dépend pas */
  }
  // Même sans contrôleur actif, les composants qui gardent un état de
  // préchauffage doivent oublier l'ancien compte.
  window.dispatchEvent(new Event(OFFLINE_CACHE_PURGED_EVENT));
}
