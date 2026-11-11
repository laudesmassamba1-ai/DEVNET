"use client";

import { useCallback, useEffect, useState } from "react";

import { Avatar, EmptyState, Loading, Spinner } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { useToast } from "@/components/Toast";
import { roleLabel } from "@/lib/match";
import {
  decideApplication,
  loadApplicationViews,
  type ProjectApplicationView,
} from "@/lib/reputation";
import { timeAgo } from "@/lib/utils";

/**
 * Les candidatures d'un projet (§6).
 *
 * Le §6 ne s'arrête pas au pourcentage : quelqu'un postule, et quelqu'un
 * décide. Cet écran est ce second versant — une file de décision pour
 * l'équipe, et, pour tout autre, l'état de sa propre candidature.
 *
 * Accepter n'est pas qu'un statut : en base, `applications_accept()`
 * ajoute la personne aux membres et pose une preuve. Le panneau ne
 * simule rien — il écrit le statut, la base fait le reste, et on relit
 * pour montrer l'état réel plutôt que celui qu'on espère.
 */
interface Props {
  projectId: string;
  meId: string;
  /** Propriétaire ou mainteneur : c'est lui qui décide. */
  canDecide: boolean;
}

const STATUS: Record<
  ProjectApplicationView["status"],
  { label: string; className: string }
> = {
  attente: { label: "en attente", className: "border-line-3 text-chalk-3 bg-surface-2" },
  acceptee: { label: "acceptée", className: "border-signal/50 text-signal-d bg-signal/12" },
  refusee: { label: "refusée", className: "border-danger/40 text-danger bg-danger/8" },
  retiree: { label: "retirée", className: "border-line-2 text-chalk-4 bg-surface-2" },
};

export function ApplicationPanel({ projectId, meId, canDecide }: Props) {
  const toast = useToast();
  const [rows, setRows] = useState<ProjectApplicationView[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await loadApplicationViews(projectId));
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const views = await loadApplicationViews(projectId);
      if (alive) setRows(views);
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function decide(id: string, accept: boolean) {
    setBusyId(id);
    const { error } = await decideApplication({ id, accept, deciderId: meId });
    setBusyId(null);

    if (error) {
      toast(error, "err");
      return;
    }

    toast(
      accept
        ? "Candidature acceptée."
        : "Candidature refusée.",
      "ok",
    );
    await load();
  }

  if (rows === null) return <Loading label="Lecture des candidatures" />;

  const pending = rows.filter((r) => r.status === "attente");
  const decided = rows.filter((r) => r.status !== "attente");

  // Sans droit de décision, on ne montre **que sa** candidature : une file
  // de décision n'a rien à faire sous les yeux de ceux qu'on y juge.
  if (!canDecide) {
    const mine = rows.find((r) => r.user_id === meId);

    if (!mine) {
      return (
        <EmptyState
          icon={<Icon name="send" size={20} strokeWidth={1.5} />}
          title="Vous n'avez pas postulé"
          hint="Postulez depuis la liste des projets."
        />
      );
    }

    return (
      <Motion role="rise">
        <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface px-4 py-3.5 shadow-sh-1">
          <div className="flex items-center gap-2">
            <span className={`rounded-[var(--radius-chip)] border px-2 py-0.5 font-mono text-[10.5px] ${STATUS[mine.status].className}`}>
              {STATUS[mine.status].label}
            </span>
            <span className="text-sm text-chalk-3">
              {roleLabel(mine.role)} — envoyée {timeAgo(mine.created_at)}
            </span>
          </div>
          {mine.message && (
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-chalk-2">
              {mine.message}
            </p>
          )}
        </div>
      </Motion>
    );
  }

  return (
    <div className="space-y-4">
      <section>
        <h3 className="label prompt-label mb-2 text-chalk-3">
          à décider {pending.length > 0 && <span className="text-signal-d">({pending.length})</span>}
        </h3>

        {pending.length === 0 && (
          <p className="px-1 font-mono text-[11.5px] text-chalk-4">
            aucune candidature en attente.
          </p>
        )}

        <div className="grid gap-2">
          {pending.map((a, i) => (
            <Motion key={a.id} role="rise" delay={Math.min(i * 40, 240)}>
              <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface px-3.5 py-3 shadow-sh-1">
                <div className="flex items-start gap-3">
                  <Avatar name={a.prenom || a.pseudo} color={a.avatar_color} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-display text-[14px] font-bold text-chalk">
                        {a.prenom || a.pseudo}
                      </span>
                      <span className="font-mono text-[11px] text-chalk-4">@{a.pseudo}</span>
                      <span className="rounded-[var(--radius-chip)] border border-signal/40 bg-signal/10 px-1.5 py-0.5 font-mono text-[10.5px] text-signal-d">
                        {roleLabel(a.role)}
                      </span>
                    </p>
                    {a.message && (
                      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-chalk-2">
                        {a.message}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[10.5px] text-chalk-4">
                      {timeAgo(a.created_at)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide(a.id, false)}
                    disabled={busyId === a.id}
                    className="mo-press inline-flex h-[var(--h-tap)] items-center gap-1.5 rounded-[var(--radius-input)]
                      border border-line-3 px-3 text-[13px] font-bold text-chalk-2
                      transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
                  >
                    <Icon name="close" size={14} strokeWidth={2} />
                    Refuser
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(a.id, true)}
                    disabled={busyId === a.id}
                    className="mo-press inline-flex h-[var(--h-tap)] items-center gap-1.5 rounded-[var(--radius-input)]
                      border border-signal bg-signal px-3.5 text-[13px] font-bold text-void
                      shadow-sh-2 disabled:opacity-40"
                  >
                    {busyId === a.id ? <Spinner /> : <Icon name="check" size={14} strokeWidth={2.4} />}
                    Accepter
                  </button>
                </div>
              </div>
            </Motion>
          ))}
        </div>
      </section>

      {decided.length > 0 && (
        <section>
          <h3 className="label prompt-label mb-2 text-chalk-3">décidées</h3>
          <div className="grid gap-2">
            {decided.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line-2
                  bg-surface-2 px-3.5 py-2.5"
              >
                <Avatar name={a.prenom || a.pseudo} color={a.avatar_color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-chalk-2">
                    {a.prenom || a.pseudo}
                    <span className="ml-2 font-mono text-[11px] font-normal text-chalk-4">
                      {roleLabel(a.role)}
                    </span>
                  </p>
                  <p className="font-mono text-[10.5px] text-chalk-4">
                    {timeAgo(a.created_at)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-[var(--radius-chip)] border px-2 py-0.5 font-mono text-[10.5px] ${STATUS[a.status].className}`}>
                  {STATUS[a.status].label}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
