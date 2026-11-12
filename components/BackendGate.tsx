"use client";

import { useEffect } from "react";
import { isDemoAllowed, probeBackend } from "@/lib/backend";
import { useBackend } from "@/hooks/useBackend";

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

  if (backend.state === "offline" && !isDemoAllowed()) {
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