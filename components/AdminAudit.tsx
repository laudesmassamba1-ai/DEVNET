"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";

type AuditEntry = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
  actor_pseudo: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  "admin.role": "Rôle d’administration modifié",
  "admin.verified": "Vérification modifiée",
  "admin.verification_status": "Statut de vérification modifié",
  "moderation.report": "Signalement classé",
};

async function readAudit(): Promise<AuditEntry[]> {
  const response = await fetch("/api/admin/audit", { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? `lecture impossible (${response.status})`);
  }
  const payload = (await response.json()) as { entries?: AuditEntry[] };
  return payload.entries ?? [];
}

function detail(entry: AuditEntry): string {
  const { before, after } = entry.details;
  if (before !== undefined || after !== undefined) {
    return `${String(before ?? "—")} → ${String(after ?? "—")}`;
  }
  return Object.keys(entry.details).length ? JSON.stringify(entry.details) : "";
}

/** Journal append-only des décisions sensibles. */
export function AdminAudit() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await readAudit());
      setError(null);
    } catch (cause) {
      setEntries(null);
      setError(cause instanceof Error ? cause.message : "journal indisponible");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await readAudit().catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "journal indisponible");
        return null;
      });
      if (alive && next) setEntries(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="px-(--gutter) py-5" aria-labelledby="admin-audit-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="admin-audit-title" className="font-display text-[18px] font-semibold">
            Journal d’audit
          </h2>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-chalk-3">
            Rôles, vérifications et classements de signalements. Le journal ne se modifie pas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-(--h-tap) rounded-(--radius-input) border border-line-2
            px-3 text-12 text-chalk-3 hover:bg-surface-2"
        >
          Actualiser
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 border-l-2 border-danger bg-danger/8 px-3 py-2">
          <p className="text-[13px] text-danger">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-12 font-semibold text-signal">
            Réessayer
          </button>
        </div>
      )}

      {entries === null && !error && <Loading label="Lecture du journal" />}
      {entries !== null && entries.length === 0 && (
        <EmptyState title="Aucune décision enregistrée" />
      )}

      {entries?.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 border-b border-line-1 py-3.5 last:border-b-0">
          <Icon name="file" size={14} className="mt-0.5 text-chalk-4" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-[13px] font-semibold text-chalk">
                {ACTION_LABEL[entry.action] ?? entry.action}
              </span>
              {detail(entry) && (
                <span className="font-mono text-12 text-chalk-3">{detail(entry)}</span>
              )}
            </p>
            <p className="mt-1 font-mono text-[10.5px] text-chalk-4">
              par {entry.actor_pseudo ? `@${entry.actor_pseudo}` : "système"} ·{" "}
              {new Date(entry.created_at).toLocaleString("fr-FR")} · cible{" "}
              {entry.target_type}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}
