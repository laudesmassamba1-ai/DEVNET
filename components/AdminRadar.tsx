"use client";

import { useCallback, useEffect, useState } from "react";
import { Loading } from "@/components/Avatar";

/**
 * Radar — l'état vivant de la plateforme.
 *
 * La version précédente appelait `/api/backend-check` et s'arrêtait là. Un
 * radar qui ne voit qu'une sonde ne voit pas l'incident : il ne dit ni sur
 * quelle base on tourne, ni si la secours répond, ni ce que les sentinelles
 * ont trouvé, ni combien d'incidents sont ouverts.
 *
 * Tout ce qui est affiché ici est mesuré à la requête. Aucun chiffre n'est
 * simulé, et un état inconnu est affiché comme inconnu — pas comme vert.
 */

type Severity = "info" | "warning" | "critical";

type DatabaseState = {
  target: "primary" | "standby";
  configured: boolean;
  reachable: boolean;
  active: boolean;
  latencyMs: number | null;
  host: string | null;
  migrations: number | null;
  schema: string | null;
  error: string | null;
};

type RadarPayload = {
  checkedAt: string;
  database: { ok: boolean; latencyMs?: number; reason?: string };
  config: {
    enabled: boolean;
    autoReturn: boolean;
    primaryConfigured: boolean;
    standbyConfigured: boolean;
    active: "primary" | "standby";
  };
  failover: {
    switchedAt: string | null;
    reason: string | null;
    health: Record<"primary" | "standby", string>;
  };
  databases: Record<"primary" | "standby", DatabaseState> | null;
  alerts: {
    id: string;
    kind: string;
    severity: Severity;
    subject: string;
    details: Record<string, unknown>;
    created_at: string;
  }[];
  incidents: { open: number; critical: number };
  lastSentinelRun: { created_at: string; severity: string; details: Record<string, unknown> } | null;
};

type SentinelFinding = {
  check: string;
  severity: Severity;
  title: string;
  detail: string;
  count?: number;
};

type SentinelReport = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  findings: SentinelFinding[];
  scanned: { texts: number; flags: number; blocked: number };
};

const TONE: Record<Severity, string> = {
  critical: "text-danger border-danger",
  warning: "text-signal border-signal",
  info: "text-chalk-3 border-line-3",
};

function formatDate(value: string | null): string {
  if (!value) return "jamais";
  return new Date(value).toLocaleString("fr-FR");
}

async function readRadar(): Promise<RadarPayload> {
  const response = await fetch("/api/admin/radar", { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `lecture impossible (${response.status})`);
  }
  return (await response.json()) as RadarPayload;
}

