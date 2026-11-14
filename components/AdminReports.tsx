"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Stagger } from "@/components/Motion";
import { useToast } from "@/components/Toast";
import { REASONS, STATUS_LABEL, TARGET_LABEL } from "@/lib/reports";
import type { ReportReason, ReportStatus, ReportTarget } from "@/lib/types";

type AdminReport = {
  id: string;
  target_type: ReportTarget;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
  reporter_pseudo: string;
  target_preview: string;
  target_user_pseudo: string | null;
};

async function readReports(): Promise<AdminReport[]> {
  const response = await fetch("/api/admin/reports", { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? `lecture impossible (${response.status})`);
  }
  const payload = (await response.json()) as { reports?: AdminReport[] };
  return payload.reports ?? [];
}

/** File globale des signalements — la modération que `/moderation` ne peut pas voir. */
export function AdminReports() {
  const toast = useToast();
  const [rows, setRows] = useState<AdminReport[] | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await readReports());
      setError(null);
    } catch (cause) {
      setRows(null);
      setError(cause instanceof Error ? cause.message : "lecture impossible");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await readReports().catch((cause: unknown) => {
        if (!alive) return null;
        setError(cause instanceof Error ? cause.message : "lecture impossible");
        return null;
      });
      if (alive && next) setRows(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function classify(row: AdminReport, status: "resolved" | "dismissed") {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const response = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, status }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "classement impossible");
      }
      await load();
      toast(status === "resolved" ? "Signalement traité" : "Signalement écarté");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "classement impossible", "err");
    } finally {
      setBusyId(null);
    }
  }

  const visible = (rows ?? []).filter(
    (row) => filter === "all" || row.status === "open",
  );
  const openCount = (rows ?? []).filter((row) => row.status === "open").length;

  return (
    <section className="px-(--gutter) py-5" aria-labelledby="admin-reports-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="admin-reports-title" className="font-display text-[18px] font-semibold">
            Signalements du réseau
          </h2>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            Toutes les cibles, tous les auteurs. Le signalant reste anonyme.
          </p>
        </div>
        <span className="font-mono text-12 text-chalk-4 tnum">
          {openCount} ouvert{openCount > 1 ? "s" : ""}
        </span>
      </div>

      <div role="tablist" aria-label="Filtre des signalements" className="mt-4 flex gap-0 border-b border-line-2">
        {([
          ["open", "à traiter"],
          ["all", "tous"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`tab-underline px-3.5 py-2 font-mono text-12 font-bold uppercase
              tracking-[0.12em] transition-colors ${
                filter === value ? "text-signal" : "text-chalk-4 hover:text-chalk-2"
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mt-4 border-l-2 border-danger bg-danger/8 px-3 py-2">
          <p className="text-13 text-danger">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-12 font-semibold text-signal">
            Réessayer
          </button>
        </div>
      )}

      {rows === null && !error && <Loading label="Lecture des signalements" />}

      {rows !== null && visible.length === 0 && (
        <EmptyState title={filter === "open" ? "Aucun signalement à traiter" : "Aucun signalement"} />
      )}

      {visible.map((row, index) => {
        const reason = REASONS.find((item) => item.value === row.reason);
        const open = row.status === "open";
        return (
          <Stagger
            key={row.id}
            index={index}
            className="border-b border-line-1 py-4 last:border-b-0"
          >
            <div className="flex items-start gap-2.5">
              <Icon
                name="flag"
                size={14}
                className={open ? "mt-0.5 text-danger" : "mt-0.5 text-chalk-4"}
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-13 font-bold text-chalk">
                    {reason?.label ?? row.reason}
                  </span>
                  <span className="font-mono text-12 text-chalk-4">
                    sur {TARGET_LABEL[row.target_type] ?? row.target_type}
                  </span>
                  <span className="label-micro text-chalk-4">{STATUS_LABEL[row.status]}</span>
                </p>

                {row.target_preview && (
                  <p className="mt-2 line-clamp-3 border-l border-line-2 pl-2.5 text-13 leading-relaxed text-chalk-2">
                    {row.target_preview}
                  </p>
                )}
                {row.details && (
                  <p className="mt-1.5 text-12 leading-relaxed text-chalk-3">
                    Motif : {row.details}
                  </p>
                )}

                <p className="mt-1.5 font-mono text-12 text-chalk-4">
                  signalé par @{row.reporter_pseudo} ·{" "}
                  {new Date(row.created_at).toLocaleDateString("fr-FR")}
                  {row.target_user_pseudo ? ` · cible @${row.target_user_pseudo}` : ""}
                  {row.resolved_at
                    ? ` · classé le ${new Date(row.resolved_at).toLocaleDateString("fr-FR")}`
                    : ""}
                </p>

                {open && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void classify(row, "resolved")}
                      className="mo-press inline-flex min-h-(--h-tap) flex-1 items-center justify-center
                        gap-1.5 rounded-(--radius-chip) border border-ok bg-ok/10
                        font-mono text-12 font-bold uppercase tracking-[0.1em] text-ok
                        disabled:opacity-40"
                    >
                      <Icon name="check" size={12} strokeWidth={2.4} />
                      traiter
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void classify(row, "dismissed")}
                      className="mo-press inline-flex min-h-(--h-tap) flex-1 items-center justify-center
                        gap-1.5 rounded-(--radius-chip) border border-line-3
                        font-mono text-12 font-bold uppercase tracking-[0.1em] text-chalk-3
                        disabled:opacity-40"
                    >
                      <Icon name="close" size={12} strokeWidth={2.4} />
                      écarter
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Stagger>
        );
      })}
    </section>
  );
}
