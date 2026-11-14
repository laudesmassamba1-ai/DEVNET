"use client";

import { useEffect, useState } from "react";
import { isDemoAllowed } from "@/lib/backend";
import { useBackend } from "@/hooks/useBackend";
import { useLastOnline } from "@/components/last-online";

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

  if (isDemoAllowed()) return null;

  const serverDown = backend.state === "offline";
  if (!deviceOffline && !serverDown) return null;

  // Sans marqueur de session, `BackendGate` affiche déjà l'écran plein.
  // Le bandeau n'aurait rien à surmonter.
  if (!wasEverOnline) return null;

  const message = deviceOffline
    ? "Hors ligne — tu lis la dernière version enregistrée. Les envois attendront le réseau."
    : "Serveur injoignable — tu lis la dernière version enregistrée. Les envois échoueront.";

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
    </div>
  );
}
