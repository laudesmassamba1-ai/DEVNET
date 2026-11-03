"use client";

import { useEffect } from "react";
import { Loading } from "@/components/Avatar";
import { isDemoAllowed, probeBackend } from "@/lib/backend";
import { useBackend } from "@/hooks/useBackend";

/**
 * Sonde le backend avant le premier rendu métier.
 * En production sans backend joignable et sans opt-in démo, on affiche
 * une page d'erreur plutôt qu'un repli silencieux vers des données fictives.
 */
export function BackendGate({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void probeBackend();
  }, []);

  const backend = useBackend();

  if (backend.state === "unknown" || backend.state === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loading label="Connexion au réseau" />
      </div>
    );
  }

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