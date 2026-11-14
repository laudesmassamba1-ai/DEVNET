"use client";

import { useEffect } from "react";
import { isDemoAllowed, probeBackend } from "@/lib/backend";
import { useBackend } from "@/hooks/useBackend";
import { useLastOnline } from "@/components/last-online";

/**
 * Sonde le backend sans bloquer le premier rendu.
 *
 * La sonde tourne en arrière-plan : attendre son verdict ajoutait un à
 * deux secondes d'écran vide à chaque ouverture. Seul un échec confirmé
 * remplace l'interface par la page d'erreur.
 */
export function BackendGate({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void probeBackend();
  }, []);

  const backend = useBackend();

  /* ── Mode hors-ligne réel ──
     Un backend injoignable n'est pas une panne pour l'app déjà
     installée : le service worker garde les **données réelles** de la
     dernière session en ligne (`devnet-pwa-*-data`) et sert les
     lectures depuis ce cache. Tant que cette session a existé —
     marqueur `devnet:last-online`, posé par `useSession` au premier
     profil résolu — l'app s'ouvre et se lit hors-ligne ; les écritures
     échouent avec leur erreur honnête, et un réseau revenu réactive
     tout. Sans marqueur (première ouverture hors-ligne, jamais
     connecté), l'écran d'erreur reste : il n'y a littéralement rien à
     montrer. */
  const wasEverOnline = useLastOnline();

  if (backend.state === "offline" && !isDemoAllowed() && !wasEverOnline) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="text-lg font-medium">Backend indisponible</div>
        <div className="max-w-md text-sm text-chalk/70">
          {backend.reason ?? "Impossible de se connecter à Supabase."}
        </div>
        <button
          type="button"
          onClick={() => void probeBackend(true)}
          className="rounded-md border border-chalk/20 px-4 py-2 text-sm hover:bg-chalk/5"
        >
          Réessayer
        </button>
      </div>
    );
  }

  return <>{children}</>;
}