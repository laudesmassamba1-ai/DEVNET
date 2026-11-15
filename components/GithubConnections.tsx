"use client";

import { useCallback, useEffect, useState } from "react";
import { asIconName, Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import {
  CONNECTION_PROVIDERS,
  connectProvider,
  disconnectConnection,
  listConnections,
  touchConnection,
  validEndpoint,
  SYNC_MODES,
  type ConnectionProvider,
} from "@/lib/github/connect";
import type { SyncMode } from "@/lib/github/link";
import { timeAgo } from "@/lib/utils";
import type { GithubConnection } from "@/lib/types";

/**
 * Les autres destinations — tout sauf GitHub, qui a sa section.
 *
 * GitHub est traité à part parce qu'il a **plus** qu'une connexion : un
 * lien de dépôt, un plan de synchronisation, un mode. Les autres
 * fournisseurs (tunnel VS Code, API, webhook) partagent une forme unique :
 * une identité, une adresse, un état. C'est cette forme qu'on rend ici,
 * pilotée par `CONNECTION_PROVIDERS` — la liste fermée des fournisseurs
 * connus, pour que la section existe même quand rien n'est connecté.
 *
 * L'écran est le même moteur que GitHub : `token_ref` pointe au coffre, le
 * jeton n'est jamais là. La section ne fait rien de réseau : elle constate
 * un usage (`touchConnection`) sur un geste de l'utilisateur.
 */
export function ConnectionsSection({ me }: { me: string }) {
  const toast = useToast();
  const [connections, setConnections] = useState<GithubConnection[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { login: string; endpoint: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    const list = await listConnections(me);
    setConnections(list);
  }, [me]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const byProvider = new Map((connections ?? []).map((c) => [c.provider, c]));
  const others = CONNECTION_PROVIDERS.filter((p) => p.id !== "github");

  async function doConnect(p: ConnectionProvider) {
    const draft = drafts[p.id] ?? { login: "", endpoint: "" };
    setBusyId(p.id);
    const { error } = await connectProvider({
      me,
      provider: p.id,
      login: draft.login,
      endpoint: p.needsEndpoint ? draft.endpoint : "",
    });
    setBusyId(null);
    if (error) return toast(error, "err");
    await load();
    toast(`${p.label} connecté`);
  }

  async function doTouch(id: string) {
    setBusyId(id);
    const { error } = await touchConnection(id);
    setBusyId(null);
    if (error) return toast(error, "err");
    await load();
  }

  return (
    <section className="rounded-(--radius-card) border border-line-2/60 bg-surface p-4">
      <h3 className="prompt-label mb-2 text-chalk-2">Autres connexions</h3>
      <p className="mb-3 max-w-[62ch] text-sm leading-relaxed text-chalk-3">
        Un tunnel VS Code, une API à prévenir. Le secret de chaque destination
        vit au coffre : on n&apos;en garde ici que le nom.
      </p>

      <div className="flex flex-col gap-3">
        {others.map((p) => {
          const conn = byProvider.get(p.id) ?? null;
          const draft = drafts[p.id] ?? { login: "", endpoint: "" };
          const canConnect =
            !!draft.login.trim() && (!p.needsEndpoint || validEndpoint(draft.endpoint));

          return (
            <div
              key={p.id}
              className="rounded-(--radius-input) border border-line-2/60 bg-surface-2 p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <Icon name={asIconName(p.icon, "server")} size={14} />
                <span className="font-mono text-sm font-bold text-chalk">{p.label}</span>
                {conn && (
                  <StatusChip status={conn.status} />
                )}
              </div>

              {conn ? (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm font-bold text-chalk">
                      {conn.login}
                    </div>
                    {conn.endpoint && (
                      <a
                        href={conn.endpoint}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-mono text-sm text-chalk-4 hover:text-signal"
                      >
                        {conn.endpoint}
                      </a>
                    )}
                    <div className="text-sm text-chalk-4">
                      {conn.used_at
                        ? `utilisée ${timeAgo(conn.used_at)}`
                        : "jamais utilisée"}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === conn.id}
                    onClick={() => void doTouch(conn.id)}
                    className="h-(--h-action) rounded-(--radius-chip) border
                      border-line-3 px-3 font-mono text-sm font-bold tracking-[0.08em]
                      text-chalk uppercase transition-colors hover:border-signal hover:text-signal
                      disabled:opacity-40"
                  >
                    Marquer utilisée
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const { error } = await disconnectConnection(conn.id);
                      if (error) return toast(error, "err");
                      await load();
                      toast(`${p.label} déconnecté`);
                    }}
                    className="font-mono text-sm font-bold tracking-[0.08em]
                      text-chalk-3 uppercase transition-colors hover:text-danger"
                  >
                    Déconnecter
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm leading-snug text-chalk-3">{p.hint}</p>
                  <input
                    aria-label="Identifiant de la preuve"
                    value={draft.login}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [p.id]: { ...draft, login: e.target.value } }))
                    }
                    placeholder={p.identityPlaceholder}
                    className="h-(--h-input) w-full rounded-(--radius-input)
                      border border-line-3 bg-surface px-3 font-mono text-13
                      shadow-sh-1 placeholder:text-chalk-4
                      focus:shadow-[3px_3px_0_var(--color-signal)]"
                  />
                  {p.needsEndpoint && (
                    <input
                      aria-label="Point de contrôle de la preuve"
                      value={draft.endpoint}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [p.id]: { ...draft, endpoint: e.target.value } }))
                      }
                      placeholder={p.endpointPlaceholder}
                      className="h-(--h-input) w-full rounded-(--radius-input)
                        border border-line-3 bg-surface px-3 font-mono text-13
                        shadow-sh-1 placeholder:text-chalk-4
                        focus:shadow-[3px_3px_0_var(--color-signal)]"
                    />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-chalk-4">{p.effect}</span>
                    <button
                      type="button"
                      onClick={() => void doConnect(p)}
                      disabled={busyId === p.id || !canConnect}
                      className="h-(--h-input) shrink-0 rounded-(--radius-chip) border
                        border-signal bg-signal px-4 font-mono text-sm font-bold
                        tracking-[0.1em] text-void uppercase shadow-sh-1 disabled:opacity-40"
                    >
                      Connecter
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** La pastille d'état d'une connexion, colorée sans exagérer l'alarme. */
function StatusChip({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "text-signal-d"
      : status === "pending"
        ? "text-warn"
        : "text-danger";
  return (
    <span className={`label-micro ml-auto ${tone}`}>
      {status === "active" ? "Active" : status === "pending" ? "En attente" : "En erreur"}
    </span>
  );
}

/** Le choix du mode, avec la raison de chaque option. */
export function ModeChoice({
  value,
  onChange,
  ownedByViewer,
}: {
  value: SyncMode;
  onChange: (m: SyncMode) => void;
  ownedByViewer: boolean;
}) {
  return (
    <div>
      <span className="label-micro mb-1 block text-chalk-3">Mode de synchronisation</span>
      <div role="radiogroup" aria-label="Mode de synchronisation" className="flex flex-col gap-1">
        {SYNC_MODES.map((m) => {
          const needsOwnership = m.value === "push" || m.value === "bidirectionnel";
          const disabled = needsOwnership && !ownedByViewer;
          const selected = value === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(m.value)}
              className={`flex min-h-(--h-tap) items-start gap-2 border px-3 py-2 text-left
                transition-colors disabled:opacity-40
                ${selected ? "border-signal bg-signal/10" : "border-line-2 hover:border-chalk-3"}`}
            >
              <span className={`mt-0.5 ${selected ? "text-signal" : "text-chalk-4"}`}>
                <Icon name={selected ? "check" : "globe"} size={12} />
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-12 font-bold text-chalk">
                  {m.label}
                </span>
                <span className="block text-sm leading-snug text-chalk-4">{m.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
