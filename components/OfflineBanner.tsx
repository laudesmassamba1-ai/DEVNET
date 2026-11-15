"use client";

import { useEffect, useState } from "react";
import { isDemoAllowed } from "@/lib/backend";
import { useBackend } from "@/hooks/useBackend";
import { useLastOnline } from "@/components/last-online";
import {
  flushOfflineQueue,
  offlineQueueSummary,
  OFFLINE_QUEUE_EVENT,
  type OfflineQueueSummary,
} from "@/lib/offline-queue";

/**
 * Bandeau « hors ligne ».
 *
 * Le mode hors-ligne de DevNet sert les **dernières données réelles** depuis
 * le cache du service worker. C'est utile, et c'est dangereux : sans
 * signalement, l'app paraît normale alors qu'elle montre un fil qui date, et
 * qu'aucune écriture ne peut aboutir. On le dit donc, discrètement mais
 * toujours, en haut de l'écran.
 *
 * Trois cas, trois messages :
 * - `navigator.onLine === false` : l'appareil n'a pas de réseau. Rien
 *   n'aboutira, lecture comprise si le cache est froid.
 * - sonde en échec mais appareil connecté : le serveur ne répond pas. La
 *   lecture vient du cache, les écritures échoueront.
 * - mode démo forcé : ce n'est pas une panne, c'est un choix de
 *   configuration. On ne l'annonce pas comme un incident.
 *
 * Le bandeau ne s'affiche jamais en mode démo forcé : il n'y a pas de
 * « hors ligne » à signaler quand c'est voulu.
 */
export function OfflineBanner() {
  const backend = useBackend();
  const wasEverOnline = useLastOnline();
  const [deviceOffline, setDeviceOffline] = useState(false);
  const [queue, setQueue] = useState<OfflineQueueSummary>({ pending: 0, failed: 0 });
  const [flushing, setFlushing] = useState(false);

  useEffect(() => {
    // `navigator.onLine` ne dit qu'une chose : l'appareil a une interface
    // réseau active. Il ne prouve pas que le serveur répond — d'où la
    // seconde source, la sonde.
    const sync = () => setDeviceOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // La file s'exécute même quand le bandeau est invisible : c'est elle qui
  // rend vraie la phrase « les envois attendront le réseau ».
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void offlineQueueSummary().then((next) => {
        if (alive) setQueue(next);
      });
    };
    const flush = () => {
      if (!navigator.onLine) return;
      setFlushing(true);
      void flushOfflineQueue()
        .then((next) => { if (alive) setQueue(next); })
        .finally(() => { if (alive) setFlushing(false); });
    };

    refresh();
    flush();
    window.addEventListener("online", flush);
    window.addEventListener(OFFLINE_QUEUE_EVENT, refresh);
    const timer = window.setInterval(flush, 30_000);
    return () => {
      alive = false;
      window.removeEventListener("online", flush);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, refresh);
      window.clearInterval(timer);
    };
  }, []);

  if (isDemoAllowed()) return null;

  const serverDown = backend.state === "offline";
  const hasQueue = queue.pending > 0 || queue.failed > 0;
  if (!deviceOffline && !serverDown && !hasQueue) return null;

  // Sans marqueur de session, `BackendGate` affiche déjà l'écran plein.
  // Le bandeau n'aurait rien à surmonter, sauf une file à signaler.
  if (!wasEverOnline && !hasQueue) return null;

  const writes = queue.pending + queue.failed;
  const message = queue.failed > 0
    ? `${queue.failed} écriture${queue.failed > 1 ? "s" : ""} n'ont pas pu être synchronisées.`
    : queue.pending > 0
      ? flushing
        ? `Synchronisation de ${queue.pending} écriture${queue.pending > 1 ? "s" : ""}…`
        : `${queue.pending} écriture${queue.pending > 1 ? "s" : ""} en attente du réseau.`
      : deviceOffline
        ? "Hors ligne. Tu lis la dernière version enregistrée."
        : "Serveur injoignable. Tu lis la dernière version enregistrée.";

  return (
    <div
      role="status"
      aria-live="polite"
      data-offline-banner=""
      className="sticky top-0 z-(--z-toast) flex items-center justify-center gap-2
        border-b border-line-2 bg-surface-2 px-3 py-1.5 text-center text-12
        font-medium text-chalk-3"
    >
      <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-danger" />
      <span>{message}</span>
      {writes > 0 && (
        <span className="font-mono text-chalk-4">({writes})</span>
      )}
      {queue.failed > 0 && (
        <button
          type="button"
          onClick={() => {
            setFlushing(true);
            void flushOfflineQueue({ retryFailed: true })
              .then(setQueue)
              .finally(() => setFlushing(false));
          }}
          disabled={flushing}
          className="min-h-(--h-action) rounded-(--radius-chip) border border-line-3
            px-2 font-bold text-chalk transition-colors hover:bg-surface-3
            disabled:opacity-40"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}
