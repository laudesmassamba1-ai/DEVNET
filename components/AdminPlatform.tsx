"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Plateforme — `/admin/platform`.
 *
 * Le module disait « les jobs, sauvegardes et limites ne sont pas
 * observables depuis l'application ». Les sauvegardes le sont ; cet écran
 * s'occupe du reste, et le reste a une propriété qui compte : **il se
 * mesure**.
 *
 * Trois principes, et aucun n'est un badge vert :
 *
 *  - **Un job sans trace n'est pas un job.** La purge des stories n'écrit
 *    aucun journal : on ne peut pas dire « elle a tourné ». On mesure son
 *    effet attendu — combien de stories sont expirées à cet instant. Si ce
 *    nombre reste élevé alors que le cron passe chaque nuit, il ne tourne
 *    pas. C'est une preuve par l'absence, et elle est plus honnête qu'un
 *    voyant vert.
 *  - **Un verdict `inconnu` est un verdict.** Quand rien ne permet de
 *    conclure, l'écran le dit au lieu de rassurer.
 *  - **Les limites sont lues, pas supposées.** `max_connections` vient du
 *    serveur : 901 sur Neon, 100 sur Systalink. Une constante du dépôt
 *    aurait menti sur l'un des deux.
 */

type Verdict = "ok" | "late" | "unknown";

type Job = {
  name: string;
  schedule: string;
  trigger: string;
  purpose: string;
  evidence: string | null;
  verdict: Verdict;
};

type PlatformState = {
  checkedAt: string;
  database: {
    ok: boolean;
    latencyMs: number | null;
    reason: string | null;
    active: "primary" | "standby";
  };
  jobs: Job[];
  outbox: {
    total: number;
    pending: number;
    failed: number;
    dispatched: number;
    oldestPendingAt: string | null;
    lastEventAt: string | null;
  } | null;
  stories: { expired: number; live: number; oldestExpiredAt: string | null } | null;
  limits: {
    maxConnections: number | null;
    activeConnections: number | null;
    devnetConnections: number | null;
    databaseBytes: number | null;
    statementTimeout: string | null;
  } | null;
  secrets: { cronSecret: boolean; drainSecret: boolean };
};

const VERDICT_LABEL: Record<Verdict, string> = {
  ok: "Fonctionne",
  late: "En retard",
  unknown: "Non concluant",
};

const VERDICT_TONE: Record<Verdict, string> = {
  ok: "text-ok border-ok",
  late: "text-danger border-danger",
  unknown: "text-chalk-3 border-line-3",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR");
}

