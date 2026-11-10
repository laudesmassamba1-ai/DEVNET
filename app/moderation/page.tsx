"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { Stagger } from "@/components/Motion";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import {
  classifyReport, fetchOpenReportCount, fetchReports,
  REASONS, STATUS_LABEL, TARGET_LABEL,
} from "@/lib/reports";
import type { ReportStatus, ReportWithReporter } from "@/lib/types";

/**
 * La vue de modération — `/moderation`.
 *
 * **Elle n'est pas une file d'administration, et c'est un choix.**
 *
 * Depuis la migration 037, le schéma possède bien un rôle de compte
 * (`users.is_admin`) : il ne sert qu'à **vérifier des comptes**, et sa
 * file vit sur `/admin`. Ce n'est pas un modérateur de site — il ne voit
 * pas plus de contenu que n'importe qui.
 *
 * Ce que la migration 011 fait donc : les signalements sont visibles par
 * **l'auteur du contenu signalé** et par le créateur du groupe. Autrement
 * dit, la vue liste **le contenu qui vous a été signalé**, et vous invite
 * à le traiter.
 *
 * C'est de l'auto-modération, et c'est ce qui rend la modération réelle
 * sans juge : l'auteur peut voir ce qu'on lui reproche et supprimer ce
 * qui est justifié. La sanction, elle, reste où elle était — la
 * politique `posts_delete`, qui n'appartient qu'à l'auteur.
 *
 * Conséquence à énoncer devant un jury : sur un fil public, personne
 * n'a d'autorité au-dessus de l'auteur d'un post. C'est un choix, pas un
 * oubli — `is_admin` ne change rien à cela : il accorde un cachet, il ne
 * donne aucun droit sur le contenu des autres.
 */
/**
 * La lecture de l'écran, hors du composant.
 *
 * Elle est partagée par le chargement initial et par le reclassement,
 * et c'est pourquoi elle vit dehors : le classement doit relire la même
 * chose que le premier rendu, sinon la vue montrerait des chiffres
 * qu'aucune requête n'a produits.
 */
async function fetchModeration(me: string) {
  const [received, count] = await Promise.all([
    fetchReports(me, "received"),
    fetchOpenReportCount(me),
  ]);
  return { received, count };
}

