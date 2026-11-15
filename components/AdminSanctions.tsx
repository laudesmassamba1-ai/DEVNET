"use client";

import { useCallback, useEffect, useState } from "react";
import { Loading } from "@/components/Avatar";
import { useToast } from "@/components/Toast";

/**
 * Sanctions et recours — le geste qui manquait après un signalement.
 *
 * Deux onglets, une règle : une sanction se motive, se date et se lève avec
 * une trace. Un recours est révisé par quelqu'un d'autre que l'auteur de la
 * sanction ; la base le refuse, l'écran ne fait que l'expliquer.
 */

type Kind = "warning" | "restrict" | "suspend" | "ban";

type Sanction = {
  id: string;
  user_id: string;
  pseudo: string | null;
  kind: Kind;
  reason_code: string;
  note: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  issued_by_pseudo: string | null;
  created_at: string;
  pending_appeals: number;
};

type Appeal = {
  id: string;
  sanction_id: string;
  user_id: string;
  pseudo: string | null;
  message: string;
  status: string;
  created_at: string;
  sanction_kind: Kind;
  sanction_reason: string;
  decision_note: string;
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

const KINDS: [Kind, string][] = [
  ["warning", "avertissement"],
  ["restrict", "restriction"],
  ["suspend", "suspension"],
  ["ban", "bannissement"],
];

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `lecture impossible (${response.status})`);
  return payload as T;
}

