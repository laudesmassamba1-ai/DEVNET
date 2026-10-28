"use client";

import { useEffect } from "react";
import { Loading } from "@/components/Avatar";
import { probeBackend } from "@/lib/backend";
import { useBackend } from "@/hooks/useBackend";

/**
 * Sonde le backend avant le premier rendu métier et affiche le bandeau de
 * mode démonstration le cas échéant. Le rendu est bloqué le temps de la
 * sonde (4 s maximum) : afficher le fil puis le vider en erreur serait pire.
 *
 * Ce composant est client : `layout.tsx` est un Server Component et ne peut
 * pas appeler la sonde ni s'y abonner lui-même.
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

  return <>{children}</>;
}