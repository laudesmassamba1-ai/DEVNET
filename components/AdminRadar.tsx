"use client";

import { useCallback, useEffect, useState } from "react";
import { Loading } from "@/components/Avatar";

type BackendProbe = {
  state: "online" | "offline";
  status?: number;
  reason?: string;
};

async function readBackendProbe(): Promise<BackendProbe> {
  const response = await fetch("/api/backend-check", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`La sonde a répondu ${response.status}.`);
  }

  const result = (await response.json()) as BackendProbe;
  if (result.state !== "online" && result.state !== "offline") {
    throw new Error("La réponse de la sonde est illisible.");
  }
  return result;
}

export function AdminRadar() {
  const [probe, setProbe] = useState<BackendProbe | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await readBackendProbe();
      setProbe(result);
      setCheckedAt(new Date());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La sonde est indisponible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await readBackendProbe();
        if (!active) return;
        setProbe(result);
        setCheckedAt(new Date());
        setError(null);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "La sonde est indisponible.");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (loading && !probe) return <Loading label="Lecture de l'état du backend" />;

  return (
    <section className="px-(--gutter) py-5" aria-labelledby="admin-radar-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="admin-radar-title"
            className="font-display text-[18px] font-semibold tracking-[-0.02em]"
          >
            Disponibilité du backend
          </h2>
          <p className="mt-1 text-13 text-chalk-3">
            Une sonde réelle, sans métriques simulées.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="min-h-(--h-tap) rounded-(--radius-input)
            border border-line-2 px-3 text-13 text-chalk
            hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? "Actualisation…" : "Actualiser"}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 border-l-2 border-danger bg-danger/8 px-3 py-2
            text-13 text-danger"
        >
          {probe
            ? `Donnée périmée : l'actualisation a échoué. ${error}`
            : `État indisponible : ${error}`}
        </p>
      )}

      {probe && (
        <dl className="mt-5 divide-y divide-line-2 border-y border-line-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
            <dt className="text-13 text-chalk-3">Backend PostgREST</dt>
            <dd
              className={`font-mono text-13 font-semibold ${
                probe.state === "online" ? "text-ok" : "text-danger"
              }`}
            >
              {probe.state === "online" ? "En ligne" : "Hors ligne"}
              {probe.status ? ` · HTTP ${probe.status}` : ""}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
            <dt className="text-13 text-chalk-3">Dernier contrôle</dt>
            <dd className="font-mono text-12 text-chalk-4">
              {checkedAt?.toLocaleString("fr-FR") ?? "Inconnu"}
            </dd>
          </div>
          {probe.reason && (
            <div className="py-3">
              <dt className="text-13 text-chalk-3">Détail</dt>
              <dd className="mt-1 break-words text-13 text-chalk-2">
                {probe.reason}
              </dd>
            </div>
          )}
        </dl>
      )}

      <p className="mt-4 max-w-prose text-12 leading-relaxed text-chalk-4">
        Cette sonde teste un accès à PostgREST. Elle ne mesure pas la latence,
        les sauvegardes, les migrations, les événements de sécurité ni l&apos;état
        des autres services.
      </p>
    </section>
  );
}
