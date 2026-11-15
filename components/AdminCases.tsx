"use client";

import { useCallback, useEffect, useState } from "react";
import { Loading } from "@/components/Avatar";
import { useToast } from "@/components/Toast";

/**
 * Dossiers — la décision humaine, pas la machine.
 *
 * La liste montre ce qui reste à traiter, avec les constats de chaque
 * moteur. Le détail ne recopie jamais le contenu : il montre la catégorie,
 * la règle, la version de politique et les preuves conservées. Décider
 * écrit une sanction motivée et une trace d'audit ; supprimer le contenu
 * est une case distincte, jamais automatique.
 */

type Counts = {
  open: number;
  urgent: number;
  unassigned: number;
  actioned: number;
  no_violation: number;
  appeals_pending: number;
  sanctions_active: number;
};

type Overview = {
  policy: {
    version: string;
    active: boolean;
    activated_at: string | null;
    categories: Record<string, unknown>;
    thresholds: Record<string, unknown>;
  };
  counts: Counts;
  triageMinutes: number | null;
  appealRate: number | null;
  reversalRate: number | null;
  engines: {
    engine: string;
    runs: number;
    holds: number;
    failures: number;
    avg_latency_ms: number | null;
  }[];
  recent: CaseRow[];
};

type CaseRow = {
  id: string;
  target_type: string;
  target_id: string;
  content_author_id: string | null;
  author_pseudo: string | null;
  status: string;
  priority: "low" | "normal" | "high" | "urgent";
  policy_version: string;
  assigned_to: string | null;
  assigned_pseudo: string | null;
  summary: string;
  internal_note: string;
  last_decision: string | null;
  created_at: string;
  findings: number;
  reports: number;
};

type Finding = {
  id: string;
  engine: string;
  provider: string;
  category: string;
  score: number;
  severity: string;
  explanation_code: string;
  evidence: Record<string, unknown>;
  latency_ms: number | null;
  created_at: string;
};

type Event = {
  id: string;
  actor_pseudo: string | null;
  event: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
};

type Detail = CaseRow & {
  findings_list: Finding[];
  events: Event[];
  evidence: { id: string; content_table: string; created_at: string }[];
};

const REASONS: [string, string][] = [
  ["harassment", "harcèlement"],
  ["hate", "haine / discrimination"],
  ["threats", "menace / violence"],
  ["sexual", "contenu sexuel"],
  ["minor_safety", "protection des mineurs"],
  ["self_harm", "automutilation"],
  ["spam", "spam"],
  ["scam", "arnaque"],
  ["doxxing", "données personnelles"],
  ["malware_secret", "malware / secret exposé"],
  ["impersonation", "usurpation"],
  ["other", "autre"],
];

const CAPABILITIES: [string, string][] = [
  ["post", "publier"],
  ["comment", "commenter"],
  ["message", "messages"],
  ["story", "stories"],
  ["live", "direct"],
];

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `lecture impossible (${response.status})`);
  return payload as T;
}

