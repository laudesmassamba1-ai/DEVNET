/**
 * Détection de la disponibilité du backend.
 *
 * Le navigateur ne parle plus à un service externe : le backend est l'API
 * maison, adossée à PostgreSQL. Une base arrêtée ou un `DATABASE_URL` absent
 * se traduit par une sonde serveur en échec, et l'application bascule en mode
 * démonstration avec un message honnête plutôt qu'un écran vide.
 */

export type BackendState = "unknown" | "checking" | "online" | "offline";

export interface BackendProbe {
  state: BackendState;
  url: string | null;
  reason: string | null;
  checkedAt: number | null;
}

/** Durée maximale de la sonde : au-delà, on déclare le backend mort. */
const PROBE_TIMEOUT_MS = 4000;
/** Combien de temps on retient le résultat avant de re-sonder. */
const CACHE_MS = 30_000;

let state: BackendProbe = {
  state: "unknown",
  url: null,
  reason: null,
  checkedAt: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getBackend(): BackendProbe {
  return state;
}

function set(next: Partial<BackendProbe>): BackendProbe {
  state = { ...state, ...next };
  emit();
  return state;
}

/**
 * Sonde le backend. Renvoie l'état courant.
 *
 * `force` ignore le cache — utilisé par le bouton « Réessayer » du panneau
 * de diagnostic et par le rechargement de page.
 */
export async function probeBackend(force = false): Promise<BackendProbe> {
  // Forcer le mode démo via variable d'environnement
  if (process.env.NEXT_PUBLIC_FORCE_DEMO === "true") {
    return set({
      state: "offline",
      url: null,
      reason: "Mode démo forcé via NEXT_PUBLIC_FORCE_DEMO",
      checkedAt: Date.now(),
    });
  }

  const fresh = state.checkedAt !== null && Date.now() - state.checkedAt < CACHE_MS;
  if (!force && fresh) return state;

  set({ state: "checking", url: null, reason: null });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    // La sonde passe par une route serveur : en mode démo, une requête
    // directe vers /rest récolterait un 500 que Chromium consignerait
    // dans la console — un bruit qui ne signale rien de cassé. Ici le
    // navigateur reçoit toujours un 200 JSON décrivant l'état.
    const res = await fetch("/api/backend-check", {
      method: "GET",
      signal: controller.signal,
      // La route est cacheable quelques secondes côté CDN ; un « Réessayer »
      // explicite doit au contraire ignorer ce cache.
      cache: force ? "reload" : "default",
    });
    if (!res.ok) {
      return set({
        state: "offline",
        url: null,
        reason: `La sonde serveur répond ${res.status}.`,
        checkedAt: Date.now(),
      });
    }
    const verdict = (await res.json()) as { state?: string; reason?: string };
    if (verdict.state === "offline") {
      return set({
        state: "offline",
        url: null,
        reason: verdict.reason ?? "Le backend est injoignable.",
        checkedAt: Date.now(),
      });
    }
    return set({ state: "online", url: null, reason: null, checkedAt: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return set({
      state: "offline",
      url: null,
      reason: `Le backend ne répond pas (${msg}).`,
      checkedAt: Date.now(),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Vrai si le repli sur les données de démonstration est autorisé.
 *
 * En production, un backend injoignable doit être signalé comme une panne,
 * pas masqué par des données fictives. Le mode démo reste disponible en
 * développement, ou en production sur opt-in explicite.
 */
export function isDemoAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_FORCE_DEMO === "true"
  );
}

/**
 * Vrai si l'application doit afficher les données de démonstration.
 *
 * Côté serveur (tests, scripts, rendu initial), l'absence de `DATABASE_URL`
 * est connue immédiatement : inutile d'attendre une sonde réseau. Côté
 * navigateur, `DATABASE_URL` n'est jamais exposée ; c'est la sonde
 * `/api/backend-check` qui décide.
 */
export function isDemoMode(): boolean {
  if (process.env.NEXT_PUBLIC_FORCE_DEMO === "true") return true;
  if (typeof window === "undefined" && !process.env.DATABASE_URL?.trim()) {
    return isDemoAllowed();
  }
  return state.state === "offline" && isDemoAllowed();
}