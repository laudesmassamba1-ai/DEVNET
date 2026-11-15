"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Téléchargement explicite d'une vidéo.
 *
 * Le service worker ne peut pas deviner qu'une vidéo doit rester hors-ligne :
 * les fichiers sont lourds, et les télécharger tous au premier affichage
 * consommerait le forfait de quelqu'un qui voulait juste regarder dix
 * secondes. C'est donc un geste, et le bouton dit l'état réel : disponible,
 * en cours, ou échec avec le motif.
 */
export function OfflineVideoButton({
  url,
  className = "",
}: {
  url: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  const internal = (() => {
    if (typeof window === "undefined") return false;
    try {
      const target = new URL(url, window.location.origin);
      return target.origin === window.location.origin &&
        target.pathname.startsWith("/api/media/");
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    let alive = true;
    if (!internal || typeof caches === "undefined") return;
    const target = new URL(url, window.location.origin);
    target.hash = "";
    void caches.match(target.href).then((cached) => {
      if (alive && cached) setState("saved");
    });
    return () => {
      alive = false;
    };
  }, [internal, url]);

  async function download() {
    if (!internal || state === "saving" || state === "saved") return;
    if (typeof navigator === "undefined" || !navigator.onLine) {
      setState("error");
      setMessage("Connexion requise pour télécharger.");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      setState("error");
      setMessage("Le service worker n'est pas disponible.");
      return;
    }

    setState("saving");
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active ?? registration.waiting ?? registration.installing;
      if (!worker) throw new Error("service worker inactif");

      const result = await new Promise<{ ok?: boolean; error?: string }>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = window.setTimeout(() => reject(new Error("délai dépassé")), 120_000);
        channel.port1.onmessage = (event) => {
          window.clearTimeout(timer);
          resolve(event.data as { ok?: boolean; error?: string });
        };
        worker.postMessage({ type: "DOWNLOAD_MEDIA", url }, [channel.port2]);
      });

      if (result.ok) {
        setState("saved");
        setMessage("Vidéo disponible hors-ligne.");
      } else {
        setState("error");
        setMessage(result.error ?? "Téléchargement refusé.");
      }
    } catch {
      setState("error");
      setMessage("Téléchargement impossible.");
    }
  }

  if (!internal) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 text-12 ${className}`}>
      <button
        type="button"
        onClick={() => void download()}
        disabled={state === "saving" || state === "saved"}
        className="flex min-h-(--h-action) items-center gap-1.5 rounded-(--radius-chip)
          border border-line-3 bg-surface px-2.5 font-bold text-chalk-3
          transition-colors hover:border-signal hover:text-signal disabled:opacity-60"
      >
        <Icon name={state === "saved" ? "check" : "download"} size={12} strokeWidth={2} />
        {state === "saved"
          ? "Disponible hors-ligne"
          : state === "saving"
            ? "Téléchargement…"
            : "Télécharger hors-ligne"}
      </button>
      {message && (
        <span role="status" className={state === "error" ? "text-warn" : "text-ok"}>
          {message}
        </span>
      )}
    </div>
  );
}
