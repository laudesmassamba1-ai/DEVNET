"use client";

import { useEffect } from "react";
import { useBackend } from "@/hooks/useBackend";

const INTERVAL_MS = 60_000;

/**
 * Déclencheur léger du drainage quand aucun planificateur n'est disponible.
 *
 * Il ne fait rien hors ligne, jamais dans le rendu serveur, et ignore les
 * refus : un visiteur non connecté reçoit un 401 silencieux. La route borne
 * le travail ; ce composant ne fait que frapper à la porte.
 */
export function EventPump() {
  const backend = useBackend();
  const online = backend.state === "online";

  useEffect(() => {
    if (!online) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const drain = () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        void fetch("/api/events/drain?background=1", {
          method: "POST",
          keepalive: true,
        }).catch(() => undefined);
      }
      timer = setTimeout(drain, INTERVAL_MS);
    };

    timer = setTimeout(drain, 8_000);

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      drain();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [online]);

  return null;
}
