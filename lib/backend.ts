/**
 * Détection de la disponibilité du backend.
 *
 * Un projet Supabase supprimé ne provoque pas une erreur franche : son nom
 * de domaine cesse simplement de résoudre, et le client web affiche « Failed to
 * fetch » partout, indistinctement d'un mot de passe faux. On sonde donc
 * explicitement l'API REST avant de laisser l'application tenter quoi que ce
 * soit, afin de basculer en mode démo avec un message honnête plutôt qu'un
 * écran vide.
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

export function getSupabaseUrl(): string | null {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!envUrl) return null;
  if (typeof window !== "undefined") {
    // Si accédé depuis un tunnel HTTPS (ex: Cloudflare trycloudflare) ou un client distant,
    // et que l'URL configurée pointe vers localhost/127.0.0.1,
    // on utilise l'origine courante relayée par les rewrites Next.js pour éviter le Mixed Content.
    if (envUrl.includes("localhost") || envUrl.includes("127.0.0.1")) {
      return window.location.origin;
    }
  }
  return envUrl;
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

  const url = getSupabaseUrl();

  if (!url) {
    return set({
      state: "offline",
      url: null,
      reason: "NEXT_PUBLIC_SUPABASE_URL n'est pas défini dans .env.local",
      checkedAt: Date.now(),
    });
  }

  const fresh = state.checkedAt !== null && Date.now() - state.checkedAt < CACHE_MS;
  if (!force && fresh) return state;

  set({ state: "checking", url, reason: null });

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
      cache: "no-store",
    });
    if (!res.ok) {
      return set({
        state: "offline",
        url,
        reason: `La sonde serveur répond ${res.status}.`,
        checkedAt: Date.now(),
      });
    }
    const verdict = (await res.json()) as { state?: string; reason?: string };
    if (verdict.state === "offline") {
      return set({
        state: "offline",
        url,
        reason: verdict.reason ?? "Le backend est injoignable.",
        checkedAt: Date.now(),
      });
    }
    return set({ state: "online", url, reason: null, checkedAt: Date.now() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const dns = /resolve|ENOTFOUND|nxdomain|getaddrinfo/i.test(msg);
    return set({
      state: "offline",
      url,
      reason: dns
        ? `Le nom de domaine du projet ne résout plus (${url}). Le projet a probablement été supprimé ou mis en pause longue durée.`
        : `Le backend ne répond pas (${msg}).`,
      checkedAt: Date.now(),
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Vrai si l'application doit afficher les données de démonstration. */
export function isDemoMode(): boolean {
  return state.state === "offline";
}