export function AdminPlatform() {
  const [data, setData] = useState<PlatformState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/platform", { cache: "no-store" });
      const payload = (await res.json()) as PlatformState & { error?: string };
      if (!res.ok || !payload.jobs) {
        setError(payload.error ?? "Lecture impossible.");
        setData(null);
        return;
      }
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await load();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  if (error) {
    return (
      <section className="px-(--gutter) py-5">
        <p role="alert" className="max-w-prose text-13 text-danger">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mo-press mt-3 min-h-(--h-tap) rounded-(--radius-chip)
            border border-line-3 px-4 text-13 text-chalk-2"
        >
          Réessayer
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="px-(--gutter) py-5">
        <p className="text-13 text-chalk-4">{loading ? "Lecture…" : "Aucune donnée."}</p>
      </section>
    );
  }

  const late = data.jobs.filter((job) => job.verdict === "late").length;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-(--gutter) py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-display-m font-semibold">Tâches planifiées</h2>
          <div className="flex items-baseline gap-3">
            {late > 0 && (
              <p className="font-mono text-12 font-semibold text-danger tnum">
                {late} en retard
              </p>
            )}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="min-h-(--h-tap) rounded-(--radius-chip) border border-line-3
                px-3 text-12 text-chalk-3 disabled:opacity-50"
            >
              {loading ? "Actualisation…" : "Actualiser"}
            </button>
          </div>
        </div>

        <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
          Aucun de ces jobs n&apos;écrit de journal. Leur état est donc déduit de
          leur <em>effet mesurable</em>, pas d&apos;un voyant. Quand rien ne permet
          de conclure, c&apos;est écrit « non concluant ».
        </p>

        <ul className="mt-4 divide-y divide-line-2">
          {data.jobs.map((job) => (
            <li key={job.name} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-base font-semibold">{job.name}</span>
                <span
                  className={`border-l-2 pl-2 font-mono text-12 font-semibold ${VERDICT_TONE[job.verdict]}`}
                >
                  {VERDICT_LABEL[job.verdict]}
                </span>
              </div>
              <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
                {job.purpose}
              </p>
              <p className="mt-1 font-mono text-12 text-chalk-4">
                {job.schedule} · {job.trigger}
              </p>
              {job.evidence && (
                <p className="mt-1.5 max-w-prose text-13 leading-relaxed text-chalk-2">
                  {job.evidence}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {data.outbox && (
        <section className="px-(--gutter) py-5">
          <h2 className="font-display text-display-m font-semibold">Boîte d’envoi</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className="font-mono text-12 text-chalk-4">Traités</dt>
              <dd className="font-display text-display-m font-semibold tnum">
                {data.outbox.dispatched}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-12 text-chalk-4">En attente</dt>
              <dd
                className={`font-display text-display-m font-semibold tnum ${data.outbox.pending > 0 ? "text-danger" : ""}`}
              >
                {data.outbox.pending}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-12 text-chalk-4">Échoués</dt>
              <dd
                className={`font-display text-display-m font-semibold tnum ${data.outbox.failed > 0 ? "text-danger" : ""}`}
              >
                {data.outbox.failed}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-12 text-chalk-4">Total</dt>
              <dd className="font-display text-display-m font-semibold tnum">
                {data.outbox.total}
              </dd>
            </div>
          </dl>
          <p className="mt-3 font-mono text-12 text-chalk-4">
            dernier événement : {formatDate(data.outbox.lastEventAt)}
            {data.outbox.pending > 0
              ? ` · le plus ancien en attente date du ${formatDate(data.outbox.oldestPendingAt)}`
              : ""}
          </p>
        </section>
      )}

      {data.stories && (
        <section className="px-(--gutter) py-5">
          <h2 className="font-display text-display-m font-semibold">Stories</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt className="font-mono text-12 text-chalk-4">Vivantes</dt>
              <dd className="font-display text-display-m font-semibold tnum">
                {data.stories.live}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-12 text-chalk-4">Expirées</dt>
              <dd
                className={`font-display text-display-m font-semibold tnum ${data.stories.expired > 0 ? "text-signal" : ""}`}
              >
                {data.stories.expired}
              </dd>
            </div>
          </dl>
          {data.stories.expired > 0 && data.stories.oldestExpiredAt && (
            <p className="mt-2 max-w-prose text-13 leading-relaxed text-chalk-3">
              La plus ancienne a expiré le {formatDate(data.stories.oldestExpiredAt)}.
              Ces lignes restent en base jusqu&apos;au prochain passage de la purge.
            </p>
          )}
        </section>
      )}

      {data.limits && (
        <section className="px-(--gutter) py-5">
          <h2 className="font-display text-display-m font-semibold">Limites du serveur</h2>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            Lues sur le serveur, pas dans le dépôt : Neon et Systalink
            n&apos;annoncent pas les mêmes plafonds.
          </p>
          <dl className="mt-3 divide-y divide-line-2 border-y border-line-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
              <dt className="text-13 text-chalk-3">Connexions</dt>
              <dd className="font-mono text-12 text-chalk-2 tnum">
                {data.limits.activeConnections} / {data.limits.maxConnections}
                {data.limits.devnetConnections !== null
                  ? ` · ${data.limits.devnetConnections} depuis l’application`
                  : ""}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
              <dt className="text-13 text-chalk-3">Taille de la base</dt>
              <dd className="font-mono text-12 text-chalk-2">
                {formatBytes(data.limits.databaseBytes)}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
              <dt className="text-13 text-chalk-3">Délai d’expiration des requêtes</dt>
              <dd className="font-mono text-12 text-chalk-2">
                {data.limits.statementTimeout ?? "non défini"}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <section className="px-(--gutter) py-5">
        <h2 className="font-display text-display-m font-semibold">Secrets de tâches</h2>
        <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
          Sans ces secrets, les routes de tâches refusent de s&apos;exécuter —
          c&apos;est voulu : une route qui supprime des données ne doit jamais
          être publique.
        </p>
        <ul className="mt-3 divide-y divide-line-2">
          <li className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
            <span className="text-13 text-chalk-2">CRON_SECRET (purge)</span>
            <span
              className={`font-mono text-12 font-semibold ${data.secrets.cronSecret ? "text-ok" : "text-danger"}`}
            >
              {data.secrets.cronSecret ? "configuré" : "absent — la purge répond 503"}
            </span>
          </li>
          <li className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
            <span className="text-13 text-chalk-2">EVENTS_DRAIN_SECRET (drainage)</span>
            <span
              className={`font-mono text-12 font-semibold ${data.secrets.drainSecret ? "text-ok" : "text-chalk-4"}`}
            >
              {data.secrets.drainSecret
                ? "configuré"
                : "absent — drainage par session seulement"}
            </span>
          </li>
        </ul>
      </section>

      <p className="px-(--gutter) py-4 font-mono text-12 text-chalk-4">
        Mesuré le {formatDate(data.checkedAt)} · base{" "}
        {data.database.active === "primary" ? "primaire" : "secours"}
        {data.database.latencyMs !== null ? ` · ${data.database.latencyMs} ms` : ""}
      </p>
    </div>
  );
}
