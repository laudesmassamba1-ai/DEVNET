"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Icon, type IconName } from "./Icon";
import { Motion } from "./Motion";
import { Sheet } from "./Sheet";
import {
  PWA_ICONS,
  PWA_INSTALL_DISMISS_MS,
  PWA_INSTALL_DISMISSED_KEY,
  PWA_LIGHT_THEME_COLOR,
  PWA_SERVICE_WORKER_URL,
  PWA_THEME_COLOR,
} from "@/lib/pwa";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type PwaContextValue = {
  installed: boolean;
  canInstall: boolean;
  isIos: boolean;
  updateReady: boolean;
  install: () => Promise<void>;
  dismissInstall: () => void;
  applyUpdate: () => void;
};

const PwaContext = createContext<PwaContextValue | null>(null);

const PUBLIC_PAGES = new Set([
  "/",
  "/login",
  "/register",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
  "/auth/confirmer",
]);

const subscribeNoop = () => () => {};

function subscribeStandalone(onChange: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function getServerStandalone() {
  return false;
}

function getMounted() {
  return true;
}

function getServerMounted() {
  return false;
}

function getIos() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function getServerIos() {
  return false;
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getOnline() {
  return navigator.onLine;
}

function getServerOnline() {
  return true;
}

function readInstallDismissed() {
  try {
    const saved = Number(localStorage.getItem(PWA_INSTALL_DISMISSED_KEY));
    return Number.isFinite(saved) && Date.now() - saved < PWA_INSTALL_DISMISS_MS;
  } catch {
    return false;
  }
}

export function usePwa(): PwaContextValue {
  const value = useContext(PwaContext);
  if (!value) throw new Error("usePwa doit être utilisé dans PwaManager.");
  return value;
}

export function PwaManager({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mounted = useSyncExternalStore(subscribeNoop, getMounted, getServerMounted);
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    getStandalone,
    getServerStandalone,
  );
  const isIos = useSyncExternalStore(subscribeNoop, getIos, getServerIos);
  const online = useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);

  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(readInstallDismissed);
  const [installReady, setInstallReady] = useState(false);
  const [iosSheet, setIosSheet] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const updateRequested = useRef(false);
  const installPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  const installed = standalone || appInstalled;
  const canInstall = Boolean(installEvent) && !installed;

  useEffect(() => {
    const applyChrome = () => {
      const light = document.documentElement.dataset.theme === "light";
      const themeColor = document.querySelector('meta[name="theme-color"]');
      const statusBar = document.querySelector(
        'meta[name="apple-mobile-web-app-status-bar-style"]',
      );
      themeColor?.setAttribute("content", light ? PWA_LIGHT_THEME_COLOR : PWA_THEME_COLOR);
      statusBar?.setAttribute("content", light ? "default" : "black-translucent");
    };

    applyChrome();
    const observer = new MutationObserver(applyChrome);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const adopt = (event: Event) => {
      installPrompt.current = event as BeforeInstallPromptEvent;
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      adopt(event);
    };
    const onInstalled = () => {
      installPrompt.current = null;
      setInstallEvent(null);
      setAppInstalled(true);
      setInstallReady(false);
    };

    // L'événement a peut-être déjà été émis avant l'hydratation : le script
    // `beforeInteractive` du layout l'a mis de côté. Sans cette reprise, le
    // bouton « Installer » restait invisible sur un premier chargement.
    const early = (window as Window & { __devnetInstallPrompt?: Event }).__devnetInstallPrompt;
    if (early) adopt(early);

    const onAvailable = () => {
      const stashed = (window as Window & { __devnetInstallPrompt?: Event }).__devnetInstallPrompt;
      if (stashed) adopt(stashed);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("devnet:install-available", onAvailable);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("devnet:install-available", onAvailable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let visibilityCleanup: (() => void) | undefined;
    let lastUpdateCheck = 0;

    const onControllerChange = () => {
      if (!updateRequested.current) return;
      updateRequested.current = false;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register(PWA_SERVICE_WORKER_URL)
      .then((registration) => {
        if (cancelled) return;

        const showWaiting = () => {
          if (registration.waiting && navigator.serviceWorker.controller) {
            setUpdateReady(true);
          }
        };

        showWaiting();

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });

        const onVisibility = () => {
          if (document.visibilityState !== "visible") return;
          const now = Date.now();
          if (now - lastUpdateCheck < 60 * 60 * 1000) return;
          lastUpdateCheck = now;
          void registration.update().catch(() => {});
        };

        document.addEventListener("visibilitychange", onVisibility);
        visibilityCleanup = () => document.removeEventListener("visibilitychange", onVisibility);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      visibilityCleanup?.();
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!mounted || installed || installDismissed) return;
    if (!canInstall && !isIos) return;
    if (PUBLIC_PAGES.has(pathname)) return;

    // Laisser le temps de lire l'écran avant de proposer l'installation.
    // Une invite trop tôt recouvre le contenu et gêne la prise en main.
    const timer = window.setTimeout(() => setInstallReady(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [canInstall, installDismissed, installed, isIos, mounted, pathname]);

  const dismissInstall = useCallback(() => {
    setInstallDismissed(true);
    setInstallReady(false);
    try {
      localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, String(Date.now()));
    } catch {
      return;
    }
  }, []);

  const install = useCallback(async () => {
    const event = installPrompt.current ?? installEvent;
    if (!event) return;

    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") setAppInstalled(true);
    } catch {
      return;
    } finally {
      installPrompt.current = null;
      setInstallEvent(null);
      setInstallReady(false);
    }
  }, [installEvent]);

  const applyUpdate = useCallback(() => {
    updateRequested.current = true;
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (registration?.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
          return;
        }
        window.location.reload();
      })
      .catch(() => window.location.reload());
  }, []);

  const value = useMemo(
    () => ({
      installed,
      canInstall,
      isIos,
      updateReady,
      install,
      dismissInstall,
      applyUpdate,
    }),
    [installed, canInstall, isIos, updateReady, install, dismissInstall, applyUpdate],
  );

  const showOffline = mounted && !online;
  const showUpdate = mounted && online && updateReady;
  const showInstall =
    mounted &&
    online &&
    !showUpdate &&
    !installed &&
    !installDismissed &&
    installReady &&
    !PUBLIC_PAGES.has(pathname) &&
    (canInstall || isIos);

  return (
    <PwaContext.Provider value={value}>
      {children}

      {showOffline && (
        <PwaBanner
          icon="info"
          title="Hors ligne"
          description="La connexion reviendra automatiquement. Les pages déjà ouvertes restent accessibles."
        />
      )}

      {showUpdate && (
        <PwaBanner
          icon="download"
          title="Mise à jour prête"
          description="Une nouvelle version de DevNet attend d'être chargée."
          action={{ label: "Recharger", onClick: applyUpdate }}
          secondary={{ label: "Plus tard", onClick: () => setUpdateReady(false) }}
        />
      )}

      {showInstall && (
        <PwaBanner
          icon="plus"
          title="Installer DevNet"
          description={
            isIos
              ? "Plein écran, démarrage immédiat, comme une application."
              : "Accès direct, plein écran et démarrage plus rapide."
          }
          action={
            canInstall
              ? { label: "Installer", onClick: () => void install() }
              : { label: "Comment faire", onClick: () => setIosSheet(true) }
          }
          secondary={
            canInstall ? { label: "Plus tard", onClick: dismissInstall } : undefined
          }
        />
      )}

      {/*
        Sur iOS, il n'existe pas d'invite programmatique : seul le menu
        Partager de Safari installe l'application. Plutôt que d'écrire un
        mode d'emploi dans une bannière qui disparaît, on ouvre une feuille
        qui montre les trois gestes, image et numéros à l'appui.
      */}
      <Sheet open={iosSheet} onClose={() => setIosSheet(false)} title="Installer DevNet">
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex items-center gap-3">
            <Image
              src={PWA_ICONS.appleTouch}
              alt=""
              width={56}
              height={56}
              unoptimized
              className="size-14 rounded-[14px] border border-line-2"
            />
            <p className="text-sm leading-relaxed text-chalk-3">
              DevNet s&apos;ajoute à l&apos;écran d&apos;accueil, sans passer par l&apos;App Store.
            </p>
          </div>

          <ol className="flex flex-col gap-3">
            {[
              {
                icon: "share" as IconName,
                title: "Ouvre Partager",
                body: "Dans Safari, appuie sur l'icône Partager de la barre du bas.",
              },
              {
                icon: "plus" as IconName,
                title: "Sur l'écran d'accueil",
                body: "Fais défiler le menu et choisis « Sur l'écran d'accueil ».",
              },
              {
                icon: "check" as IconName,
                title: "Ajoute",
                body: "Confirme avec « Ajouter » : l'icône apparaît à côté de tes apps.",
              },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full
                    border border-line-3 bg-surface font-mono text-xs font-bold text-signal"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-chalk">
                    <Icon name={step.icon} size={14} strokeWidth={2} />
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-chalk-3">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={() => {
              setIosSheet(false);
              dismissInstall();
            }}
            className="lift-press mt-1 flex min-h-(--h-tap) w-full items-center justify-center
              rounded-(--radius-input) border border-signal bg-signal px-4
              text-sm font-bold text-void"
          >
            Compris
          </button>
        </div>
      </Sheet>
    </PwaContext.Provider>
  );
}

function PwaBanner({
  icon,
  title,
  description,
  action,
  secondary,
}: {
  icon: IconName;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <Motion
      role="rise"
      as="section"
      attrs={{ role: "status", "aria-live": "polite" }}
      className="pwa-toast pointer-events-none fixed inset-x-3 mx-auto max-w-md
        shell:inset-x-auto shell:right-4 shell:bottom-6 shell:w-96"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="pointer-events-auto flex items-start gap-3 rounded-(--radius-card) border
        border-edge bg-surface-2 p-3.5 text-chalk shadow-(--shadow-sh-1)">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full
          bg-signal/15 text-signal">
          <Icon name={icon} size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug text-chalk">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-chalk-3">{description}</p>
          {(action || secondary) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {action && (
                <button
                  type="button"
                  onClick={action.onClick}
                  className="lift-press flex min-h-(--h-tap) items-center justify-center
                    rounded-(--radius-input) border border-signal bg-signal px-4
                    text-xs font-bold text-void"
                >
                  {action.label}
                </button>
              )}
              {secondary && (
                <button
                  type="button"
                  onClick={secondary.onClick}
                  className="flex min-h-(--h-tap) items-center justify-center
                    rounded-(--radius-input) border border-line-3 bg-surface px-4
                    text-xs font-bold text-chalk-3 hover:border-signal hover:text-chalk"
                >
                  {secondary.label}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Motion>
  );
}
