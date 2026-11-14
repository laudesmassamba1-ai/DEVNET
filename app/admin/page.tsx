"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AdminConsoleNav } from "@/components/AdminConsoleNav";
import { AdminOverview } from "@/components/AdminOverview";
import { AdminAccounts } from "@/components/AdminAccounts";
import { Avatar, EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Motion, Stagger } from "@/components/Motion";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import {
  decideVerification,
  fetchVerificationQueue,
  revokeVerification,
  type VerificationRequest,
} from "@/lib/verification-data";
import { VERIFY_OFFICIAL, verificationErrorMessage } from "@/lib/verification";
import { VerifiedBadge } from "@/components/VerifiedBadge";

/**
 * L'administration — `/admin`.
 *
 * **La seule page qui s'adresse à un rôle de compte.** La migration 037
 * a posé `is_admin` sur `users` : c'est un rôle du *compte* (traiter une
 * demande, porter l'anneau officiel, ouvrir des comptes), pas un rôle de
 * conteneur — la modération de groupe et de communauté reste portée par
 * la ligne d'adhésion, comme avant, et `/moderation` reste
 * l'auto-modération.
 *
 * Deux onglets, un seul rôle :
 *
 *  - **Vérifications** — la file d'attente. La décision s'écrit en une
 *    seule requête : `verified` et `verification_status` bougent
 *    ensemble, sinon il existerait un instant où le compte est vérifié
 *    alors que la file dit encore « attente ». On **relit** ensuite,
 *    plutôt que de corriger l'état à la main — la seule version fiable
 *    d'une ligne est celle que la base renvoie.
 *  - **Comptes** — l'annuaire, le rôle d'administration, et l'ouverture
 *    de comptes (`components/AdminAccounts.tsx`).
 */
