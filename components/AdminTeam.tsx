"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Avatar, EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Stagger } from "@/components/Motion";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { fetchAccounts, type AdminAccount } from "@/lib/admin-accounts";
import { VERIFY_OFFICIAL } from "@/lib/verification";

/**
 * L'équipe d'administration — `/admin/team`.
 *
 * Ce module était marqué « à instrumenter » au motif que le modèle ne
 * connaît que `is_admin`. C'est vrai, et c'est précisément ce que cette
 * page peut montrer : **qui porte réellement ce rôle**, lu depuis la même
 * source que l'annuaire, sans inventer de rôles granulaires.
 *
 * Trois choix, tous pour éviter une surface qui mentirait :
 *
 *  - **Aucune écriture ici.** Promouvoir ou retirer un rôle reste dans
 *    l'onglet Comptes, où le geste est accompagné de sa confirmation et de
 *    sa relecture. Une liste qui modifierait des droits au passage serait
 *    un piège à un clic.
 *  - **Pas d'adresse email.** Membres et rôles suffisent à cette page ;
 *    l'annuaire masque déjà les emails faute d'audit de révélation, et une
 *    seconde surface ne doit pas rouvrir cette porte.
 *  - **`created_at` est la date de création du compte**, pas celle de la
 *    promotion — aucune table ne conserve cette dernière. L'écran écrit
 *    donc « membre depuis », jamais « administrateur depuis ».
 */
export function AdminTeam() {
  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await fetchAccounts("");
      setAdmins(page.accounts.filter((account) => account.is_admin));
      setCapped(page.capped);
      setError(null);
    } catch (err) {
      setAdmins(null);
      setError(
        err instanceof Error ? err.message : "Lecture de l'équipe impossible.",
      );
    }
  }, []);

  useEffect(() => {
    // L'écriture d'état arrive **après** l'attente du réseau, jamais dans
    // le corps de l'effet : on enveloppe donc l'appel dans une coroutine
    // et on ignore le résultat si le composant a été démonté entre-temps.
    let alive = true;
    void (async () => {
      await load();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  return (
    <section className="px-(--gutter) py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[18px] font-semibold tracking-[-0.02em]">
          Équipe d’administration
        </h2>
        {admins !== null && (
          <p className="font-mono text-12 text-chalk-4 tnum">
            {admins.length} compte{admins.length > 1 ? "s" : ""} avec le rôle
          </p>
        )}
      </div>

      <p className="mt-2 max-w-prose text-13 leading-relaxed text-chalk-3">
        Le modèle ne connaît aujourd’hui qu’un seul rôle,{" "}
        <code className="text-chalk-2">is_admin</code>. Les rôles granulaires
        (sécurité, analyste, approbation à deux) n’existent pas encore : cette
        page liste donc des personnes, pas des permissions.
      </p>

      {capped && (
        <p className="mt-2 font-mono text-12 text-chalk-4">
          Liste plafonnée à 300 comptes lus : le total peut être plus élevé.
        </p>
      )}

      {error && (
        <div role="alert" className="mt-4 border-l-2 border-danger bg-danger/8 p-4">
          <p className="text-13 text-danger">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex min-h-(--h-tap) items-center rounded-(--radius-input)
              border border-danger px-3 text-13 text-danger"
          >
            Réessayer
          </button>
        </div>
      )}

      {!error && admins === null && <Loading label="Lecture de l’équipe" />}

      {!error && admins !== null && admins.length === 0 && (
        <div className="py-6">
          <EmptyState
            icon={<Icon name="groups" size={20} strokeWidth={1.5} />}
            title="Aucun administrateur"
          />
          <p className="mt-3 text-center font-mono text-12 text-chalk-4">
            Le rôle s’attribue depuis{" "}
            <Link href="/admin" className="font-bold text-signal">
              l’onglet Comptes
            </Link>
            .
          </p>
        </div>
      )}

      {!error &&
        admins?.map((account, index) => (
          <Stagger
            key={account.id}
            index={index}
            className="flex items-center gap-3 border-b border-line py-3.5 last:border-b-0"
          >
            <Avatar
              name={account.prenom}
              color={account.avatar_color}
              size="md"
            />

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-13 font-bold text-chalk">
                  {account.prenom}
                </span>
                {account.verified && (
                  <VerifiedBadge tier={VERIFY_OFFICIAL} size="inline" />
                )}
                <span className="font-mono text-12 text-chalk-4">
                  @{account.pseudo}
                </span>
              </p>
              <p className="mt-0.5 font-mono text-12 text-chalk-4">
                {account.account_type === "professional" ? "professionnel" : "étudiant"}
                {" · membre depuis "}
                {new Date(account.created_at).toLocaleDateString("fr-FR")}
              </p>
            </div>

            <span className="label-micro rounded-(--radius-chip) border border-line-3 px-2 py-1 text-chalk-3">
              admin
            </span>
          </Stagger>
        ))}
    </section>
  );
}
