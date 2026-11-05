"use client";

import Link from "next/link";
import { EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { useSession } from "@/hooks/useSession";

/**
 * Le garde d'administration **côté client**.
 *
 * Il existe pour un cas précis : quand le serveur ne peut pas vérifier le
 * rôle — aucun backend configuré, ou démonstration forcée dont la session
 * vit dans `localStorage`. Le serveur ne peut alors ni autoriser ni refuser
 * utilement ; il laisse passer, et ce composant tranche sur le profil
 * réellement chargé.
 *
 * Il ne remplace **pas** les gardes serveur : `proxy.ts` et
 * `app/admin/layout.tsx` continuent de vérifier la session et le rôle dès
 * qu'un backend réel est présent. Ce garde est la seconde barrière, pas la
 * première — et il refuse par défaut : profil absent, illisible ou sans
 * `is_admin` donnent le même écran fermé.
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { profile, loading, failed } = useSession();

  if (loading) {
    return (
      <div className="px-(--gutter) py-10">
        <Loading label="Vérification du rôle" />
      </div>
    );
  }

  if (failed || profile?.is_admin !== true) {
    return (
      <main className="flex min-h-[60dvh] flex-col items-center justify-center px-(--gutter) py-10">
        <EmptyState
          icon={<Icon name="lock" size={20} strokeWidth={1.5} />}
          title="Réservé à l’administration"
        />
        <p className="mt-3 max-w-[420px] text-center font-mono text-[11.5px] leading-relaxed text-chalk-4">
          {failed ? (
            "Le profil n’a pas pu être lu. Par précaution, l’accès reste fermé."
          ) : (
            <>
              Ton compte ne porte pas le rôle{" "}
              <code className="text-chalk-2">is_admin</code>.
            </>
          )}
        </p>
        <Link
          href="/profile"
          className="mt-4 inline-flex min-h-[var(--h-tap)] items-center border-b border-signal
            text-[13px] font-semibold text-signal transition-colors
            duration-[var(--d-fast)] hover:text-chalk"
        >
          Retour au profil
        </Link>
      </main>
    );
  }

  return <>{children}</>;
}