export default function AdminPage() {
  const { profile } = useSession();
  const toast = useToast();

  const [tab, setTab] = useState<"overview" | "files" | "comptes">("overview");
  const [rows, setRows] = useState<VerificationRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Relit la file.
   *
   * On relit plutôt que d'insérer la ligne traitée à la main : la file
   * est un `select`, et lui substituer une prédiction locale serait
   * exactement le genre d'écart qui se voit seulement en production.
   */
  const load = useCallback(async () => {
    if (profile?.is_admin !== true) return false;
    try {
      setRows(await fetchVerificationQueue());
      setLoadError(null);
      return true;
    } catch (error) {
      setRows(null);
      setLoadError(verificationErrorMessage(error));
      return false;
    }
  }, [profile]);

  useEffect(() => {
    if (tab !== "files") return;
    void (async () => {
      await load();
    })();
  }, [load, tab]);

  async function decide(row: VerificationRequest, accept: boolean) {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await decideVerification(row.id, accept);
      const refreshed = await load();
      const successMessage = accept ? `${row.prenom} est vérifié` : "Demande refusée";
      toast(
        refreshed ? successMessage : "Décision enregistrée, mais la file ne peut pas être actualisée.",
        refreshed ? "ok" : "err",
      );
    } catch (err) {
      toast(verificationErrorMessage(err), "err");
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(row: VerificationRequest) {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await revokeVerification(row.id);
      const refreshed = await load();
      const successMessage = `Cachet retiré à ${row.prenom}`;
      toast(
        refreshed ? successMessage : "Retrait enregistré, mais la file ne peut pas être actualisée.",
        refreshed ? "ok" : "err",
      );
    } catch (err) {
      toast(verificationErrorMessage(err), "err");
    } finally {
      setBusyId(null);
    }
  }

  const admin = profile?.is_admin === true;

  return (
    <AppShell title="Administration" path="~/admin">
      <AdminConsoleNav active="accounts" />
      <Motion
        role="slide"
        className="border-b-(--bw-heavy) border-line-2 px-(--gutter) py-4"
      >
        <div className="flex items-center gap-2">
          <h1 className="font-display text-[1.35rem] font-bold tracking-[-0.02em] text-chalk">
            Administration
          </h1>
          <VerifiedBadge tier={VERIFY_OFFICIAL} size="inline" />
        </div>

        {/* Les onglets sont des onglets d'éditeur : même géométrie que
            ceux du profil public, pour que l'application n'ait qu'un seul
            geste à apprendre. */}
        <div role="tablist" className="mt-3 flex gap-5">
          {([
            ["overview", "Vue d’ensemble"],
            ["files", "Vérifications"],
            ["comptes", "Comptes"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              id={`admin-tab-${key}`}
              aria-controls="admin-tabpanel"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`tab-underline pb-1.5 font-mono text-[11.5px] font-bold
                uppercase tracking-[0.12em] transition-colors
                duration-(--d-fast) ${
                  tab === key ? "text-chalk" : "text-chalk-4 hover:text-chalk-2"
                }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-chalk-4">
          {tab === "overview"
            ? "Indicateurs agrégés du backend. Les modules non instrumentés restent signalés comme indisponibles."
            : tab === "files"
              ? "Demandes en attente. Un refus ne retire rien ; un retrait de cachet est une sanction et se fait séparément."
              : "Nommer un administrateur, retirer le rôle, ouvrir un compte. Chaque écriture est tranchée par la base, puis relue ici."}
        </p>
      </Motion>

      {/* Le panneau vient **sous** les onglets, jamais au-dessus : rendu
          avant eux, le tableau de bord donnait deux navigations empilées
          et un onglet actif qui ne correspondait à rien de visible. */}
      <div role="tabpanel" id="admin-tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === "overview" && <AdminOverview />}

        <div className="px-(--gutter)">
        {!admin && (
          <div className="py-8">
            <EmptyState title="Réservé à l'administration" />
            <p className="mt-3 text-center font-mono text-[11.5px] text-chalk-4">
              Ton compte ne porte pas le rôle{" "}
              <code className="text-chalk-2">is_admin</code>.{" "}
              <Link href="/profile" className="font-bold text-signal">
                Retour au profil
              </Link>
            </p>
          </div>
        )}

        {admin && tab === "comptes" && <AdminAccounts selfId={profile?.id ?? ""} />}

        {admin && tab === "files" && rows === null && !loadError && (
          <Loading label="Lecture des demandes" />
        )}

        {admin && tab === "files" && loadError && (
          <div role="alert" className="my-5 border-l-2 border-danger bg-danger/8 p-4">
            <p className="text-[13px] text-danger">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 min-h-(--h-tap) rounded-(--radius-input)
                border border-danger px-3 text-[13px] text-danger"
            >
              Réessayer
            </button>
          </div>
        )}

        {admin && tab === "files" && rows !== null && rows.length === 0 && (
          <div className="py-8">
            <EmptyState title="Aucune demande en attente" />
            <p className="mt-3 text-center font-mono text-[11.5px] text-chalk-4">
              Une demande posée depuis{" "}
              <Link href="/profile" className="font-bold text-signal">
                le profil
              </Link>{" "}
              apparaîtra ici.
            </p>
          </div>
        )}

        {admin &&
          tab === "files" &&
          rows !== null &&
          rows.map((r, i) => (
            <Stagger
              key={r.id}
              index={i}
              className="border-b border-line-1 py-4 last:border-b-0"
            >
              <div className="flex items-start gap-3">
                <Avatar name={r.prenom} color={r.avatar_color} size="md" />

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[13.5px] font-bold text-chalk">
                      {r.prenom}
                    </span>
                    <span className="font-mono text-[11px] text-chalk-4">
                      @{r.pseudo}
                    </span>
                    <span className="label-micro text-chalk-4">
                      {r.account_type === "professional" ? "pro" : "étudiant"}
                    </span>
                  </p>

                  {r.verification_note && (
                    <p className="mt-1.5 border-l border-line-2 pl-2.5 text-sm
                      leading-relaxed text-chalk-2">
                      {r.verification_note}
                    </p>
                  )}

                  <p className="mt-1.5 font-mono text-[10.5px] text-chalk-4">
                    membre depuis{" "}
                    {new Date(r.created_at).toLocaleDateString("fr-FR")}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex gap-2 pl-[52px]">
                <button
                  type="button"
                  onClick={() => void decide(r, true)}
                  disabled={busyId === r.id}
                  className="mo-press inline-flex min-h-(--h-tap) flex-1 items-center justify-center
                    gap-1.5 rounded-(--radius-chip) border border-ok bg-ok/10
                    font-mono text-[11px] font-bold uppercase tracking-[0.1em]
                    text-ok disabled:opacity-40"
                >
                  <Icon name="check" size={12} strokeWidth={2.4} />
                  accepter
                </button>

                <button
                  type="button"
                  onClick={() => void decide(r, false)}
                  disabled={busyId === r.id}
                  className="mo-press inline-flex min-h-(--h-tap) flex-1 items-center justify-center
                    gap-1.5 rounded-(--radius-chip) border border-line-3
                    font-mono text-[11px] font-bold uppercase tracking-[0.1em]
                    text-chalk-3 disabled:opacity-40"
                >
                  <Icon name="close" size={12} strokeWidth={2.4} />
                  refuser
                </button>
              </div>

              {/* Un cachet déjà posé ne se « dé-refuse » pas : le retrait
                  est une sanction, donc un geste distinct, à part — il ne
                  se déclenche jamais à côté d'un refus. */}
              {r.verified && (
                <div className="mt-2 pl-[52px]">
                  <button
                    type="button"
                    onClick={() => void revoke(r)}
                    disabled={busyId === r.id}
                    className="mo-press inline-flex min-h-(--h-tap) items-center justify-center
                      gap-1.5 rounded-(--radius-chip) border border-danger bg-danger/8
                      font-mono text-[11px] font-bold uppercase tracking-[0.1em]
                      text-danger disabled:opacity-40"
                  >
                    <Icon name="lock" size={12} strokeWidth={2.4} />
                    retirer le cachet
                  </button>
                </div>
              )}
            </Stagger>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
