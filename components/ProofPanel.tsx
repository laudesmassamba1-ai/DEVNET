"use client";

import { useMemo, useState } from "react";
import { Icon, asIconName } from "./Icon";
import { Loading } from "./Avatar";
import {
  PROOF_KINDS, kindBreakdown, proofStreak, replayAll, reputationByLanguage,
  reputationSummary, reputationWeight, type Proof, type ReplayReport,
} from "@/lib/proofs";
import { todayKey } from "@/lib/gamification";


/**
 * Panneau des preuves — ce qui remplace un « à propos ».
 *
 * ## Ce que l'écran doit démontrer
 *
 * La vision tient en une phrase : « la réputation se prouve par le
 * travail ». Un panneau qui afficherait un chiffre sans dire d'où il
 * vient reproduirait exactement le défaut qu'on prétend corriger — un
 * nombre qu'on doit croire sur parole. On montre donc, dans cet ordre :
 *
 * 1. **le total**, pondéré par la nature des actes ;
 * 2. **la répartition par nature**, qui dit *comment* la réputation s'est
 *    construite (aider vaut plus qu'écrire, écrire vaut plus qu'exécuter) ;
 * 3. **la réputation par langage**, recalculée depuis les preuves ;
 * 4. **le bouton « Rejouer les preuves »**, qui recalcule chaque
 *    empreinte et déclare publiquement combien sont authentiques.
 *
 * Le rejeu est le seul bouton de l'écran. C'est délibéré : c'est le geste
 * qui rend la réputation vérifiable, donc c'est le seul qui mérite d'être
 * mis en avant.
 */

