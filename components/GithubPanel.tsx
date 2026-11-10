"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Loading } from "@/components/Avatar";
import { asIconName, Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import {
  CONNECTION_PROVIDERS,
  connectGithub,
  connectProvider,
  disconnectConnection,
  disconnectGithub,
  fetchConnection,
  fetchProjectLink,
  linkProject,
  linkStale,
  listConnections,
  localSyncPlan,
  markSynced,
  setSyncInterval,
  SYNC_MODES,
  touchConnection,
  unlinkProject,
  validEndpoint,
  type ConnectionProvider,
} from "@/lib/github/connect";
import { parseRepo, repoSlug, type LinkError, type SyncMode } from "@/lib/github/link";
import {
  LIVE_INTERVALS,
  LINK_CHANGED_EVENT,
  liveEnabled,
} from "@/lib/github/live";
import { SYNC_ERROR_TEXT } from "@/lib/github/sync";
import { pushToGithub } from "@/lib/github/push";
import { useSession } from "@/hooks/useSession";
import type { GithubLiveSync, LiveStatus } from "@/hooks/useGithubLiveSync";
import { isDemoMode } from "@/lib/backend";
import { fetchBranches, fetchRepoFiles } from "@/lib/repo";
import { timeAgo } from "@/lib/utils";
import type { GithubConnection, GithubRepo, ProjectLink } from "@/lib/types";

/**
 * L'onglet GitHub d'un dépôt.
 *
 * ## Ce que l'écran fait, et ce qu'il ne fait pas
 *
 * Il **connecte** une identité GitHub, **lie** le projet à un dépôt, et
 * **montre ce qu'une synchronisation ferait** avant de la faire. Il ne
 * transfère rien : le transfert demande un jeton (au coffre) et un appel
 * réseau, que l'application n'a pas — et ce n'est pas un oubli, c'est la
 * décision « pas de route handler » (MEMO §9) appliquée à GitHub.
 *
 * L'écran le dit, en clair, sous le bouton. Prétendre avoir poussé serait
 * la seule vraie faute possible ici.
 */

const LINK_ERROR_TEXT: Record<LinkError, string> = {
  "url-invalide": "URL de dépôt invalide",
  "proprietaire-invalide": "Propriétaire GitHub invalide",
  "depot-invalide": "Nom de dépôt invalide",
  "modes-differents": "Le mode bidirectionnel exige que le dépôt soit le vôtre.",
  "branche-invalide": "Nom de branche invalide",
};

const ACTION_TEXT: Record<string, string> = {
  "aucun-changement": "Rien à faire",
  push: "Des commits à envoyer",
  pull: "GitHub a des commits en avance",
  divergence: "Divergence — à réconcilier à la main",
};

/** Ce que la boucle live est en train de faire, en un mot. */
const LIVE_STATUS_TEXT: Record<LiveStatus, string> = {
  idle: "à jour",
  checking: "vérification…",
  pulling: "tirage…",
  pushing: "poussée…",
  diverged: "divergence — arrêtée",
  error: "erreur",
};

/** La pastille d'état de la boucle live. */
function liveTone(status?: LiveStatus): string {
  if (status === "error" || status === "diverged") return "bg-danger";
  if (status === "checking" || status === "pulling" || status === "pushing") {
    return "bg-warn";
  }
  if (status === "idle") return "bg-signal";
  return "bg-chalk-4";
}


/**
 * Pourquoi la liste de dépôts n'est pas là, quand elle n'y est pas.
 *
 * Ces valeurs viennent des routes `/api/github/*` (elles-mêmes calquées sur
 * les réponses GitHub) : on les garde fermées pour que l'écran dise un
 * remède précis — se reconnecter, plutôt que « erreur ».
 */
type ReposError = "no-token" | "no-scope" | "api" | "unconfigured" | null;

/**
 * L'identité GitHub posée par l'OAuth du profil, si elle existe.
 *
 * Sert à un seul geste : quand le projet n'a pas encore de ligne de
 * connexion mais que le compte a déjà été autorisé dans le profil, on
 * réutilise ce login au lieu de le redemander — GitHub l'a déjà donné.
 */
async function getOauthLogin(): Promise<string | null> {
  try {
    const res = await fetch("/api/github/identity", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { login?: string } | null;
    return data?.login ?? null;
  } catch {
    return null;
  }
}

/** Les dépôts du compte connecté, ou la raison de leur absence. */
async function getRepos(): Promise<{ repos: GithubRepo[] | null; error: ReposError }> {
  // En démonstration, aucun jeton GitHub côté serveur : la demande
  // reviendrait en 401 — un bruit de console qui ne dit rien à l'écran.
  if (isDemoMode()) return { repos: null, error: "no-token" };
  try {
    const res = await fetch("/api/github/repos", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { repos?: GithubRepo[] } | null;
      return { repos: data?.repos ?? [], error: null };
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { repos: null, error: (data?.error as ReposError) ?? "api" };
  } catch {
    return { repos: null, error: "api" };
  }
}

/**
 * Prévient la boucle live d'un changement de réglage.
 *
 * Le hook vit sur la page, le panneau seulement le configure : sans cet
 * événement, changer de mode ne prendrait effet qu'au tick suivant — ou
 * jamais, si la cadence était longue.
 */
function notifyLive() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LINK_CHANGED_EVENT));
  }
}

