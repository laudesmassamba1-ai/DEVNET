"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { OFFLINE_CACHE_PURGED_EVENT } from "@/lib/offline-cache";

/**
 * Préchauffe les destinations principales après l'ouverture.
 *
 * Une navigation App Router récupère un payload RSC, pas seulement du HTML.
 * Sans préchauffage, le premier clic vers un onglet jamais ouvert paie ce
 * payload avant de peindre. On le demande pendant un temps mort, après la
 * première interaction possible : l'écran courant reste prioritaire, mais
 * les onglets suivants sont déjà dans le routeur et dans le cache du
 * service worker.
 *
 * On ne préchauffe pas les pages publiques ni l'administration : la
 * première est déjà souvent ouverte, la seconde reste visitée à la
 * demande. Sur `saveData`, on ne consomme pas le forfait mobile pour un
 * confort de navigation.
 */
const ROUTES = [
  "/feed",
  "/decouvrir",
  "/search",
  "/groups",
  "/messages",
  "/profile",
  "/notifications",
  "/settings",
  "/signets",
  "/communities",
  "/projects",
  "/github",
  "/moderation",
];

const warmedUsers = new Set<string>();
const warmedDynamicUsers = new Set<string>();

export function RouteWarmup() {
  const router = useRouter();
  const { session, loading } = useSession();
  const warmedFor = useRef<string | null>(null);

  useEffect(() => {
    const reset = () => {
      warmedUsers.clear();
      warmedDynamicUsers.clear();
      warmedFor.current = null;
    };
    window.addEventListener(OFFLINE_CACHE_PURGED_EVENT, reset);
    return () => window.removeEventListener(OFFLINE_CACHE_PURGED_EVENT, reset);
  }, []);

  useEffect(() => {
    if (loading || !session) return;
    if (warmedFor.current === session.user.id) return;
    // Le composant peut être remonté par une transition de route : le
    // garde module-level évite de relancer treize préchargements à chaque
    // remontage, ce qui finissait par saturer le routeur et le SW.
    if (warmedUsers.has(session.user.id)) return;
    warmedUsers.add(session.user.id);
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || connection?.effectiveType === "slow-2g") return;

    warmedFor.current = session.user.id;
    const routes = ROUTES;
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Le document HTML des destinations, pas seulement le RSC : sans lui,
    // un lancement à froid depuis un raccourci PWA hors-ligne tomberait
    // sur la page « hors ligne » alors que l'écran a déjà été visité.
    void navigator.serviceWorker?.ready
      .then((registration) => {
        registration.active?.postMessage({ type: "WARM_ROUTES", routes });
      })
      .catch(() => undefined);

    const step = () => {
      if (index >= routes.length) return;
      const href = routes[index];
      index += 1;
      if (typeof window === "undefined" || href !== window.location.pathname) {
        router.prefetch(href);
      }
      timer = setTimeout(step, 220);
    };

    const idle = window.requestIdleCallback?.(
      () => {
        timer = setTimeout(step, 900);
      },
      { timeout: 4_000 },
    );

    if (idle === undefined) timer = setTimeout(step, 1_600);

    return () => {
      if (timer) clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
    };
  }, [loading, router, session]);

  useEffect(() => {
    if (loading || !session) return;
    const userId = session.user.id;
    if (warmedDynamicUsers.has(userId)) return;
    warmedDynamicUsers.add(userId);
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || connection?.effectiveType === "slow-2g") return;

    let cancelled = false;
    // Après le préchauffage statique : les pages récentes ne doivent pas
    // retarder les onglets que l'on ouvre tous les jours.
    const timer = window.setTimeout(() => {
      void fetch("/api/offline/routes", { cache: "no-store", credentials: "same-origin" })
        .then((response) => response.ok ? response.json() : null)
        .then((data: { paths?: unknown } | null) => {
          if (cancelled) return;
          const paths = Array.isArray(data?.paths)
            ? data.paths.filter((path): path is string =>
                typeof path === "string" && path.startsWith("/"))
            : [];
          if (paths.length === 0) return;
          for (const path of paths) router.prefetch(path);
          void navigator.serviceWorker?.ready
            .then((registration) => {
              registration.active?.postMessage({ type: "WARM_ROUTES", routes: paths });
            })
            .catch(() => undefined);
        })
        .catch(() => undefined);
    }, 2_800);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loading, router, session]);

  return null;
}