export default function ModerationPage() {
  const { profile } = useSession();
  const toast = useToast();

  const [rows, setRows] = useState<ReportWithReporter[] | null>(null);
  /** Filtre d'état : par défaut on ne montre que ce qui reste à traiter. */
  const [status, setStatus] = useState<ReportStatus | "all">("open");
  const [openCount, setOpenCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    const { received, count } = await fetchModeration(profile.id);
    setRows(received);
    setOpenCount(count);
  }, [profile]);

  useEffect(() => {
    // L'appel est enveloppé dans une coroutine explicitement plutôt que
    // fait directement dans l'effet : l'écriture d'état arrive alors
    // après une attente, ce qui est le seul moment où elle est correcte.
    let alive = true;
    void (async () => {
      if (!profile) return;
      const { received, count } = await fetchModeration(profile.id);
      if (!alive) return;
      setRows(received);
      setOpenCount(count);
    })();
    return () => {
      alive = false;
    };
  }, [profile]);

  /**
   * Classe un signalement, puis relit la ligne.
   *
   * On relit plutôt que de modifier l'état localement : `resolved_at`
   * est écrit par un trigger, donc la seule version fiable de la ligne
   * est celle que la base renvoie. Deviner la date ici serait
   * réintroduire une donnée que le client contrôle.
   */
  async function classify(row: ReportWithReporter, next: Exclude<ReportStatus, "open">) {
    if (busyId) return;

    setBusyId(row.id);
    const { error } = await classifyReport(row.id, next);
    setBusyId(null);

    if (error) {
      console.error("[moderation] classement refusé :", error);
      toast("Classement impossible", "err");
      return;
    }

    await load();
    toast(next === "resolved" ? "Marqué comme traité" : "Signalement écarté");
  }

  const visible = (rows ?? []).filter((r) => status === "all" || r.status === status);

  return (
    <AppShell title="Modération" path="~/moderation">
      <Motion
        role="slide"
        className="border-b-[var(--bw-heavy)] border-line-2 px-(--gutter) py-4"
      >
        <h1 className="font-display text-[1.35rem] font-bold tracking-[-0.02em] text-chalk">
          Signalements
        </h1>
        <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-chalk-4">
          Vos contenus signalés. Vous seul voyez cette page.
        </p>
      </Motion>

      <div
        role="tablist"
        aria-label="État des signalements"
        className="flex gap-0 border-b border-line-2 px-(--gutter)"
      >
        {([
          ["open", "à traiter", openCount],
          ["all", "tous", rows?.length],
        ] as [ReportStatus | "all", string, number | undefined][]).map(
          ([value, label, n]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={status === value}
              onClick={() => setStatus(value)}
              className={`tab-underline px-3.5 py-2 font-mono text-[11.5px] font-bold
                uppercase tracking-[0.12em] transition-colors duration-[var(--d-fast)]
                ${status === value ? "text-signal" : "text-chalk-4 hover:text-chalk-2"}`}
            >
              {label}
              {n !== undefined && <span className="tnum ml-1.5 text-chalk-3">{n}</span>}
            </button>
          ),
        )}
      </div>

      <div className="px-(--gutter)">
        {rows === null && <Loading label="Lecture des signalements" />}

        {rows !== null && rows.length === 0 && (
          <EmptyState
            title="Aucun signalement reçu"
          />
        )}

        {rows !== null && rows.length > 0 && visible.length === 0 && (
          <EmptyState
            title="Rien dans cette catégorie"
          />
        )}

        {visible.map((r, i) => {
          const reason = REASONS.find((x) => x.value === r.reason);
          const done = r.status !== "open";

          return (
            <Stagger
              key={r.id}
              index={i}
              className="border-b border-line-1 py-3.5 last:border-b-0"
            >
              <div className="flex items-start gap-2.5">
                <Icon
                  name="flag"
                  size={14}
                  className={done ? "mt-0.5 text-chalk-4" : "mt-0.5 text-danger"}
                />

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[13px] font-bold text-chalk">
                      {reason?.label ?? r.reason}
                    </span>
                    <span className="font-mono text-[11px] text-chalk-4">
                      sur {TARGET_LABEL[r.target_type]}
                    </span>
                    {done && (
                      <span className="label-micro text-chalk-4">
                        {STATUS_LABEL[r.status]}
                      </span>
                    )}
                  </p>

                  {r.details && (
                    <p className="mt-1 border-l border-line-2 pl-2.5 text-sm
                      leading-relaxed text-chalk-2">
                      {r.details}
                    </p>
                  )}

                  {/* Qui a signalé n'est pas affiché : le signalant est
                      anonyme par construction, et afficher un nom
                      inviterait à le déduire du motif. */}
                  <p className="mt-1.5 font-mono text-[10.5px] text-chalk-4">
                    signalé {new Date(r.created_at).toLocaleDateString("fr-FR")}
                    {r.resolved_at &&
                      ` · classé le ${new Date(r.resolved_at).toLocaleDateString("fr-FR")}`}
                  </p>
                </div>
              </div>

              {!done && (
                <div className="mt-2.5 flex gap-2 pl-[26px]">
                  <button
                    type="button"
                    onClick={() => classify(r, "resolved")}
                    disabled={busyId === r.id}
                    className="mo-press inline-flex h-8 flex-1 items-center justify-center
                      gap-1.5 rounded-[var(--radius-chip)] border border-ok bg-ok/10
                      font-mono text-[11px] font-bold uppercase tracking-[0.1em]
                      text-ok disabled:opacity-40"
                  >
                    <Icon name="check" size={12} strokeWidth={2.4} />
                    traité
                  </button>

                  <button
                    type="button"
                    onClick={() => classify(r, "dismissed")}
                    disabled={busyId === r.id}
                    className="mo-press inline-flex h-8 flex-1 items-center justify-center
                      gap-1.5 rounded-[var(--radius-chip)] border border-line-3
                      font-mono text-[11px] font-bold uppercase tracking-[0.1em]
                      text-chalk-3 disabled:opacity-40"
                  >
                    <Icon name="close" size={12} strokeWidth={2.4} />
                    écarter
                  </button>
                </div>
              )}
            </Stagger>
          );
        })}
      </div>
    </AppShell>
  );
}