export function AdminSanctions() {
  const toast = useToast();
  const [tab, setTab] = useState<"sanctions" | "appeals">("sanctions");
  const [sanctions, setSanctions] = useState<Sanction[]>([]);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        readJson<{ sanctions: Sanction[] }>("/api/admin/sanctions?status=active"),
        readJson<{ appeals: Appeal[] }>("/api/admin/appeals?status=pending"),
      ]);
      setSanctions(s.sanctions);
      setAppeals(a.appeals);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "lecture impossible");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial, pas une synchronisation
    void load();
  }, [load]);

  async function act(
    url: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    key: string,
    success: string,
  ) {
    if (busy) return;
    setBusy(key);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "action impossible");
      await load();
      toast(success);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "action impossible", "err");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return <Loading label="Lecture des sanctions" />;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-display-m font-semibold">Sanctions et recours</h2>
          <div className="flex gap-1" role="tablist" aria-label="Vue des sanctions">
            {(["sanctions", "appeals"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-11 rounded-md border px-3 font-mono text-12 uppercase tracking-widest ${
                  tab === key
                    ? "border-signal bg-signal/10 text-signal"
                    : "border-line-3 text-chalk-3"
                }`}
              >
                {key === "sanctions" ? `sanctions (${sanctions.length})` : `recours (${appeals.length})`}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-13 text-danger">
            {error}
          </p>
        )}
        <p className="mt-3 max-w-prose text-12 leading-relaxed text-chalk-4">
          Une sanction produit un effet immédiat : une suspension ou un bannissement
          actif refuse les nouvelles publications. Un recours est révisé par un
          modérateur différent de l&apos;auteur de la sanction — la base l&apos;impose.
        </p>
      </section>

      {tab === "sanctions" && (
        <>
          <section className="px-4 py-5" aria-labelledby="issue-sanction">
            <h3 id="issue-sanction" className="font-display text-15 font-semibold">
              Prononcer une sanction
            </h3>
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const daysRaw = String(form.get("days") ?? "").trim();
                void act(
                  "/api/admin/sanctions",
                  "POST",
                  {
                    action: "issue",
                    userId: String(form.get("userId") ?? "").trim(),
                    kind: String(form.get("kind") ?? "warning"),
                    reasonCode: String(form.get("reasonCode") ?? "other"),
                    days: daysRaw ? Number(daysRaw) : null,
                    note: String(form.get("note") ?? ""),
                  },
                  "issue",
                  "Sanction prononcée",
                );
                event.currentTarget.reset();
              }}
            >
              <label className="min-w-56 flex-1">
                <span className="font-mono text-12 text-chalk-4">identifiant du compte</span>
                <input
                  name="userId"
                  required
                  placeholder="uuid"
                  className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 font-mono text-12 text-chalk"
                />
              </label>
              <label>
                <span className="font-mono text-12 text-chalk-4">type</span>
                <select
                  name="kind"
                  className="mt-1 min-h-11 rounded-md border border-line-3 bg-surface px-2 text-13 text-chalk"
                >
                  {KINDS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="font-mono text-12 text-chalk-4">motif</span>
                <select
                  name="reasonCode"
                  className="mt-1 min-h-11 rounded-md border border-line-3 bg-surface px-2 text-13 text-chalk"
                >
                  {REASONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="w-24">
                <span className="font-mono text-12 text-chalk-4">jours</span>
                <input
                  name="days"
                  type="number"
                  min={1}
                  max={3650}
                  className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-2 text-13 text-chalk"
                />
              </label>
              <label className="min-w-48 flex-1">
                <span className="font-mono text-12 text-chalk-4">note interne</span>
                <input
                  name="note"
                  maxLength={2000}
                  className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 text-13 text-chalk"
                />
              </label>
              <button
                type="submit"
                disabled={busy !== null}
                className="min-h-11 rounded-md border border-danger bg-danger/10 px-3 font-mono text-12 font-bold uppercase tracking-widest text-danger disabled:opacity-40"
              >
                sanctionner
              </button>
            </form>
          </section>

          <section className="px-4 py-5" aria-labelledby="active-sanctions">
            <h3 id="active-sanctions" className="font-display text-15 font-semibold">
              Sanctions actives
            </h3>
            {sanctions.length === 0 ? (
              <p className="mt-2 text-13 text-chalk-4">Aucune sanction active.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
                {sanctions.map((sanction) => (
                  <li key={sanction.id} className="py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-13 font-semibold text-chalk">
                        {sanction.pseudo ?? sanction.user_id.slice(0, 8)} · {sanction.kind}
                      </span>
                      <span className="font-mono text-12 text-chalk-4">
                        {sanction.ends_at
                          ? `jusqu'au ${new Date(sanction.ends_at).toLocaleString("fr-FR")}`
                          : "sans fin"}
                      </span>
                    </div>
                    <p className="mt-1 text-13 text-chalk-3">
                      {REASONS.find(([value]) => value === sanction.reason_code)?.[1] ?? sanction.reason_code}
                      {sanction.pending_appeals > 0 && (
                        <span className="ml-2 font-mono text-12 text-signal">
                          {sanction.pending_appeals} recours en attente
                        </span>
                      )}
                    </p>
                    {sanction.note && <p className="mt-1 text-12 text-chalk-4">{sanction.note}</p>}
                    <div className="mt-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(
                            "/api/admin/sanctions",
                            "POST",
                            { action: "lift", id: sanction.id, note: "levée manuelle" },
                            `lift-${sanction.id}`,
                            "Sanction levée",
                          )
                        }
                        className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-3 disabled:opacity-40"
                      >
                        lever
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === "appeals" && (
        <section className="px-4 py-5" aria-labelledby="pending-appeals">
          <h3 id="pending-appeals" className="font-display text-15 font-semibold">
            Recours en attente
          </h3>
          {appeals.length === 0 ? (
            <p className="mt-2 text-13 text-chalk-4">Aucun recours en attente.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
              {appeals.map((appeal) => (
                <li key={appeal.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-13 font-semibold text-chalk">
                      {appeal.pseudo ?? appeal.user_id.slice(0, 8)} · {appeal.sanction_kind}
                    </span>
                    <span className="font-mono text-12 text-chalk-4">
                      {new Date(appeal.created_at).toLocaleString("fr-FR")}
                    </span>
                  </div>
                  <p className="mt-1 text-13 leading-relaxed text-chalk-2">{appeal.message}</p>
                  <p className="mt-1 font-mono text-12 text-chalk-4">
                    motif d&apos;origine : {appeal.sanction_reason}
                  </p>
                  <form
                    className="mt-2 flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      const note = String(form.get("note") ?? "");
                      const decision = String(form.get("decision") ?? "");
                      if (decision !== "upheld" && decision !== "overturned") return;
                      void act(
                        "/api/admin/appeals",
                        "PATCH",
                        { id: appeal.id, decision, note },
                        `appeal-${appeal.id}`,
                        decision === "overturned" ? "Sanction annulée" : "Décision confirmée",
                      );
                    }}
                  >
                    <label className="min-w-48 flex-1">
                      <span className="font-mono text-12 text-chalk-4">motivation</span>
                      <input
                        name="note"
                        maxLength={2000}
                        className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 text-13 text-chalk"
                      />
                    </label>
                    <button
                      type="submit"
                      name="decision"
                      value="overturned"
                      disabled={busy !== null}
                      className="min-h-11 rounded-md border border-signal bg-signal/10 px-3 font-mono text-12 font-bold uppercase tracking-widest text-signal disabled:opacity-40"
                    >
                      annuler la sanction
                    </button>
                    <button
                      type="submit"
                      name="decision"
                      value="upheld"
                      disabled={busy !== null}
                      className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-2 disabled:opacity-40"
                    >
                      confirmer
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
