"use client";

import { useEffect, useState } from "react";
import { Loading } from "@/components/Avatar";
import { useToast } from "@/components/Toast";
import type {
  Policy,
  PolicyCategoryRule,
  TrustSeverity,
} from "@/lib/trust-safety/policy";

/**
 * Éditeur de politique.
 *
 * La console de dossiers lisait déjà la politique active ; elle ne pouvait
 * pas la faire évoluer sans une migration. Corriger un seuil ou une
 * catégorie demandait alors un déploiement, ce qui rendait la modération
 * dépendante du cycle de livraison.
 *
 * Trois limites restent visibles à l'écran :
 *  - publier crée une nouvelle version, l'ancienne reste relisible ;
 *  - `autoRemove` et `autoBan` ne sont pas éditables ;
 *  - seuls les rôles owner/admin publient, les autres lisent.
 */

type VersionRow = {
  version: string;
  active: boolean;
  notes: string;
  created_at: string;
  activated_at: string | null;
};

type Payload = {
  active: Policy | null;
  versions: VersionRow[];
  error?: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  insult: "Insulte",
  hate: "Haine",
  sexual: "Contenu sexuel",
  violence: "Violence",
  threat: "Menace",
  self_harm: "Automutilation",
  scam: "Arnaque",
  spam: "Spam",
  minor_safety: "Sécurité des mineurs",
  secret: "Secret exposé",
  malware: "Malware",
  doxxing: "Doxxing",
  impersonation: "Usurpation",
  other: "Autre",
};

const AUTO_LABEL: Record<PolicyCategoryRule["auto"], string> = {
  block: "Refuser avant publication",
  hold: "Retenir, dossier ouvert",
  review: "Publier, dossier ouvert",
  allow: "Laisser passer sans dossier",
};

const SEVERITIES: TrustSeverity[] = ["info", "warning", "critical"];
const AUTOS: PolicyCategoryRule["auto"][] = ["allow", "review", "hold", "block"];

function emptyDraft(): Policy {
  return {
    version: "",
    categories: {},
    thresholds: {
      holdAt: 0.85,
      reviewAt: 0.45,
      escalateReports: 3,
      autoRemove: false,
      autoBan: false,
    },
  };
}

