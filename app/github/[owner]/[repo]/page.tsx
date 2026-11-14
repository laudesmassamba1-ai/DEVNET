"use client";

/**
 * Le détail d'un dépôt GitHub, dans DevNet.
 *
 * Trois onglets — code, commits, branches — alimentés par les routes
 * `/api/github/*`. On ne quitte pas l'app : le code se lit ici, et un
 * bouton importe le dépôt comme projet DevNet (fichiers + historique).
 *
 * Aucune donnée DevNet n'est lue par ces routes ; la page ne fait que
 * les appeler et rendre. L'import, lui, écrit dans DevNet — mais par le
 * moteur ordinaire, dans `lib/github/import`, pas depuis une route.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import { importGithubRepo } from "@/lib/github/import";
import {
  GITHUB_ERROR_TEXT,
  fetchRepoBranches,
  fetchRepoCommits,
  fetchRepoDetail,
  fetchRepoFile,
  fetchRepoTree,
  type GithubReadError,
} from "@/lib/github/read";
import type {
  GithubBranchSummary,
  GithubCommitSummary,
  GithubFileContent,
  GithubRepoDetail,
  GithubTreeEntry,
} from "@/lib/types";
import { timeAgo } from "@/lib/utils";

type Tab = "code" | "commits" | "branches";

export default function GithubRepoPage() {
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params?.owner ?? "";
  const repo = params?.repo ?? "";
  const { profile } = useSession();
  const toast = useToast();
  const router = useRouter();

  const [detail, setDetail] = useState<GithubRepoDetail | null>(null);
  const [tree, setTree] = useState<GithubTreeEntry[] | null>(null);
  const [commits, setCommits] = useState<GithubCommitSummary[] | null>(null);
  const [branches, setBranches] = useState<GithubBranchSummary[] | null>(null);
  const [error, setError] = useState<GithubReadError | null>(null);
  const [ref, setRef] = useState("");
  const [tab, setTab] = useState<Tab>("code");
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<GithubFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [d, b] = await Promise.all([
        fetchRepoDetail(owner, repo),
        fetchRepoBranches(owner, repo),
      ]);
      if (!alive) return;
      if (d.error) {
        setError(d.error);
        return;
      }
      setDetail(d.data);
      setBranches(b.data?.branches ?? []);
      setRef(d.data?.default_branch ?? "");
    })();
    return () => {
      alive = false;
    };
  }, [owner, repo]);

  const loadRef = useCallback(
    async (target: string) => {
      const [t, c] = await Promise.all([
        fetchRepoTree(owner, repo, target),
        fetchRepoCommits(owner, repo, target, 40),
      ]);
      setTree(t.data?.entries ?? []);
      setCommits(c.data?.commits ?? []);
      setFile(null);
    },
    [owner, repo],
  );

  useEffect(() => {
    if (!ref) return;
    void (async () => {
      await loadRef(ref);
    })();
  }, [ref, loadRef]);

  async function openFile(entry: GithubTreeEntry) {
    setFileLoading(true);
    const res = await fetchRepoFile(owner, repo, entry.path, ref);
    setFileLoading(false);
    if (res.error) return toast(GITHUB_ERROR_TEXT[res.error], "err");
    setFile(res.data);
  }

  async function importRepo() {
    if (!profile) return;
    setBusy(true);
    const res = await importGithubRepo({
      owner,
      repo,
      branch: ref || undefined,
      owner_: { id: profile.id, prenom: profile.prenom, email: profile.email ?? "" },
      language: detail?.language ?? undefined,
    });
    setBusy(false);
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

  const blobs = useMemo(() => (tree ?? []).filter((e) => e.type === "blob"), [tree]);

  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? blobs.filter((b) => b.path.toLowerCase().includes(q)) : blobs;
  }, [blobs, query]);

  if (error) {
    return (
      <AppShell title={repo || "Dépôt"} path={`~/github/${owner}/${repo}`}>
        <div className="px-(--gutter) pt-8">
          <EmptyState
            title="Dépôt indisponible"
            hint={GITHUB_ERROR_TEXT[error]}
            icon={<Icon name="lock" size={20} />}
            action={
              <Link
                href="/github"
                className="h-(--h-input) rounded-(--radius-chip) border
                  border-line-3 bg-surface px-4 font-mono text-12 font-bold
                  tracking-[0.1em] text-chalk uppercase shadow-sh-1"
              >
                Retour
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={detail ? detail.full_name : `${owner}/${repo}`}
      path={`~/github/${owner}/${repo}`}
      action={
        <button
          type="button"
          onClick={() => void importRepo()}
          disabled={busy || !profile || !detail}
          className="h-(--h-input) rounded-(--radius-chip) border
            border-signal bg-signal px-3.5 font-mono text-12 font-bold
            tracking-[0.1em] text-void uppercase shadow-sh-1 disabled:opacity-40"
        >
          {busy ? "Import…" : "Importer"}
        </button>
      }
    >
      <div className="px-(--gutter) pt-3 pb-6">
        {/* ── En-tête du dépôt ── */}
        {!detail ? (
          <Loading label="Lecture du dépôt" />
        ) : (
          <section className="mb-4 rounded-(--radius-card) border border-line-2/60 bg-surface p-4">
            <div className="flex items-center gap-2">
              <Icon
                name={detail.private ? "lock" : "globe"}
                size={12}
                className="text-chalk-4"
              />
              <h2 className="truncate font-mono text-14 font-bold text-chalk">
                {detail.full_name}
              </h2>
            </div>
            {detail.description && (
              <p className="mt-1.5 text-sm leading-relaxed text-chalk-2">
                {detail.description}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2
              font-mono text-12 tracking-[0.06em] text-chalk-4 uppercase">
              {detail.language && (
                <span className="flex items-center gap-1">
                  <Icon name="code" size={11} /> {detail.language}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Icon name="star" size={11} /> {detail.stargazers_count}
              </span>
              <span className="flex items-center gap-1">
                <Icon name="fork" size={11} /> {detail.forks_count}
              </span>
              {detail.license && <span>{detail.license}</span>}
              {detail.updated_at && <span>modifié {timeAgo(detail.updated_at)}</span>}
            </div>
            {detail.homepage && (
              <a
                href={detail.homepage.startsWith("http") ? detail.homepage : `https://${detail.homepage}`}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-flex items-center gap-1 font-mono text-12 text-signal hover:underline"
              >
                <Icon name="link" size={11} /> {detail.homepage}
              </a>
            )}
          </section>
        )}

        {/* ── Sélecteur de référence + onglets ── */}
        <div className="mb-3 flex items-center gap-2">
          {branches && branches.length > 0 && (
            <label className="relative flex-1">
              <Icon
                name="branch"
                size={12}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-chalk-4"
              />
              <select
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                className="h-(--h-input) w-full appearance-none rounded-(--radius-input)
                  border border-line-3 bg-surface pr-3 pl-8 font-mono text-sm
                  text-chalk shadow-sh-1 focus:shadow-[3px_3px_0_var(--color-signal)]"
              >
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div role="tablist" className="mb-3 flex gap-1 border-b border-line-3">
          {(
            [
              ["code", "Code"],
              ["commits", "Commits"],
              ["branches", "Branches"],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`-mb-px border-b-2 px-3 py-2 font-mono text-12 font-bold
                tracking-[0.08em] uppercase transition-colors ${
                  tab === value
                    ? "border-signal text-signal"
                    : "border-transparent text-chalk-3 hover:text-chalk"
                }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Code ── */}
        {tab === "code" && (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div>
              <label className="relative mb-2 block">
                <Icon
                  name="search"
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-chalk-4"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filtrer les fichiers"
                  className="h-(--h-input) w-full rounded-(--radius-input)
                    border border-line-3 bg-surface pr-3 pl-8 font-mono text-12
                    shadow-sh-1 placeholder:text-chalk-4
                    focus:shadow-[3px_3px_0_var(--color-signal)]"
                />
              </label>
              {tree === null ? (
                <Loading label="Lecture de l'arbre" />
              ) : visibleFiles.length === 0 ? (
                <p className="px-1 py-3 text-12 text-chalk-3">Aucun fichier.</p>
              ) : (
                <ul className="max-h-[60vh] overflow-y-auto rounded-(--radius-card)
                  border border-line-2/60 bg-surface">
                  {visibleFiles.map((entry) => {
                    const slash = entry.path.lastIndexOf("/");
                    const dir = slash === -1 ? "" : entry.path.slice(0, slash + 1);
                    const name = slash === -1 ? entry.path : entry.path.slice(slash + 1);
                    const active = file?.path === entry.path;
                    return (
                      <li key={entry.path}>
                        <button
                          type="button"
                          onClick={() => void openFile(entry)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left
                            font-mono text-12 transition-colors ${
                              active
                                ? "bg-surface-2 text-signal"
                                : "text-chalk-2 hover:bg-surface-2/60 hover:text-chalk"
                            }`}
                        >
                          <Icon name="file" size={11} className="shrink-0 text-chalk-4" />
                          <span className="truncate">
                            {dir && <span className="text-chalk-4">{dir}</span>}
                            <span>{name}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="min-w-0 rounded-(--radius-card) border border-line-2/60 bg-surface">
              {fileLoading ? (
                <Loading label="Lecture du fichier" />
              ) : !file ? (
                <p className="px-4 py-8 text-center text-12 text-chalk-3">
                  Choisissez un fichier pour le lire.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 border-b border-line-3 px-3.5 py-2">
                    <span className="truncate font-mono text-12 text-chalk">
                      {file.path}
                    </span>
                    <span className="shrink-0 font-mono text-12 text-chalk-4">
                      {file.size} o
                    </span>
                  </div>
                  {file.truncated ? (
                    <p className="px-4 py-8 text-center text-12 text-warn">
                      Fichier binaire ou trop volumineux — contenu non affiché.
                    </p>
                  ) : (
                    <pre className="max-h-[60vh] overflow-auto px-4 py-3 font-mono text-12
                      leading-relaxed text-chalk-2">
                      {file.content}
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Commits ── */}
        {tab === "commits" && (
          <div>
            {commits === null ? (
              <Loading label="Lecture des commits" />
            ) : commits.length === 0 ? (
              <EmptyState title="Aucun commit" icon={<Icon name="hash" size={20} />} />
            ) : (
              <ul className="flex flex-col gap-2">
                {commits.map((c) => (
                  <li
                    key={c.sha}
                    className="rounded-(--radius-card) border border-line-2/60 bg-surface p-3.5"
                  >
                    <p className="line-clamp-2 text-13 leading-relaxed text-chalk">
                      {c.message.split("\n")[0]}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1
                      font-mono text-12 tracking-[0.06em] text-chalk-4 uppercase">
                      <span className="text-signal-d">{c.sha.slice(0, 7)}</span>
                      {c.author_name && <span>{c.author_name}</span>}
                      {c.date && <span>{timeAgo(c.date)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Branches ── */}
        {tab === "branches" && (
          <div>
            {!branches ? (
              <Loading label="Lecture des branches" />
            ) : branches.length === 0 ? (
              <EmptyState title="Aucune branche" icon={<Icon name="branch" size={20} />} />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {branches.map((b) => (
                  <li
                    key={b.name}
                    className="flex items-center justify-between gap-3 rounded-(--radius-input)
                      border border-line-2/60 bg-surface px-3.5 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2 font-mono text-sm text-chalk">
                      <Icon name="branch" size={12} className="text-chalk-4" />
                      <span className="truncate">{b.name}</span>
                      {b.name === ref && (
                        <span className="shrink-0 rounded-(--radius-chip) border
                          border-signal/40 px-1.5 py-0.5 font-mono text-12
                          tracking-[0.08em] text-signal uppercase">
                          affichée
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-12 text-chalk-4">
                      {b.sha.slice(0, 7)}
                    </span>
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