export function AdminCases() {
  const toast = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [filter, setFilter] = useState<"open" | "investigating" | "actioned" | "all">("open");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [declared, setDeclared] = useState<string>("warning");

  const load = useCallback(async () => {
    try {
      const [o, l] = await Promise.all([
        readJson<{ overview: Overview }>("/api/admin/cases?view=overview"),
        readJson<{ cases: CaseRow[] }>(`/api/admin/cases?status=${filter}`),
      ]);
      setOverview(o.overview);
      setCases(l.cases);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "lecture impossible");
    } finally {
      setLoaded(true);
    }
  }, [filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial, pas une synchronisation
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>, key: string, success: string) {
    if (!detail || busy) return;
    setBusy(key);
    try {
      const response = await fetch(`/api/admin/cases/${detail.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "action impossible");
      await load();
      const refreshed = await readJson<{ case: Detail }>(`/api/admin/cases/${detail.id}`);
      setDetail(refreshed.case);
      toast(success);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "action impossible", "err");
    } finally {
      setBusy(null);
    }
  }

  async function openCase(id: string) {
    setBusy(`open-${id}`);
    try {
      const payload = await readJson<{ case: Detail }>(`/api/admin/cases/${id}`);
      setDetail(payload.case);
      setDeclared("warning");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "dossier illisible", "err");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return <Loading label="Lecture des dossiers" />;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-4 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-display-m font-semibold">Dossiers de modération</h2>
          <span className="font-mono text-12 text-chalk-4">
            politique {overview?.policy.version ?? "—"}
          </span>
        </div>
        {error && (
          <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-13 text-danger">
            {error}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {overview &&
            (
              [
                ["ouverts", overview.counts.open],
                ["urgents", overview.counts.urgent],
                ["non assignés", overview.counts.unassigned],
                ["recours", overview.counts.appeals_pending],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="rounded-md border border-line-2 bg-surface-2 px-3 py-2">
                <dt className="font-mono text-11 uppercase tracking-widest text-chalk-4">{label}</dt>
                <dd className="mt-0.5 font-display text-xl font-semibold text-chalk">{value}</dd>
              </div>
            ))}
        </dl>

        {overview && Object.keys(overview.policy.categories).length > 0 && (
          <details className="mt-4 border-y border-line-2 py-3">
            <summary className="cursor-pointer font-mono text-12 text-chalk-3">
              politique {overview.policy.version} · {Object.keys(overview.policy.categories).length} catégories
            </summary>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(overview.policy.categories).map(([category, rule]) => {
                const value = rule as { severity?: string; auto?: string };
                return (
                  <div key={category} className="flex items-baseline justify-between gap-2 border-b border-line-2 pb-1.5">
                    <dt className="text-12 text-chalk-2">{category}</dt>
                    <dd className="font-mono text-11 uppercase tracking-widest text-chalk-4">
                      {value.severity ?? "—"} · {value.auto ?? "—"}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-3 font-mono text-11 text-chalk-4">
              seuils : {String((overview.policy.thresholds as { hold_at?: unknown }).hold_at ?? "—")}
              {" · "}suppression auto : non
              {" · "}bannissement auto : non
            </p>
          </details>
        )}

        {overview && overview.engines.length > 0 && (
          <div className="mt-4 overflow-x-auto border-y border-line-2">
            <table className="w-full text-left text-12">
              <caption className="sr-only">Exécutions récentes par moteur</caption>
              <thead className="font-mono text-11 uppercase tracking-widest text-chalk-4">
                <tr>
                  <th className="py-2 pr-3">moteur</th>
                  <th className="py-2 pr-3">exécutions</th>
                  <th className="py-2 pr-3">retenues</th>
                  <th className="py-2 pr-3">échecs</th>
                  <th className="py-2">latence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {overview.engines.map((engine) => (
                  <tr key={engine.engine}>
                    <td className="py-2 pr-3 font-mono text-chalk-2">{engine.engine}</td>
                    <td className="py-2 pr-3 text-chalk-3">{engine.runs}</td>
                    <td className="py-2 pr-3 text-chalk-3">{engine.holds}</td>
                    <td className="py-2 pr-3 text-chalk-3">{engine.failures}</td>
                    <td className="py-2 text-chalk-4">
                      {engine.avg_latency_ms === null ? "—" : `${engine.avg_latency_ms} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-15 font-semibold">File de décision</h3>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtre des dossiers">
            {(["open", "investigating", "actioned", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={`min-h-11 rounded-md border px-3 font-mono text-12 uppercase tracking-widest ${
                  filter === key
                    ? "border-signal bg-signal/10 text-signal"
                    : "border-line-3 text-chalk-3"
                }`}
              >
                {key === "all" ? "tous" : key}
              </button>
            ))}
          </div>
        </div>

        {cases.length === 0 ? (
          <p className="mt-3 text-13 text-chalk-4">Aucun dossier dans ce filtre.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-2 border-y border-line-2">
            {cases.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void openCase(item.id)}
                  className={`flex w-full flex-wrap items-baseline justify-between gap-2 py-3 text-left hover:bg-surface-2 ${
                    detail?.id === item.id ? "bg-surface-2" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="text-13 font-semibold text-chalk">
                      {item.target_type} · {item.author_pseudo ?? "auteur inconnu"}
                    </span>
                    <span className="ml-2 font-mono text-12 text-chalk-4">
                      {item.findings} constat{item.findings > 1 ? "s" : ""}
                      {item.reports > 0 ? ` · ${item.reports} signalement(s)` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`font-mono text-11 uppercase tracking-widest ${
                        item.priority === "urgent" || item.priority === "high"
                          ? "text-danger"
                          : "text-chalk-4"
                      }`}
                    >
                      {item.priority}
                    </span>
                    <span className="font-mono text-12 text-chalk-4">{item.status}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail && (
        <section className="px-4 py-5" aria-labelledby="case-detail">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="case-detail" className="font-display text-15 font-semibold">
              Dossier {detail.id.slice(0, 8)} · {detail.author_pseudo ?? "auteur inconnu"}
            </h3>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-3"
            >
              fermer
            </button>
          </div>

          <p className="mt-2 text-13 leading-relaxed text-chalk-3">
            {detail.summary || "Aucun résumé."} · politique {detail.policy_version} ·{" "}
            {detail.assigned_pseudo ? `assigné à ${detail.assigned_pseudo}` : "non assigné"}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act({ action: "assign", assigneeId: "me" }, "assign", "Dossier assigné")}
              className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-2 disabled:opacity-40"
            >
              m&apos;assigner
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act({ action: "assign", assigneeId: null }, "unassign", "Dossier libéré")}
              className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-3 disabled:opacity-40"
            >
              libérer
            </button>
          </div>

          <div className="mt-4 overflow-x-auto border-y border-line-2">
            <table className="w-full text-left text-12">
              <caption className="sr-only">Constats du dossier</caption>
              <thead className="font-mono text-11 uppercase tracking-widest text-chalk-4">
                <tr>
                  <th className="py-2 pr-3">moteur</th>
                  <th className="py-2 pr-3">catégorie</th>
                  <th className="py-2 pr-3">gravité</th>
                  <th className="py-2 pr-3">score</th>
                  <th className="py-2">règle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {detail.findings_list.map((finding) => (
                  <tr key={finding.id}>
                    <td className="py-2 pr-3 font-mono text-chalk-2">{finding.engine}</td>
                    <td className="py-2 pr-3 text-chalk-3">{finding.category}</td>
                    <td className="py-2 pr-3 text-chalk-3">{finding.severity}</td>
                    <td className="py-2 pr-3 text-chalk-4">{finding.score.toFixed(2)}</td>
                    <td className="py-2 font-mono text-chalk-4">{finding.explanation_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            className="mt-4 grid gap-2 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const decision = String(form.get("decision") ?? "");
              const daysRaw = String(form.get("days") ?? "").trim();
              void act(
                {
                  action: "decide",
                  decision,
                  reasonCode: String(form.get("reasonCode") ?? "other"),
                  note: String(form.get("note") ?? ""),
                  days: daysRaw ? Number(daysRaw) : null,
                  capabilities: form.getAll("capabilities").map(String),
                  removeContent: form.get("removeContent") === "on",
                },
                "decide",
                "Décision enregistrée",
              );
            }}
          >
            <label>
              <span className="font-mono text-12 text-chalk-4">décision</span>
              <select
                name="decision"
                value={declared}
                onChange={(event) => setDeclared(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-2 text-13 text-chalk"
              >
                <option value="no_violation">aucune violation</option>
                <option value="warning">avertissement</option>
                <option value="restrict">restriction</option>
                <option value="suspend">suspension</option>
                <option value="ban">bannissement</option>
              </select>
            </label>
            <label>
              <span className="font-mono text-12 text-chalk-4">motif</span>
              <select
                name="reasonCode"
                className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-2 text-13 text-chalk"
              >
                {REASONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="font-mono text-12 text-chalk-4">durée (jours)</span>
              <input
                name="days"
                type="number"
                min={1}
                max={3650}
                className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-2 text-13 text-chalk"
              />
            </label>
            <label>
              <span className="font-mono text-12 text-chalk-4">note interne</span>
              <input
                name="note"
                maxLength={2000}
                className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 text-13 text-chalk"
              />
            </label>

            {declared === "restrict" && (
              <fieldset className="sm:col-span-2">
                <legend className="font-mono text-12 text-chalk-4">capacités retirées</legend>
                <div className="mt-1 flex flex-wrap gap-3">
                  {CAPABILITIES.map(([value, label]) => (
                    <label key={value} className="flex items-center gap-1 text-13 text-chalk-2">
                      <input type="checkbox" name="capabilities" value={value} className="size-4" />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <label className="flex items-center gap-2 text-13 text-chalk-2 sm:col-span-2">
              <input type="checkbox" name="removeContent" className="size-4" />
              supprimer le contenu (copie de preuve conservée avant effacement)
            </label>

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy !== null}
                className="min-h-11 rounded-md border border-danger bg-danger/10 px-3 font-mono text-12 font-bold uppercase tracking-widest text-danger disabled:opacity-40"
              >
                enregistrer la décision
              </button>
            </div>
          </form>

          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void act(
                { action: "note", note: String(form.get("note") ?? "") },
                "note",
                "Note ajoutée",
              );
              event.currentTarget.reset();
            }}
          >
            <label className="min-w-56 flex-1">
              <span className="font-mono text-12 text-chalk-4">ajouter une note</span>
              <input
                name="note"
                required
                minLength={3}
                maxLength={4000}
                className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 text-13 text-chalk"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== null}
              className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-2 disabled:opacity-40"
            >
              noter
            </button>
          </form>

          {detail.internal_note && (
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap border-l-2 border-line-3 pl-3 text-12 text-chalk-3">
              {detail.internal_note}
            </pre>
          )}

          <ol className="mt-3 space-y-1 font-mono text-11 text-chalk-4">
            {detail.events.map((event) => (
              <li key={event.id}>
                {new Date(event.created_at).toLocaleString("fr-FR")} · {event.event}
                {event.actor_pseudo ? ` · ${event.actor_pseudo}` : ""}
                {event.to_status ? ` → ${event.to_status}` : ""}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
