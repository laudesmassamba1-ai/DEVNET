"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Écran de maintenance.
 *
 * Affiché quand `/api/platform/status` répond `blocked: true`. Il ne
 * remplace pas l'application par une erreur : il dit ce qui se passe, avec
 * le message rédigé par l'administrateur, et propose de réessayer.
 *
 * Deux précautions :
 *  - **Aucune donnée personnelle** n'est rendue ici : l'écran doit rester
 *    sûr même si la base est en cours de manipulation.
 *  - **La sortie reste possible** : un compte qui n'est pas administrateur
 *    peut se déconnecter, sinon il serait prisonnier d'un écran sans issue.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{
    blocked: boolean;
    message: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/platform/status", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { blocked?: boolean; message?: string };
        if (!alive) return;
        setState({
          blocked: body.blocked === true,
          message: body.message ?? "",
        });
      } catch {
        /* réseau absent : le mode hors-ligne prend le relais */
      }
    };
    void check();
    return () => {
      alive = false;
    };
  }, []);

  const retry = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/platform/status", { cache: "no-store" });
      const body = (await res.json()) as { blocked?: boolean; message?: string };
      setState({ blocked: body.blocked === true, message: body.message ?? "" });
    } catch {
      /* laisse l'écran en place */
    } finally {
      setChecking(false);
    }
  };

  if (!state?.blocked) return <>{children}</>;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-(--gutter) text-center">
      <p className="font-mono text-12 tracking-widest text-chalk-4 uppercase">
        Maintenance
      </p>
      <h1 className="max-w-prose font-display text-display-l font-semibold tracking-tight">
        {state.message || "DevNet revient dans un instant."}
      </h1>
      <p className="max-w-prose text-13 leading-relaxed text-chalk-3">
        Tes données sont intactes. La lecture reprend dès la réouverture.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => void retry()}
          disabled={checking}
          className="mo-press min-h-(--h-tap) rounded-(--radius-chip) border
            border-signal px-4 text-13 font-medium text-signal
            disabled:border-line-3 disabled:text-chalk-4"
        >
          {checking ? "Vérification…" : "Réessayer"}
        </button>
        <button
          type="button"
          onClick={() => {
            // Déconnexion puis retour à la connexion : un POST, parce que
            // la route n'accepte que celui-ci.
            void fetch("/api/auth/sign-out", { method: "POST" }).finally(() => {
              router.push("/login");
            });
          }}
          className="min-h-(--h-tap) rounded-(--radius-chip) border border-line-3
            px-4 text-13 text-chalk-3"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