export function ProofPanel({
  proofs,
  loading,
  onReplay,
}: {
  proofs: Proof[] | null;
  loading: boolean;
  /** Recharge depuis la source puis rejoue ; sinon le rejeu est local. */
  onReplay?: () => Promise<ReplayReport>;
}) {
  const [report, setReport] = useState<ReplayReport | null>(null);
  const [replaying, setReplaying] = useState(false);

  const derived = useMemo(() => {
    const list = proofs ?? [];
    return {
      list,
      total: reputationWeight(list),
      kinds: kindBreakdown(list),
      streak: proofStreak(list, todayKey()),
      latest: list.slice(0, 8),
    };
  }, [proofs]);

  if (loading || proofs === null) return <Loading label="Lecture des preuves" />;

  if (proofs.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line-3 bg-surface-2 p-4">
        <p className="text-[12.5px] leading-snug text-chalk-3">
          Aucune preuve pour l&apos;instant. Une preuve n&apos;est pas une
          déclaration : elle apparaît quand un commit est écrit, un snippet
          exécuté et publié, une correction acceptée, une tâche terminée, ou
          une candidature acceptée.
        </p>
      </div>
    );
  }

  const maxWeight = Math.max(...derived.kinds.map((k) => k.count), 1);

  async function replay() {
    setReplaying(true);
    try {
      setReport(onReplay ? await onReplay() : replayAll(derived.list));
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div className="mo-slide space-y-3">
      {/* ── Le total ── */}
      <section className="relative overflow-hidden rounded-[var(--radius-card)]
        border border-signal/35 bg-surface-2 p-4">
        <div className="adinkra-motif pointer-events-none absolute inset-0 opacity-[0.10]" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="prompt-label mb-2 text-chalk-4">réputation prouvée</div>
            <div className="flex items-baseline gap-2">
              <span className="tnum font-display text-[2.4rem] font-bold leading-none text-signal">
                {derived.total}
              </span>
              <span className="label-micro text-chalk-4">points de preuve</span>
            </div>
            <p className="mt-2 font-mono text-[11.5px] text-chalk-3">
              {derived.list.length} preuve{derived.list.length > 1 ? "s" : ""}
              {" · "}
              {reputationSummary(reputationByLanguage(derived.list))}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="tnum font-display text-[1.5rem] font-bold leading-none text-chalk">
              {derived.streak}
            </div>
            <div className="label-micro mt-1 text-chalk-4">
              jour{derived.streak > 1 ? "s" : ""} d&apos;affilée
            </div>
          </div>
        </div>

        {/* ── Le rejeu ── */}
        <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-line-2/20 pt-3">
          <button
            type="button"
            onClick={replay}
            disabled={replaying}
            className="mo-press inline-flex h-[var(--h-tap)] items-center gap-2
              rounded-[var(--radius-chip)] border border-signal bg-signal px-3
              font-mono text-[11px] font-bold uppercase tracking-[0.12em]
              text-void disabled:opacity-50"
          >
            <Icon name="check-double" size={12} strokeWidth={2} />
            {replaying ? "vérification…" : "rejouer les preuves"}
          </button>

          {report && (
            <p
              role="status"
              className={`font-mono text-[11.5px] leading-snug ${
                report.allVerified ? "text-ok" : "text-danger"
              }`}
            >
              {report.allVerified
                ? `${report.verified}/${report.total} empreintes recalculées à l'identique.`
                : `${report.broken.length} preuve(s) sur ${report.total} ne se recalculent pas.`}
            </p>
          )}
        </div>

        {report && !report.allVerified && (
          <ul className="relative mt-2 space-y-1">
            {report.broken.slice(0, 5).map((p) => (
              <li key={p.id} className="font-mono text-[11px] text-danger">
                {PROOF_KINDS[p.kind].label} · {p.subject}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Par nature ── */}
      <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
        <h3 className="label mb-3 flex items-center gap-1.5 text-chalk-3">
          <Icon name="layers" size={12} strokeWidth={1.8} />
          comment la réputation s&apos;est construite
        </h3>

        <ul className="space-y-2.5">
          {derived.kinds.map(({ kind, count }) => {
            const spec = PROOF_KINDS[kind];
            return (
              <li key={kind}>
                <div className="mb-1 flex items-center gap-2">
                  <Icon
                    name={asIconName(spec.icon, "code")}
                    size={12}
                    strokeWidth={1.8}
                    className="shrink-0 text-chalk-3"
                  />
                  <span className="font-mono text-[11.5px] text-chalk-2">{spec.label}</span>
                  <span className="tnum ml-auto shrink-0 text-[11px] text-chalk-3">
                    {count} × {spec.weight}
                  </span>
                </div>
                <div className="h-[6px] w-full border border-line-2/25 bg-void/10">
                  <div
                    className="h-full bg-signal/70"
                    style={{ width: `${Math.round((count / maxWeight) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10.5px] leading-snug text-chalk-4">{spec.certifies}</p>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Par langage ── */}
      <LanguageCard proofs={derived.list} />

      {/* ── Les dernières ── */}
      <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
        <h3 className="label mb-3 flex items-center gap-1.5 text-chalk-3">
          <Icon name="command" size={12} strokeWidth={1.8} />
          dernières preuves
        </h3>
        <ul className="space-y-2">
          {derived.latest.map((p) => {
            const spec = PROOF_KINDS[p.kind];
            return (
              <li key={p.id} className="flex items-start gap-2">
                <Icon
                  name={asIconName(spec.icon, "code")}
                  size={12}
                  strokeWidth={1.8}
                  className="mt-0.5 shrink-0 text-chalk-4"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11.5px] text-chalk-2">
                    {spec.label}
                    {p.language && <span className="ml-1.5 text-chalk-3">· {p.language}</span>}
                  </p>
                  <p className="truncate text-[11px] text-chalk-4">{p.summary || p.subject}</p>
                </div>
                <span className="tnum shrink-0 font-mono text-[10.5px] text-chalk-4">
                  {p.created_at.slice(0, 10)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Réputation par langage                                              */
/* ------------------------------------------------------------------ */

function LanguageCard({ proofs }: { proofs: Proof[] }) {
  const languages = useMemo(() => reputationByLanguage(proofs), [proofs]);
  if (languages.length === 0) return null;

  const max = Math.max(...languages.map((l) => l.weight), 1);

  return (
    <section className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center gap-1.5 text-chalk-3">
        <Icon name="code" size={12} strokeWidth={1.8} />
        réputation par langage
      </h3>

      <ul className="space-y-2.5">
        {languages.map((l) => (
          <li key={l.language}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11.5px] text-chalk-2">{l.language}</span>
              <span className="tnum label-micro text-chalk-4">
                {l.count} preuve{l.count > 1 ? "s" : ""} · {l.weight} pts
              </span>
            </div>
            <div className="h-[6px] w-full border border-line-2/25 bg-void/10">
              <div
                className="h-full bg-ok/70"
                style={{ width: `${Math.round((l.weight / max) * 100)}%` }}
              />
            </div>
            <p className="mt-1 font-mono text-[10.5px] text-chalk-4">
              {l.kinds.map((k) => `${k.count} ${PROOF_KINDS[k.kind].label.toLowerCase()}`).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