async function readPolicy(): Promise<Payload> {
  const response = await fetch("/api/admin/policy", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as Payload | null;
  if (!response.ok) throw new Error(payload?.error ?? `lecture impossible (${response.status})`);
  return payload ?? { active: null, versions: [] };
}

export function AdminPolicy() {
  const toast = useToast();
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const payload = await readPolicy().catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "lecture impossible");
        return null;
      });
      if (!alive || !payload) return;
      setVersions(payload.versions);
      const base = payload.active ?? emptyDraft();
      setDraft({
        ...base,
        categories: { ...base.categories },
        thresholds: { ...base.thresholds },
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  function setRule(category: string, patch: Partial<PolicyCategoryRule>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            categories: {
              ...current.categories,
              [category]: { ...current.categories[category], ...patch },
            },
          }
        : current,
    );
  }

  function setThreshold(key: "holdAt" | "reviewAt" | "escalateReports", value: number) {
    setDraft((current) =>
      current ? { ...current, thresholds: { ...current.thresholds, [key]: value } } : current,
    );
  }

  async function publish() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: draft.version.trim(),
          categories: draft.categories,
          thresholds: {
            hold_at: draft.thresholds.holdAt,
            review_at: draft.thresholds.reviewAt,
            escalate_reports: draft.thresholds.escalateReports,
          },
          notes,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; policy?: Policy; audit?: { ok?: boolean } }
        | null;
      if (!response.ok) throw new Error(payload?.error ?? "publication impossible");
      const refreshed = await readPolicy().catch(() => null);
      if (refreshed) {
        setVersions(refreshed.versions);
        if (refreshed.active) {
          setDraft({
            ...refreshed.active,
            categories: { ...refreshed.active.categories },
            thresholds: { ...refreshed.active.thresholds },
          });
        }
      }
      setNotes("");
      toast(
        payload?.audit?.ok === false
          ? "Politique publiée, mais le journal n'a pas pu être écrit."
          : `Politique ${payload?.policy?.version ?? draft.version} publiée`,
        payload?.audit?.ok === false ? "err" : "ok",
      );
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "publication impossible", "err");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <section className="px-4 py-6">
        <p className="font-mono text-13 text-danger">{error}</p>
      </section>
    );
  }
  if (!draft) return <Loading label="Lecture de la politique" />;

  const activeVersion = versions.find((row) => row.active)?.version ?? draft.version;
  const canPublish =
    draft.version.trim().length > 0
    && /^\d{4}\.\d{1,2}\.\d{1,2}$/.test(draft.version.trim())
    && draft.thresholds.reviewAt < draft.thresholds.holdAt
    && draft.version !== activeVersion;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-4 py-5" aria-labelledby="policy-active">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="policy-active" className="font-display text-display-m font-semibold">
            Politique active
          </h2>
          <span className="font-mono text-12 text-chalk-4">{activeVersion || "aucune"}</span>
        </div>
        <p className="mt-2 max-w-prose text-13 leading-relaxed text-chalk-3">
          Une décision machine peut refuser une publication ou ouvrir un dossier.
          Elle ne supprime jamais un contenu et ne bannit jamais un compte :
          <strong className="text-chalk"> autoRemove et autoBan restent faux</strong>,
          même si une requête tente de les activer.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="font-mono text-12 text-chalk-4">Nouvelle version</span>
            <input
              value={draft.version}
              onChange={(event) =>
                setDraft({ ...draft, version: event.target.value.slice(0, 40) })
              }
              placeholder="2026.11.2"
              className="mt-1 min-h-11 w-full rounded-md border border-line-2 bg-surface px-3 text-14 text-chalk"
            />
          </label>
          <label className="block">
            <span className="font-mono text-12 text-chalk-4">Seuil de retenue (0..1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft.thresholds.holdAt}
              onChange={(event) => setThreshold("holdAt", Number(event.target.value))}
              className="mt-1 min-h-11 w-full rounded-md border border-line-2 bg-surface px-3 text-14 text-chalk"
            />
          </label>
          <label className="block">
            <span className="font-mono text-12 text-chalk-4">Seuil de revue (0..1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft.thresholds.reviewAt}
              onChange={(event) => setThreshold("reviewAt", Number(event.target.value))}
              className="mt-1 min-h-11 w-full rounded-md border border-line-2 bg-surface px-3 text-14 text-chalk"
            />
          </label>
          <label className="block">
            <span className="font-mono text-12 text-chalk-4">Signalements avant retenue</span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={draft.thresholds.escalateReports}
              onChange={(event) => setThreshold("escalateReports", Number(event.target.value))}
              className="mt-1 min-h-11 w-full rounded-md border border-line-2 bg-surface px-3 text-14 text-chalk"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="font-mono text-12 text-chalk-4">Note de version</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value.slice(0, 4_000))}
              placeholder="Pourquoi ce changement"
              className="mt-1 min-h-11 w-full rounded-md border border-line-2 bg-surface px-3 text-14 text-chalk"
            />
          </label>
        </div>

        {draft.thresholds.reviewAt >= draft.thresholds.holdAt && (
          <p role="alert" className="mt-3 font-mono text-12 text-danger">
            Le seuil de revue doit rester strictement inférieur au seuil de retenue.
          </p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-13">
            <caption className="sr-only">Catégories de la politique</caption>
            <thead>
              <tr className="border-b border-line-2 font-mono text-12 text-chalk-4">
                <th scope="col" className="py-2 pr-3 font-normal">Catégorie</th>
                <th scope="col" className="py-2 pr-3 font-normal">Gravité</th>
                <th scope="col" className="py-2 font-normal">Décision automatique</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(draft.categories).map(([category, rule]) => (
                <tr key={category} className="border-b border-line-1 align-middle">
                  <th scope="row" className="py-2 pr-3 font-medium text-chalk">
                    {CATEGORY_LABEL[category] ?? category}
                  </th>
                  <td className="py-2 pr-3">
                    <select
                      aria-label={`Gravité ${CATEGORY_LABEL[category] ?? category}`}
                      value={rule.severity}
                      onChange={(event) =>
                        setRule(category, { severity: event.target.value as TrustSeverity })
                      }
                      className="min-h-11 w-full rounded-md border border-line-2 bg-surface px-2 text-13 text-chalk"
                    >
                      {SEVERITIES.map((severity) => (
                        <option key={severity} value={severity}>{severity}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    <select
                      aria-label={`Décision ${CATEGORY_LABEL[category] ?? category}`}
                      value={rule.auto}
                      onChange={(event) =>
                        setRule(category, {
                          auto: event.target.value as PolicyCategoryRule["auto"],
                        })
                      }
                      className="min-h-11 w-full rounded-md border border-line-2 bg-surface px-2 text-13 text-chalk"
                    >
                      {AUTOS.map((auto) => (
                        <option key={auto} value={auto}>{AUTO_LABEL[auto]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void publish()}
            disabled={!canPublish || busy}
            className="min-h-11 rounded-md border border-signal bg-signal/10 px-4
              font-mono text-12 font-bold uppercase tracking-[0.12em] text-signal
              disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Publication…" : "Publier cette version"}
          </button>
          <p className="font-mono text-12 text-chalk-4">
            Les autres rôles lisent sans publier. Chaque publication est journalisée.
          </p>
        </div>
      </section>

      <section className="px-4 py-5" aria-labelledby="policy-history">
        <h2 id="policy-history" className="font-display text-display-m font-semibold">
          Versions
        </h2>
        <ul className="mt-3 divide-y divide-line-1">
          {versions.map((row) => (
            <li key={row.version} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
              <div>
                <p className="font-mono text-13 text-chalk">
                  {row.version}
                  {row.active && <span className="ml-2 text-signal">active</span>}
                </p>
                {row.notes && <p className="mt-1 text-13 leading-relaxed text-chalk-3">{row.notes}</p>}
              </div>
              <p className="font-mono text-12 text-chalk-4">
                {new Date(row.activated_at ?? row.created_at).toLocaleDateString("fr-FR")}
              </p>
            </li>
          ))}
          {versions.length === 0 && (
            <li className="py-3 font-mono text-13 text-chalk-4">Aucune version enregistrée.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
