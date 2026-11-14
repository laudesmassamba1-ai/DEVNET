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

type Security = {
  counts: {
    total: number;
    active: number;
    last_24h: number;
    credentials: number;
    admins: number;
  };
  sessions: Session[];
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
    <section className="px-(--gutter) py-5" aria-labelledby="admin-security-title">
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
          className="min-h-(--h-tap) rounded-(--radius-input) border border-line-2
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
                <dd className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-chalk">
                  {value.toLocaleString("fr-FR")}
                </dd>
              </div>
            ))}
          </dl>

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
                    className="min-h-(--h-tap) rounded-(--radius-chip) border border-line-3
                      px-3 font-mono text-12 font-bold uppercase tracking-[0.1em]
                      text-chalk-3 hover:border-danger hover:text-danger disabled:opacity-30"
                  >
                    {busyId === session.id ? "…" : "révoquer"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