export function AdminRadar() {
  const [data, setData] = useState<RadarPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<SentinelReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await readRadar());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Le radar est indisponible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await readRadar();
        if (active) {
          setData(next);
          setError(null);
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Le radar est indisponible.");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/radar", { method: "POST" });
      const payload = (await response.json()) as {
        report?: SentinelReport;
        error?: string;
        audit?: { ok?: boolean; error?: string };
      };
      if (!response.ok || !payload.report) {
        setNotice(payload.error ?? "Les sentinelles n'ont pas pu s'exécuter.");
        return;
      }
      setReport(payload.report);
      setNotice(
        payload.report.findings.length === 0
          ? "Aucun constat : rien à signaler."
          : `${payload.report.findings.length} constat(s) en ${payload.report.durationMs} ms.`,
      );
      if (payload.audit && payload.audit.ok === false) {
        setNotice(payload.audit.error ?? "Rapport produit, mais le journal n'a pas été écrit.");
      }
      await load();
    } catch {
      setNotice("Réseau indisponible : les sentinelles n'ont pas abouti.");
    } finally {
      setRunning(false);
    }
  }, [load]);

  if (loading && !data) return <Loading label="Lecture du radar" />;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-4 py-5" aria-labelledby="radar-availability">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="radar-availability" className="font-display text-display-m font-semibold">
            Disponibilité
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="min-h-11 rounded-md border border-line-3
                px-3 text-12 text-chalk-3 disabled:opacity-50"
            >
              {loading ? "Actualisation…" : "Actualiser"}
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={running}
              className="min-h-11 rounded-md border border-signal
                bg-signal/10 px-3 font-mono text-12 font-bold uppercase tracking-wider
                text-signal disabled:opacity-50"
            >
              {running ? "Sentinelles…" : "Lancer les sentinelles"}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-13 text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 border-l-2 border-line-3 pl-3 text-13 text-chalk-2">
            {notice}
          </p>
        )}

        {data && (
          <>
            <dl className="mt-3 divide-y divide-line-2 border-y border-line-2">
              <Row
                label="Base active"
                value={data.config.active === "primary" ? "primaire" : "secours"}
              />
              <Row
                label="Requête de disponibilité"
                value={
                  data.database.ok
                    ? `en ligne${data.database.latencyMs ? ` · ${data.database.latencyMs} ms` : ""}`
                    : `indisponible${data.database.reason ? ` · ${data.database.reason}` : ""}`
                }
                danger={!data.database.ok}
              />
              <Row
                label="Bascule"
                value={
                  data.config.enabled
                    ? `active · retour ${data.config.autoReturn ? "automatique" : "manuel"}`
                    : "désactivée"
                }
              />
              <Row
                label="Incidents"
                value={`${data.incidents.open} ouvert(s), ${data.incidents.critical} critique(s)`}
                danger={data.incidents.critical > 0}
              />
              <Row
                label="Dernière bascule"
                value={formatDate(data.failover.switchedAt)}
              />
              <Row
                label="Dernier passage des sentinelles"
                value={formatDate(data.lastSentinelRun?.created_at ?? null)}
              />
            </dl>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["primary", "standby"] as const).map((target) => {
                const db = data.databases?.[target];
                const tone = !db?.configured
                  ? "text-chalk-4 border-line-3"
                  : db.reachable
                    ? "text-ok border-ok"
                    : "text-danger border-danger";
                return (
                  <div key={target} className="border border-line-2 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-display text-base font-semibold">
                        {target === "primary" ? "Primaire" : "Secours"}
                        {db?.active && (
                          <span className="ml-2 font-mono text-12 font-bold uppercase tracking-widest text-signal">
                            active
                          </span>
                        )}
                      </p>
                      <span className={`border-l-2 pl-2 font-mono text-12 font-semibold ${tone}`}>
                        {!db?.configured
                          ? "non configurée"
                          : db.reachable
                            ? "en ligne"
                            : "injoignable"}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-12 text-chalk-4">
                      {db?.host ?? "—"}
                      {db?.latencyMs !== null && db?.latencyMs !== undefined
                        ? ` · ${db.latencyMs} ms`
                        : ""}
                      {db?.migrations !== null && db?.migrations !== undefined
                        ? ` · ${db.migrations} migrations`
                        : ""}
                    </p>
                    {db?.error && (
                      <p className="mt-1 font-mono text-12 text-danger">{db.error}</p>
                    )}
                    {data.failover.reason && db?.active && (
                      <p className="mt-1 text-12 leading-relaxed text-chalk-4">
                        {data.failover.reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {report && (
        <section className="px-4 py-5" aria-labelledby="radar-sentinels">
          <h2 id="radar-sentinels" className="font-display text-display-m font-semibold">
            Sentinelles · dernier rapport
          </h2>
          <p className="mt-1 font-mono text-12 text-chalk-4">
            {formatDate(report.finishedAt)} · {report.durationMs} ms ·{" "}
            {report.scanned.texts} texte(s) analysé(s)
          </p>

          {report.findings.length === 0 ? (
            <p className="mt-3 border-l-2 border-ok pl-3 text-13 text-ok">
              Aucun constat. Ce n&apos;est pas une preuve d&apos;absence de problème :
              c&apos;est l&apos;absence de signal mesuré.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line-2">
              {report.findings.map((finding, index) => (
                <li key={`${finding.check}-${index}`} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-display text-base font-semibold">{finding.title}</span>
                    <span
                      className={`border-l-2 pl-2 font-mono text-12 font-semibold uppercase tracking-wider ${TONE[finding.severity]}`}
                    >
                      {finding.severity === "critical"
                        ? "critique"
                        : finding.severity === "warning"
                          ? "attention"
                          : "info"}
                    </span>
                  </div>
                  <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
                    {finding.detail}
                  </p>
                  <p className="mt-1 font-mono text-12 text-chalk-4">contrôle : {finding.check}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && (
        <section className="px-4 py-5" aria-labelledby="radar-alerts">
          <h2 id="radar-alerts" className="font-display text-display-m font-semibold">
            Signaux de sécurité récents
          </h2>
          {data.alerts.length === 0 ? (
            <p className="mt-2 text-13 text-chalk-4">Aucun signal enregistré.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line-2">
              {data.alerts.map((alert) => (
                <li key={alert.id} className="py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-12 text-chalk-2">{alert.kind}</span>
                    <span
                      className={`border-l-2 pl-2 font-mono text-12 font-semibold uppercase tracking-wider ${TONE[alert.severity]}`}
                    >
                      {alert.severity}
                    </span>
                  </div>
                  {alert.subject && (
                    <p className="mt-0.5 text-13 text-chalk-3">{alert.subject}</p>
                  )}
                  <p className="mt-0.5 font-mono text-12 text-chalk-4">
                    {formatDate(alert.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="px-4 py-4 font-mono text-12 text-chalk-4">
        Mesuré le {formatDate(data?.checkedAt ?? null)} · les constats des sentinelles ne
        suppriment rien : la décision reste humaine.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
      <dt className="text-13 text-chalk-3">{label}</dt>
      <dd className={`font-mono text-12 ${danger ? "text-danger" : "text-chalk-2"}`}>{value}</dd>
    </div>
  );
}
