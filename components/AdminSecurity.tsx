"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";

type Session = {
  id: string;
  user_id: string;
  pseudo: string;
  prenom: string;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  active: boolean;
};

type Severity = "info" | "warning" | "critical";

type Security = {
  counts: {
    total: number;
    active: number;
    last_24h: number;
    credentials: number;
    admins: number;
  };
  sessions: Session[];
  alerts?: {
    id: string;
    kind: string;
    severity: Severity;
    subject: string;
    details: Record<string, unknown>;
    created_at: string;
  }[];
  signals?: { bruteForce24h: number; failedLogins24h: number };
  auditChain?: {
    ok: boolean;
    checked: number;
    brokenAt?: string | null;
    detail?: string | null;
  } | null;
  moderation?: { open: number; critical: number };
};

const TONE: Record<Severity, string> = {
  critical: "text-danger border-danger",
  warning: "text-signal border-signal",
  info: "text-chalk-3 border-line-3",
};

async function readSecurity(): Promise<Security> {
  const response = await fetch("/api/admin/security", { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? `lecture impossible (${response.status})`);
  }
  return (await response.json()) as Security;
}

/** Sessions actives et couverture des identifiants, sans jamais lire un jeton. */
export function AdminSecurity() {
  const toast = useToast();
  const [data, setData] = useState<Security | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await readSecurity());
      setError(null);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "lecture impossible");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await readSecurity().catch((cause: unknown) => {
        if (alive) {
          setError(cause instanceof Error ? cause.message : "lecture impossible");
        }
        return null;
      });
      if (alive && next) setData(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function revoke(session: Session) {
    if (busyId) return;
    if (!window.confirm(`Révoquer la session de @${session.pseudo} ?`)) return;
    setBusyId(session.id);
    try {
      const response = await fetch("/api/admin/security", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: session.id }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "révocation impossible");
      }
      await load();
      toast(`Session de @${session.pseudo} révoquée`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "révocation impossible", "err");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="px-4 py-5" aria-labelledby="admin-security-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="admin-security-title" className="font-display text-[18px] font-semibold">
            Sessions et identifiants
          </h2>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            Les empreintes de jetons ne sont jamais lues ni affichées.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busyId !== null}
          className="min-h-11 rounded-md border border-line-2
            px-3 text-12 text-chalk-3 hover:bg-surface-2 disabled:opacity-50"
        >
          Actualiser
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

      {!data && !error && <Loading label="Lecture des sessions" />}

      {data && (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-line-2 py-4 sm:grid-cols-5">
            {([
              ["Sessions actives", data.counts.active],
              ["Sessions totales", data.counts.total],
              ["Créées sur 24 h", data.counts.last_24h],
              ["Mots de passe", data.counts.credentials],
              ["Administrateurs", data.counts.admins],
            ] as const).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-12 text-chalk-4">{label}</dt>
                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-chalk">
                  {value.toLocaleString("fr-FR")}
                </dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="security-signals" className="mt-5">
            <h3 id="security-signals" className="font-display text-15 font-semibold">
              Signaux et intégrité
            </h3>
            <dl className="mt-2 divide-y divide-line-2 border-y border-line-2">
              <Row
                label="Connexions échouées (24 h)"
                value={String(data.signals?.failedLogins24h ?? 0)}
                danger={(data.signals?.failedLogins24h ?? 0) > 20}
              />
              <Row
                label="Force brute détectée (24 h)"
                value={String(data.signals?.bruteForce24h ?? 0)}
                danger={(data.signals?.bruteForce24h ?? 0) > 0}
              />
              <Row
                label="File de modération"
                value={`${data.moderation?.open ?? 0} ouvert(s), ${data.moderation?.critical ?? 0} critique(s)`}
                danger={(data.moderation?.critical ?? 0) > 0}
              />
              <Row
                label="Chaîne d'audit"
                value={
                  data.auditChain === null || data.auditChain === undefined
                    ? "non vérifiée"
                    : data.auditChain.ok
                      ? data.auditChain.checked === 0
                        ? "chaîne armée · aucune entrée hachée encore"
                        : `intègre · ${data.auditChain.checked} entrée(s)`
                      : data.auditChain.checked === 0
                        ? "vérification impossible"
                        : `rompue après ${data.auditChain.checked} entrée(s)`
                }
                danger={data.auditChain ? !data.auditChain.ok : false}
              />
            </dl>
            {data.auditChain && !data.auditChain.ok && data.auditChain.detail && (
              <p className="mt-2 max-w-prose text-13 leading-relaxed text-danger">
                {data.auditChain.detail}
                {data.auditChain.brokenAt ? ` (entrée ${data.auditChain.brokenAt})` : ""}
              </p>
            )}

            <h3 className="mt-4 font-display text-15 font-semibold">Alertes récentes</h3>
            {data.alerts && data.alerts.length > 0 ? (
              <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
                {data.alerts.slice(0, 20).map((alert) => (
                  <li key={alert.id} className="py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-12 text-chalk-2">{alert.kind}</span>
                      <span
                        className={`border-l-2 pl-2 font-mono text-12 font-semibold uppercase tracking-wider ${TONE[alert.severity]}`}
                      >
                        {alert.severity}
                      </span>
                    </div>
                    {alert.subject && <p className="mt-0.5 text-13 text-chalk-3">{alert.subject}</p>}
                    <p className="mt-0.5 font-mono text-12 text-chalk-4">
                      {new Date(alert.created_at).toLocaleString("fr-FR")}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-13 text-chalk-4">Aucun signal enregistré.</p>
            )}
          </section>

          <h3 className="mt-5 font-display text-15 font-semibold">Sessions récentes</h3>
          {data.sessions.length === 0 ? (
            <EmptyState title="Aucune session" />
          ) : (
            <div className="mt-2 divide-y divide-line-2 border-y border-line-2">
              {data.sessions.map((session) => (
                <div key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Icon
                    name="lock"
                    size={14}
                    className={session.active ? "text-ok" : "text-chalk-4"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-13 font-semibold text-chalk">
                      {session.prenom} <span className="font-mono text-12 text-chalk-4">@{session.pseudo}</span>
                    </p>
                    <p className="truncate font-mono text-12 text-chalk-4">
                      {session.user_agent || "agent inconnu"} · créée le{" "}
                      {new Date(session.created_at).toLocaleString("fr-FR")}
                      {session.active ? " · active" : " · expirée"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === session.id || !session.active}
                    onClick={() => void revoke(session)}
                    className="min-h-11 rounded-md border border-line-3
                      px-3 font-mono text-12 font-bold uppercase tracking-widest
                      text-chalk-3 hover:border-danger hover:text-danger disabled:opacity-30"
                  >
                    {busyId === session.id ? "…" : "révoquer"}
                  </button>
                </div>
              ))}
            </div>
          )}

          <h3 className="mt-6 font-display text-15 font-semibold">Signaux de sécurité</h3>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            Tentatives de connexion, blocages et actions sensibles. Les adresses
            ne sont jamais stockées en clair : seule une empreinte sert à corréler.
          </p>

          {data.signals && (
            <dl className="mt-3 grid grid-cols-2 gap-3 border-y border-line-2 py-3 sm:grid-cols-3">
              <div>
                <dt className="text-12 text-chalk-4">Échecs de connexion · 24 h</dt>
                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-chalk">
                  {data.signals.failedLogins24h.toLocaleString("fr-FR")}
                </dd>
              </div>
              <div>
                <dt className="text-12 text-chalk-4">Rafales détectées · 24 h</dt>
                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-chalk">
                  {data.signals.bruteForce24h.toLocaleString("fr-FR")}
                </dd>
              </div>
              <div>
                <dt className="text-12 text-chalk-4">File de modération</dt>
                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-chalk">
                  {(data.moderation?.open ?? 0).toLocaleString("fr-FR")}
                  {(data.moderation?.critical ?? 0) > 0 && (
                    <span className="ml-2 text-12 text-danger">
                      dont {data.moderation?.critical} critique(s)
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          )}

          {data.auditChain && (
            <p
              className={`mt-3 border-l-2 pl-3 text-13 leading-relaxed ${
                data.auditChain.ok ? "border-ok text-ok" : "border-danger text-danger"
              }`}
            >
              {data.auditChain.ok
                ? `Chaîne d'audit intacte sur ${data.auditChain.checked} entrée(s).`
                : data.auditChain.checked === 0
                  ? "Chaîne d'audit non vérifiée : le vérificateur n'est pas installé ou la base ne répond pas."
                  : `Chaîne d'audit rompue à la ligne ${data.auditChain.brokenAt ?? "inconnue"} : ${data.auditChain.detail ?? "contenu modifié"}.`}
            </p>
          )}

          {data.alerts && data.alerts.length > 0 ? (
            <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
              {data.alerts.map((alert) => (
                <li key={alert.id} className="flex flex-wrap items-baseline gap-2 py-2.5">
                  <span
                    className={`border-l-2 pl-2 font-mono text-12 font-semibold uppercase ${
                      alert.severity === "critical"
                        ? "border-danger text-danger"
                        : alert.severity === "warning"
                          ? "border-signal text-signal"
                          : "border-line-3 text-chalk-4"
                    }`}
                  >
                    {alert.severity}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-13 text-chalk-2">
                    {alert.subject || alert.kind}
                  </span>
                  <span className="font-mono text-12 text-chalk-4">
                    {new Date(alert.created_at).toLocaleString("fr-FR")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-13 text-chalk-4">
              Aucun signal enregistré. Une base sans migration 073 apparaît
              aussi comme vide : ce n&apos;est pas la même chose, et la route le
              distingue par l&apos;absence de compteurs.
            </p>
          )}
        </>
      )}
    </section>
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
