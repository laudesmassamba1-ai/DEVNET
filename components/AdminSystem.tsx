"use client";

import { useCallback, useEffect, useState } from "react";
import { Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";

type SystemState = {
  checkedAt: string;
  region: string | null;
  environment: string | null;
  database: {
    configured: boolean;
    ok: boolean;
    latencyMs: number | null;
    reason: string | null;
  };
  counts: Record<string, number>;
  sizeBytes: number | null;
  migration: string | null;
  services: Record<string, boolean>;
};

const SERVICE_LABELS: Record<string, string> = {
  database: "PostgreSQL",
  blob: "Vercel Blob",
  r2: "Cloudflare R2",
  googleLogin: "Connexion Google",
  githubLogin: "Connexion GitHub",
  githubRepos: "Dépôts GitHub",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

async function readSystem(): Promise<SystemState> {
  const response = await fetch("/api/admin/system", { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? `lecture impossible (${response.status})`);
  }
  return (await response.json()) as SystemState;
}

/** État réel de la plateforme : disponibilité, volumes, stockage, services. */
export function AdminSystem() {
  const [data, setData] = useState<SystemState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await readSystem());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "état indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await readSystem().catch((cause: unknown) => {
        if (alive) {
          setError(cause instanceof Error ? cause.message : "état indisponible");
        }
        return null;
      });
      if (!alive) return;
      if (next) setData(next);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="px-(--gutter) py-5" aria-labelledby="admin-system-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="admin-system-title" className="font-display text-[18px] font-semibold">
            État de la plateforme
          </h2>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            Mesures lues à l’instant, sans valeur de démonstration.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-(--h-tap) rounded-(--radius-input) border border-line-2
            px-3 text-12 text-chalk-3 hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? "Actualisation…" : "Actualiser"}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 border-l-2 border-danger bg-danger/8 px-3 py-2">
          <p className="text-13 text-danger">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-12 font-semibold text-signal">
            Réessayer
          </button>
        </div>
      )}

      {!data && loading && <Loading label="Lecture de l’état système" />}

      {data && (
        <>
          <dl className="mt-5 divide-y divide-line-2 border-y border-line-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
              <dt className="text-13 text-chalk-3">Base de données</dt>
              <dd className={`font-mono text-13 font-semibold ${data.database.ok ? "text-ok" : "text-danger"}`}>
                {data.database.ok ? "En ligne" : "Indisponible"}
                {data.database.latencyMs !== null ? ` · ${data.database.latencyMs} ms` : ""}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
              <dt className="text-13 text-chalk-3">Région d’exécution</dt>
              <dd className="font-mono text-12 text-chalk-2">{data.region ?? "locale / inconnue"}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
              <dt className="text-13 text-chalk-3">Taille de la base</dt>
              <dd className="font-mono text-12 text-chalk-2">{formatBytes(data.sizeBytes)}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
              <dt className="text-13 text-chalk-3">Dernière migration</dt>
              <dd className="font-mono text-12 text-chalk-2">{data.migration ?? "inconnue"}</dd>
            </div>
          </dl>

          <h3 className="mt-5 font-display text-15 font-semibold">Volumes</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3 border-y border-line-2 py-4 sm:grid-cols-5">
            {([
              ["Comptes", "users"],
              ["Publications", "posts"],
              ["Projets", "projects"],
              ["Signalements ouverts", "reports_open"],
              ["Sessions actives", "sessions_active"],
            ] as const).map(([label, key]) => (
              <div key={key}>
                <dt className="text-12 text-chalk-4">{label}</dt>
                <dd className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-chalk">
                  {(data.counts[key] ?? 0).toLocaleString("fr-FR")}
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-5 font-display text-15 font-semibold">Services configurés</h3>
          <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
            {Object.entries(data.services).map(([key, enabled]) => (
              <li key={key} className="flex items-center justify-between gap-3 py-3">
                <span className="text-13 text-chalk-3">{SERVICE_LABELS[key] ?? key}</span>
                <span className={`inline-flex items-center gap-1.5 font-mono text-12 font-semibold ${enabled ? "text-ok" : "text-chalk-4"}`}>
                  <Icon name={enabled ? "check" : "close"} size={12} strokeWidth={2.2} />
                  {enabled ? "configuré" : "absent"}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-4 font-mono text-12 text-chalk-4">
            Vérifié le {new Date(data.checkedAt).toLocaleString("fr-FR")}
            {data.environment ? ` · ${data.environment}` : ""}
          </p>
        </>
      )}
    </section>
  );
}
