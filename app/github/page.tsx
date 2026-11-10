"use client";

/**
 * L'espace GitHub : les dépôts du compte connecté, dans l'app.
 *
 * On ne renvoie pas l'utilisateur vers github.com pour choisir un dépôt :
 * la liste est lue par la route `/api/github/repos`, et chaque ligne
 * mène à `/github/[owner]/[repo]` — un écran DevNet qui montre le code,
 * les commits et les branches. C'est le point d'entrée de « copier vers
 * DevNet » : un dépôt peut y être importé comme projet, fichiers et
 * historique compris.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell, IconButton } from "@/components/AppShell";
import { EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import { isDemoMode } from "@/lib/backend";
import { useSession } from "@/hooks/useSession";
import { importGithubRepo } from "@/lib/github/import";
import { GITHUB_ERROR_TEXT, type GithubReadError } from "@/lib/github/read";
import type { GithubRepo } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

export default function GithubPage() {
  const { profile } = useSession();
  const toast = useToast();
  const router = useRouter();

  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [error, setError] = useState<GithubReadError | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    setReloading(true);
    try {
      // En démonstration, aucun jeton GitHub côté serveur : la demande
      // reviendrait en 401 — un bruit de console qui ne dit rien à l'écran.
      if (isDemoMode()) {
        setError("no-token");
        setRepos(null);
        return;
      }
      const res = await fetch("/api/github/repos", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | { repos?: GithubRepo[]; error?: string }
        | null;
      if (!res.ok) {
        setError((body?.error as GithubReadError) ?? "api");
        setRepos(null);
        return;
      }
      setError(null);
      setRepos(body?.repos ?? []);
    } catch {
      setError("api");
      setRepos(null);
    } finally {
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  function connect() {
    if (!profile) return;
    const params = new URLSearchParams({ u: profile.id, next: "/github" });
    // `/api/github/authorize` répond en 302 vers github.com : la
    // navigation doit donc être top-level, le jeton arrive sur Set-Cookie
    // d'une réponse de navigation. `router.push` la ferait en fetch SPA.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/github/authorize?${params.toString()}`);
  }

  async function importRepo(repo: GithubRepo) {
    if (!profile) return;
    setBusy(repo.full_name);
    const res = await importGithubRepo({
      owner: repo.owner,
      repo: repo.name,
      owner_: { id: profile.id, prenom: profile.prenom, email: profile.email ?? "" },
      language: repo.language ?? undefined,
    });
    setBusy(null);

    if (res.error) {
      const known = (GITHUB_ERROR_TEXT as Record<string, string>)[res.error];
      return toast(`Import : ${known ?? res.error}`, "err");
    }
    toast(
      res.truncated
        ? `Importé — ${res.imported} commit(s), historique tronqué`
        : `Importé — ${res.imported} commit(s)`,
    );
    if (res.project) router.push(`/projects/${res.project.id}`);
  }

  const q = query.trim().toLowerCase();
  const visible = (repos ?? []).filter(
    (r) =>
      !q
      || r.full_name.toLowerCase().includes(q)
      || (r.description ?? "").toLowerCase().includes(q)
      || (r.language ?? "").toLowerCase().includes(q),
  );

  // Un jeton absent, révoqué ou sans le scope `repo` demande de
  // reconnecter GitHub ; tout le reste (panne réseau, limite de débit)
  // se répare en réessayant.
  const needsConnect = error === "no-token" || error === "no-scope";

  return (
    <AppShell
      title="GitHub"
      path="~/github"
      action={
        <IconButton
          label="Rafraîchir"
          name="spark"
          dataTour="github-refresh"
          onClick={() => void load()}
        />
      }
    >
      <div className="px-(--gutter) pt-3">
        <div className="mb-4 rounded-[var(--radius-input)] border border-line-3 bg-surface-2 px-3.5 py-3
          text-[12px] leading-relaxed text-chalk-2">
          Vos dépôts GitHub, <span className="font-bold text-chalk">sans quitter DevNet</span> :
          parcourez le code, les commits et les branches, puis <span className="font-bold text-chalk">
          copiez un dépôt vers un projet</span> — fichiers et historique.
        </div>

        {repos === null && !error ? (
          <Loading label="Lecture de vos dépôts GitHub" />
        ) : error ? (
          <div className="pt-6">
            <EmptyState
              title="Dépôts indisponibles"
              hint={GITHUB_ERROR_TEXT[error]}
              icon={<Icon name={needsConnect ? "lock" : "globe"} size={20} />}
              action={
                needsConnect ? (
                  <button
                    type="button"
                    onClick={connect}
                    className="h-[var(--h-input)] rounded-[var(--radius-chip)] border
                      border-signal bg-signal px-4 font-mono text-[12px] font-bold
                      tracking-[0.1em] text-void uppercase shadow-sh-1"
                  >
                    Connecter GitHub
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="h-[var(--h-input)] rounded-[var(--radius-chip)] border
                      border-line-3 bg-surface px-4 font-mono text-[12px] font-bold
                      tracking-[0.1em] text-chalk uppercase shadow-sh-1"
                  >
                    Réessayer
                  </button>
                )
              }
            />
          </div>
        ) : (
          <div data-tour="github-list">
            <label className="relative mb-3 block">
              <Icon
                name="search"
                size={14}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-chalk-4"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrer vos dépôts"
                className="h-[var(--h-input)] w-full rounded-[var(--radius-input)]
                  border border-line-3 bg-surface pr-3 pl-9 font-mono text-[13px]
                  shadow-sh-1 placeholder:text-chalk-4
                  focus:shadow-[3px_3px_0_var(--color-signal)]"
              />
            </label>

            {reloading && (
              <p className="mb-2 font-mono text-[10.5px] tracking-[0.08em] text-chalk-4 uppercase">
                Actualisation…
              </p>
            )}

            {visible.length === 0 ? (
              <EmptyState
                title="Aucun dépôt"
                hint={query ? "Aucun dépôt ne correspond au filtre." : "Votre compte n'a aucun dépôt lisible."}
                icon={<Icon name="globe" size={20} />}
              />
            ) : (
              <ul className="flex flex-col gap-2 pb-4">
                {visible.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-[var(--radius-card)] border border-line-2/60 bg-surface p-3.5"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/github/${r.owner}/${r.name}`}
                          className="group flex items-center gap-1.5"
                        >
                          <Icon
                            name={r.private ? "lock" : "globe"}
                            size={12}
                            className="shrink-0 text-chalk-4"
                          />
                          <span className="truncate font-mono text-[13px] font-bold text-chalk group-hover:text-signal">
                            {r.full_name}
                          </span>
                        </Link>
                        {r.description && (
                          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-chalk-3">
                            {r.description}
                          </p>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1
                          font-mono text-[10.5px] tracking-[0.06em] text-chalk-4 uppercase">
                          {r.language && <span>{r.language}</span>}
                          {r.pushed_at && <span>poussé {timeAgo(r.pushed_at)}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void importRepo(r)}
                        disabled={busy !== null || !profile}
                        className="h-[var(--h-input)] shrink-0 rounded-[var(--radius-chip)]
                          border border-signal bg-signal px-3 font-mono text-[11px]
                          font-bold tracking-[0.1em] text-void uppercase shadow-sh-1
                          disabled:opacity-40"
                      >
                        {busy === r.full_name ? "Import…" : "Importer"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