export function GithubPanel({
  projectId,
  branch,
  live,
}: {
  projectId: string;
  /** Branche affichée dans le dépôt : c'est sa tête qui compte. */
  branch: string;
  /**
   * La boucle de synchronisation live tenue par la page. Optionnelle pour
   * que le panneau reste utilisable seul (tests, aperçus) : sans elle, on
   * montre seulement les réglages, sans l'état du polling.
   */
  live?: GithubLiveSync;
}) {
  const toast = useToast();
  // La session courante vient du hook partagé : la lire via `auth.getUser`
  // aurait échoué en démo (`getUser` n'y existe pas) — et l'écran GitHub
  // se serait rendu vide sans message. Le hook connaît les deux modes.
  const { profile } = useSession();
  const me = profile?.id ?? "";

  const [connection, setConnection] = useState<GithubConnection | null | undefined>(undefined);
  const [link, setLink] = useState<ProjectLink | null | undefined>(undefined);
  const [headSha, setHeadSha] = useState<string>("");
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [reposError, setReposError] = useState<ReposError>(null);

  const [login, setLogin] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<SyncMode>("manuel");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;

    const [conn, lk, refs] = await Promise.all([
      fetchConnection(me),
      fetchProjectLink(projectId),
      fetchBranches(projectId),
    ]);

    // Un compte autorisé par l'OAuth du profil n'a pas forcément de ligne
    // ici : on l'adopte plutôt que de redemander un identifiant que GitHub
    // nous a déjà donné.
    let effective = conn;
    if (!conn) {
      const oauthLogin = await getOauthLogin();
      if (oauthLogin) {
        const { connection: saved } = await connectGithub(me, oauthLogin);
        effective = saved;
      }
    }

    setConnection(effective);
    setLink(lk);
    setHeadSha(refs.find((r) => r.name === branch)?.sha ?? "");

    const repoResult = await getRepos();
    setRepos(repoResult.repos);
    setReposError(repoResult.error);
  }, [me, projectId, branch]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const parsed = useMemo(() => (url.trim() ? parseRepo(url) : null), [url]);
  const ownedByViewer =
    Boolean(connection) &&
    parsed?.ok === true &&
    connection!.login.toLowerCase() === parsed.ref.owner.toLowerCase();

  const plan = useMemo(
    () => (link && connection ? localSyncPlan(link, headSha) : null),
    [link, connection, headSha],
  );

  async function doConnect() {
    if (!me) return;
    setBusy(true);
    const { connection: conn, error } = await connectGithub(me, login);
    setBusy(false);
    if (error) return toast(error, "err");
    setConnection(conn);
    setLogin("");
    toast(`Connecté à GitHub en tant que @${conn?.login}`);
  }

  async function doLink() {
    if (!me || !connection) return;
    setBusy(true);
    const { link: lk, parsed: res, error } = await linkProject({
      projectId,
      me,
      url,
      mode,
      ownedByViewer,
      branch,
    });
    setBusy(false);
    if (error) return toast(error, "err");
    if (!res.ok) return toast(LINK_ERROR_TEXT[res.reason], "err");
    setLink(lk);
    setUrl("");
    notifyLive();
    toast(`Dépôt lié : ${lk ? repoSlug({ owner: lk.owner, repo: lk.repo }) : ""}`);
  }

  async function doMarkSynced() {
    if (!link) return;
    setBusy(true);
    const { error } = await markSynced(link.id, headSha);
    setBusy(false);
    if (error) return toast(error, "err");
    toast("État synchronisé enregistré");
    await load();
  }

  /**
   * Pousse la tête locale vers GitHub.
   *
   * Le transfert réel vit dans la route `/api/github/sync` — la seule
   * exception bornée où DevNet parle à GitHub avec un jeton. Ici on
   * assemble la charge (les fichiers de la branche, la tête locale, le
   * dernier sha distant connu) et on traduit la réponse. On n'enregistre
   * l'état synchronisé **qu'après** un succès : marquer avant mentirait
   * sur ce qui est réellement parti.
   */
  async function doPush() {
    if (!link) return;
    setBusy(true);
    const files = await fetchRepoFiles(projectId, branch);
    if (files.length === 0) {
      setBusy(false);
      return toast("Rien à pousser : la branche est vide.", "err");
    }

    const outcome = await pushToGithub({
      owner: link.owner,
      repo: link.repo,
      branch: link.default_branch,
      headSha,
      expectedRemoteSha: link.last_push_sha ?? "",
      message: `DevNet → GitHub (${headSha.slice(0, 7)})`,
      files: files.map((f) => ({ path: f.path, content: f.content })),
    });
    setBusy(false);

    if (outcome.status === "pushed") {
      await markSynced(link.id, headSha);
      toast(`Poussé vers GitHub — ${outcome.sha.slice(0, 7)}`);
      await load();
      return;
    }
    if (outcome.status === "error") {
      toast(SYNC_ERROR_TEXT[outcome.code], "err");
    }
  }

  async function doUnlink() {
    if (!link) return;
    setBusy(true);
    const { error } = await unlinkProject(link.id);
    setBusy(false);
    if (error) return toast(error, "err");
    setLink(null);
    notifyLive();
    toast("Dépôt délié");
  }

  if (connection === undefined) return <Loading label="Lecture de la connexion" />;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Connexion ── */}
      <section className="rounded-[var(--radius-card)] border border-line-2/60 bg-surface p-4">
        <h3 className="prompt-label mb-2 text-chalk-2">Connexion GitHub</h3>

        {connection === null ? (
          <>
            <p className="mb-3 max-w-[62ch] text-sm leading-relaxed text-chalk-3">
              Copie vers GitHub ; DevNet reste la source. Jeton propre à votre compte.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1">
                <span className="label-micro mb-1 block text-chalk-3">
                  Identifiant GitHub
                </span>
                <input
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="koffi-devnet"
                  className="h-[var(--h-input)] w-full rounded-[var(--radius-input)]
                    border border-line-3 bg-surface px-3 font-mono text-[13px]
                    shadow-sh-1 placeholder:text-chalk-4
                    focus:shadow-[3px_3px_0_var(--color-signal)]"
                />
              </label>
              <button
                type="button"
                onClick={() => void doConnect()}
                disabled={busy || !login.trim()}
                className="h-[var(--h-input)] rounded-[var(--radius-chip)] border
                  border-signal bg-signal px-4 font-mono text-[12px] font-bold
                  tracking-[0.1em] text-void uppercase shadow-sh-1
                  disabled:opacity-40"
              >
                Connecter
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar name={connection.login} color="av-sage" />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[13px] font-bold text-chalk">
                @{connection.login}
              </div>
              <div className="text-sm text-chalk-4">
                connecté {timeAgo(connection.connected_at)} · scopes{" "}
                {connection.scopes.join(", ") || "aucun"}
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                const { error } = await disconnectGithub(connection.id);
                if (error) return toast(error, "err");
                setConnection(null);
                setLink(null);
                toast("GitHub déconnecté");
              }}
              className="font-mono text-sm font-bold tracking-[0.08em]
                text-chalk-3 uppercase transition-colors hover:text-danger"
            >
              Déconnecter
            </button>
          </div>
        )}
      </section>

      {/* ── Lien de projet ── */}
      {connection && (
        <section className="rounded-[var(--radius-card)] border border-line-2/60 bg-surface p-4">
          <h3 className="prompt-label mb-2 text-chalk-2">Dépôt lié</h3>

          {link === undefined ? (
            <Loading label="Lecture du lien" />
          ) : link === null ? (
            <>
              <p className="mb-3 max-w-[62ch] text-sm leading-relaxed text-chalk-3">
                URL GitHub ou <span className="font-mono">propriétaire/dépôt</span>.
              </p>
              <RepoPicker
                repos={repos}
                error={reposError}
                value={url}
                onPick={setUrl}
              />
              <div className="flex flex-col gap-2.5">
                <input
                  aria-label="URL du dépôt GitHub"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/koffi-devnet/cooperative"
                  className="h-[var(--h-input)] w-full rounded-[var(--radius-input)]
                    border border-line-3 bg-surface px-3 font-mono text-[13px]
                    shadow-sh-1 placeholder:text-chalk-4
                    focus:shadow-[3px_3px_0_var(--color-signal)]"
                />
                {parsed && !parsed.ok && (
                  <p className="text-sm text-danger">{LINK_ERROR_TEXT[parsed.reason]}</p>
                )}
                <ModeChoice value={mode} onChange={setMode} ownedByViewer={ownedByViewer} />
                <div>
                  <button
                    type="button"
                    onClick={() => void doLink()}
                    disabled={busy || !parsed?.ok}
                    className="h-[var(--h-input)] rounded-[var(--radius-chip)] border
                      border-signal bg-signal px-4 font-mono text-[12px] font-bold
                      tracking-[0.1em] text-void uppercase shadow-sh-1
                      disabled:opacity-40"
                  >
                    Lier
                  </button>
                </div>
              </div>
            </>
          ) : (
            <LinkedView
              link={link}
              plan={plan}
              headSha={headSha}
              busy={busy}
              live={live}
              ownedByViewer={
                connection.login.toLowerCase() === link.owner.toLowerCase()
              }
              canPush={Boolean(headSha)}
              onPush={() => void doPush()}
              onMarkSynced={() => void doMarkSynced()}
              onUnlink={() => void doUnlink()}
              onChangeMode={async (m) => {
                setBusy(true);
                const { error } = await linkProject({
                  projectId,
                  me,
                  url: repoSlug({ owner: link.owner, repo: link.repo }),
                  mode: m,
                  ownedByViewer: connection.login.toLowerCase() === link.owner.toLowerCase(),
                  branch: link.default_branch,
                });
                setBusy(false);
                if (error) return toast(error, "err");
                await load();
                notifyLive();
              }}
              onChangeInterval={async (seconds) => {
                setBusy(true);
                const { error } = await setSyncInterval(link.id, seconds);
                setBusy(false);
                if (error) return toast(error, "err");
                await load();
                notifyLive();
              }}
            />
          )}
        </section>
      )}

      {/* ── Autres connexions ── */}
      <ConnectionsSection me={me} />
    </div>
  );
}

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
function ConnectionsSection({ me }: { me: string }) {
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
    <section className="rounded-[var(--radius-card)] border border-line-2/60 bg-surface p-4">
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
              className="rounded-[var(--radius-input)] border border-line-2/60 bg-surface-2 p-3"
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
                    className="h-[var(--h-action)] rounded-[var(--radius-chip)] border
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
                    className="h-[var(--h-input)] w-full rounded-[var(--radius-input)]
                      border border-line-3 bg-surface px-3 font-mono text-[13px]
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
                      className="h-[var(--h-input)] w-full rounded-[var(--radius-input)]
                        border border-line-3 bg-surface px-3 font-mono text-[13px]
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
                      className="h-[var(--h-input)] shrink-0 rounded-[var(--radius-chip)] border
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
function ModeChoice({
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
              className={`flex min-h-[var(--h-tap)] items-start gap-2 border px-3 py-2 text-left
                transition-colors disabled:opacity-40
                ${selected ? "border-signal bg-signal/10" : "border-line-2 hover:border-chalk-3"}`}
            >
              <span className={`mt-0.5 ${selected ? "text-signal" : "text-chalk-4"}`}>
                <Icon name={selected ? "check" : "globe"} size={12} />
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-[12px] font-bold text-chalk">
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

/** Le détail d'un lien existant, avec son plan. */
function LinkedView({
  link,
  plan,
  headSha,
  busy,
  live,
  ownedByViewer,
  canPush,
  onPush,
  onMarkSynced,
  onUnlink,
  onChangeMode,
  onChangeInterval,
}: {
  link: ProjectLink;
  plan: { action: string; reason: string } | null;
  headSha: string;
  busy: boolean;
  live?: GithubLiveSync;
  ownedByViewer: boolean;
  canPush: boolean;
  onPush: () => void;
  onMarkSynced: () => void;
  onUnlink: () => void;
  onChangeMode: (m: SyncMode) => void;
  onChangeInterval: (seconds: number) => void;
}) {
  const stale = linkStale(link);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[13px] font-bold text-chalk">
          {repoSlug({ owner: link.owner, repo: link.repo })}
        </span>
        <span className="font-mono text-sm text-chalk-4">
          branche {link.default_branch}
        </span>
        <span className="label-micro text-chalk-3">
          {SYNC_MODES.find((m) => m.value === link.sync_mode)?.label ?? link.sync_mode}
        </span>
      </div>

      {link.last_synced_at && (
        <p className="font-mono text-sm text-chalk-4">
          dernière synchro {timeAgo(link.last_synced_at)}
          {link.last_push_sha ? ` · ${link.last_push_sha.slice(0, 7)}` : ""}
        </p>
      )}

      {stale && (
        <p className="flex items-center gap-1.5 text-sm text-warn">
          <Icon name="info" size={12} />
          Lien non rafraîchi depuis 30 jours.
        </p>
      )}

      {/* Le plan, dit avant toute action — c'est tout l'intérêt. */}
      {plan && (
        <div className="border-l-2 border-signal bg-surface-2 px-3 py-2">
          <div className="font-mono text-sm font-bold text-signal">
            {ACTION_TEXT[plan.action] ?? plan.action}
          </div>
          <div className="mt-0.5 text-sm leading-snug text-chalk-3">{plan.reason}</div>
          {headSha && (
            <div className="tnum mt-1 font-mono text-sm text-chalk-4">
              tête locale · {headSha.slice(0, 7)}
            </div>
          )}
        </div>
      )}

      <ModeChoice
        value={link.sync_mode}
        onChange={(m) => onChangeMode(m)}
        ownedByViewer={ownedByViewer}
      />

      {/* Les réglages live n'apparaissent que si le mode en a besoin. */}
      {liveEnabled(link.sync_mode) && (
        <div className="border border-line-2 bg-surface-2 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`size-1.5 rounded-full ${liveTone(live?.status)}`} />
            <span className="font-mono text-sm font-bold text-chalk">
              Synchro live
            </span>
            <span className="text-sm text-chalk-4">
              {live ? LIVE_STATUS_TEXT[live.status] : "en veille"}
            </span>
            {live?.lastCheck && (
              <span className="tnum ml-auto font-mono text-sm text-chalk-4">
                {timeAgo(live.lastCheck)}
              </span>
            )}
          </div>

          {live?.message && (
            <p className="mt-1 text-sm leading-snug text-chalk-3">{live.message}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="label-micro text-chalk-3">Cadence</span>
            <div
              role="radiogroup"
              aria-label="Cadence de synchronisation"
              className="flex flex-wrap gap-1"
            >
              {LIVE_INTERVALS.map(({ seconds, label }) => {
                const selected = link.sync_interval_seconds === seconds;
                return (
                  <button
                    key={seconds}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={busy}
                    onClick={() => onChangeInterval(seconds)}
                    className={`h-[var(--h-action)] rounded-[var(--radius-chip)] border px-2
                      font-mono text-sm disabled:opacity-40
                      ${selected
                        ? "border-signal bg-signal/10 text-signal"
                        : "border-line-3 text-chalk-3 hover:border-chalk-3"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => live?.checkNow()}
              disabled={busy}
              className="ml-auto h-[var(--h-action)] rounded-[var(--radius-chip)]
                border border-line-3 px-3 font-mono text-sm font-bold text-chalk-3
                hover:border-chalk-3 disabled:opacity-40"
            >
              Vérifier maintenant
            </button>
          </div>
        </div>
      )}

      <p className="max-w-[62ch] text-sm leading-relaxed text-chalk-4">
        La poussée copie les fichiers de la branche locale vers GitHub. Si GitHub
        a avancé depuis la dernière synchro, elle est refusée — DevNet
        n&apos;écrase pas.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPush}
          disabled={busy || !canPush}
          className="h-[var(--h-action)] rounded-[var(--radius-chip)] border
            border-signal bg-signal px-3 font-mono text-sm font-bold
            tracking-[0.08em] text-void uppercase shadow-sh-1
            disabled:opacity-40"
        >
          Pousser vers GitHub
        </button>
        <button
          type="button"
          onClick={onMarkSynced}
          disabled={busy || !headSha}
          className="h-[var(--h-action)] rounded-[var(--radius-chip)] border
            border-line-2 px-3 font-mono text-sm font-bold tracking-[0.08em]
            text-chalk-3 uppercase transition-colors hover:border-signal hover:text-signal
            disabled:opacity-40"
        >
          Enregistrer la synchro
        </button>
        <button
          type="button"
          onClick={onUnlink}
          disabled={busy}
          className="h-[var(--h-action)] rounded-[var(--radius-chip)] border
            border-line-2 px-3 font-mono text-sm font-bold tracking-[0.08em]
            text-chalk-4 uppercase transition-colors hover:border-danger hover:text-danger
            disabled:opacity-40"
        >
          Délier
        </button>
      </div>
    </div>
  );
}

/**
 * La liste des dépôts du compte connecté, pour lier d'un clic.
 *
 * Elle n'apparaît que si le jeton OAuth existe (le profil a autorisé
 * GitHub). Quand il manque, on ne montre pas un champ mort : on renvoie
 * vers le geste qui le débloque, dans le profil.
 */
function RepoPicker({
  repos,
  error,
  value,
  onPick,
}: {
  repos: GithubRepo[] | null;
  error: ReposError;
  value: string;
  onPick: (fullName: string) => void;
}) {
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    if (!repos) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter((r) => r.full_name.toLowerCase().includes(needle));
  }, [repos, q]);

  if (error === "no-token" || error === "unconfigured") {
    return (
      <p className="mb-3 max-w-[62ch] text-[12px] leading-relaxed text-chalk-3">
        Connecte ton compte GitHub dans{" "}
        <a
          href="/profile?tab=work"
          className="font-bold text-signal-d underline-offset-2 hover:underline"
        >
          ton profil
        </a>{" "}
        pour choisir parmi tes dépôts.
      </p>
    );
  }
  if (error === "no-scope") {
    return (
      <p className="mb-3 text-[12px] text-warn">
        Reconnecte GitHub : le jeton n&apos;a pas le droit de lire tes dépôts.
      </p>
    );
  }
  if (error === "api") {
    return (
      <p className="mb-3 text-[12px] text-danger">
        GitHub n&apos;a pas répondu. Réessaie dans un instant.
      </p>
    );
  }
  if (!repos) {
    return <p className="mb-3 text-[12px] text-chalk-4">Lecture de tes dépôts…</p>;
  }
  if (repos.length === 0) {
    return (
      <p className="mb-3 text-[12px] text-chalk-4">
        Aucun dépôt sur ce compte. Lie par URL ci-dessous.
      </p>
    );
  }

  return (
    <div className="mb-3 rounded-[var(--radius-input)] border border-line-2/60 bg-surface-2">
      <label className="block border-b border-line-2/60 p-2">
        <span className="label-micro mb-1 block text-chalk-3">
          Choisir dans mes dépôts
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrer…"
          className="h-[var(--h-input)] w-full rounded-[var(--radius-input)] border
            border-line-3 bg-surface px-3 font-mono text-[13px] shadow-sh-1
            placeholder:text-chalk-4 focus:shadow-[3px_3px_0_var(--color-signal)]"
        />
      </label>
      <ul className="max-h-60 overflow-auto p-1">
        {list.map((r) => {
          const selected = value.trim() === r.full_name;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r.full_name)}
                className={`flex min-h-[var(--h-tap)] w-full items-center gap-2 rounded-[var(--radius-input)]
                  px-2 py-1.5 text-left transition-colors hover:bg-surface-3
                  ${selected ? "bg-signal/10" : ""}`}
              >
                <span className={`shrink-0 ${selected ? "text-signal" : "text-chalk-4"}`}>
                  <Icon name={selected ? "check" : r.private ? "lock" : "globe"} size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-bold text-chalk">
                  {r.full_name}
                </span>
                {r.language && (
                  <span className="shrink-0 text-sm text-chalk-4">{r.language}</span>
                )}
              </button>
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="px-2 py-3 text-[12px] text-chalk-4">Aucun dépôt ne correspond.</li>
        )}
      </ul>
    </div>
  );
}
