"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { ProjectCard } from "@/components/ProjectCard";
import { ScoreTrajectory } from "@/components/ScoreTrajectory";
import { useToast } from "@/components/Toast";
import {
  fetchProjectsByUser,
  summarizeRepoScores,
  type ProjectCard as ProjectCardData,
  type RepoScoreSummary,
} from "@/lib/repo";
import {
  connectGithub,
  disconnectGithub,
  fetchConnection,
} from "@/lib/github/connect";
import { api } from "@/lib/api/client";
import { isDemoMode } from "@/lib/backend";
import type { Group, GroupRole, GithubConnection, GithubRepo } from "@/lib/types";

type WorkGroup = Group & { role: GroupRole };
type RepositoryLink = { project_id: string; owner: string; repo: string };

const ROLE_LABEL: Record<GroupRole, string> = {
  owner: "créateur",
  moderator: "modérateur",
  member: "membre",
};

/**
 * Les dépôts du compte GitHub connecté, pour les montrer là où l'on
 * vient de connecter — un lien vers GitHub suffit à promettre des
 * dépôts, une liste les montre. Renvoie `null` quand il n'y a pas de
 * jeton ou que GitHub ne répond pas : l'écran retombe alors sur le lien.
 */
async function fetchRepos(): Promise<GithubRepo[] | null> {
  try {
    const res = await fetch("/api/github/repos", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { repos?: GithubRepo[] } | null;
    return data?.repos ?? null;
  } catch {
    return null;
  }
}

export function ProfileWorkPanel({
  profileId,
  xp,
  levelTitle,
}: {
  profileId: string;
  /** Score de progression, si la page le connaît déjà. */
  xp?: number;
  /** Palier atteint, pour ne pas recalculer le niveau ici. */
  levelTitle?: string;
}) {
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectCardData[] | null>(null);
  const [groups, setGroups] = useState<WorkGroup[] | null>(null);
  const [repositories, setRepositories] = useState<Map<string, RepositoryLink>>(new Map());
  const [scores, setScores] = useState<RepoScoreSummary | null>(null);
  const [connection, setConnection] = useState<GithubConnection | null | undefined>(undefined);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      const params = new URLSearchParams(window.location.search);
      const outcome = params.get("gh");
      let github: GithubConnection | null;

      if (outcome) {
        window.history.replaceState(window.history.state, "", "/profile?tab=work");
      }

      if (outcome === "ok") {
        const callbackUser = params.get("u");

        if (callbackUser !== profileId) {
          toast("Connexion GitHub non associée à ce compte", "err");
          github = await fetchConnection(profileId);
        } else {
          const response = await fetch("/api/github/identity", { cache: "no-store" });
          const identity = (await response.json().catch(() => null)) as { login?: string } | null;
          if (!response.ok || !identity?.login) {
            toast("Identité GitHub impossible à vérifier", "err");
            github = await fetchConnection(profileId);
          } else {
            const saved = await connectGithub(profileId, identity.login);
            github = saved.connection;
            if (saved.error) toast("Connexion GitHub impossible", "err");
            else toast(`GitHub connecté : @${identity.login}`);
          }
        }
      } else {
        github = await fetchConnection(profileId);
        if (outcome === "denied") toast("Connexion GitHub annulée", "err");
        if (outcome === "failed" || outcome === "state") {
          toast("Échange GitHub échoué. Réessaie.", "err");
        }
        if (outcome === "unconfigured") {
          toast("Configure OAuth GitHub dans .env.local", "err");
        }
      }

      const [userProjects, memberships] = await Promise.all([
        fetchProjectsByUser(profileId),
        api
          .from("group_members")
          .select("group_id, role")
          .eq("user_id", profileId),
      ]);

      // En démonstration, la « connexion » est une ligne de la boutique
      // locale : aucun jeton GitHub côté serveur, la route répondrait un
      // 401 que Chromium consignerait dans la console. On ne demande pas.
      const repoList = github && !isDemoMode() ? await fetchRepos() : null;

      const memberRows = (memberships.data as { group_id: string; role: GroupRole }[] | null) ?? [];
      const groupIds = memberRows.map((member) => member.group_id);
      const projectIds = userProjects.map((project) => project.id);

      const [groupResult, repositoryResult, scoreSummary] = await Promise.all([
        groupIds.length
          ? api.from("groups").select("*").in("id", groupIds)
          : Promise.resolve({ data: [] }),
        projectIds.length
          ? api
              .from("project_links")
              .select("project_id, owner, repo")
              .in("project_id", projectIds)
          : Promise.resolve({ data: [] }),
        summarizeRepoScores(userProjects),
      ]);

      if (!alive) return;

      const roles = new Map(memberRows.map((member) => [member.group_id, member.role]));
      const workGroups = ((groupResult.data as Group[] | null) ?? [])
        .map((group) => ({ ...group, role: roles.get(group.id) ?? "member" as GroupRole }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));

      setProjects(userProjects);
      setGroups(workGroups);
      setScores(scoreSummary);
      setRepositories(
        new Map(
          ((repositoryResult.data as RepositoryLink[] | null) ?? [])
            .map((repository) => [repository.project_id, repository]),
        ),
      );
      setRepos(repoList);
      setConnection(github);
    }

    void load().catch(() => {
      if (!alive) return;
      setProjects([]);
      setGroups([]);
      setConnection(null);
      toast("Espace de travail indisponible", "err");
    });

    return () => {
      alive = false;
    };
  }, [profileId, toast]);

  function startGithubOAuth() {
    const params = new URLSearchParams({
      u: profileId,
      next: "/profile?tab=work",
    });
    // Destination d'API OAuth (302 vers github.com) : navigation
    // top-level pour que le Set-Cookie du jeton passe, pas un fetch SPA.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/github/authorize?${params.toString()}`);
  }

  async function disconnect() {
    if (!connection) return;
    setDisconnecting(true);
    const result = await disconnectGithub(connection.id);
    setDisconnecting(false);
    if (result.error) return toast("Déconnexion GitHub impossible", "err");
    setConnection(null);
    setRepos(null);
    toast("GitHub déconnecté");
  }

  return (
    <div className="space-y-6 py-4">
      {/* Ce que le profil vaut, puis ce qu'il a construit : on pose le
          verdict avant les preuves qui l'expliquent. */}
      <section
        aria-labelledby="profile-score-title"
        className="border-b border-line-2 pb-4"
      >
        <p className="label-micro text-signal-d">00 / SCORE</p>
        <h2
          id="profile-score-title"
          className="mt-1 font-display text-[17px] font-bold"
        >
          Score &amp; niveau
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
            <div className="label-micro text-chalk-4">XP</div>
            <div className="tnum mt-1 font-display text-[1.1rem] font-bold leading-none text-signal">
              {xp ?? 0}
            </div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
            <div className="label-micro text-chalk-4">Niveau</div>
            <div className="mt-1 text-[12px] font-bold text-signal">
              {levelTitle ?? "Nouveau"}
            </div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
            <div className="label-micro text-chalk-4">Score moyen</div>
            <div className="tnum mt-1 font-display text-[1.1rem] font-bold leading-none text-chalk">
              {scores?.average ?? 0}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-chalk-4">
              {scores && scores.count > 0
                ? `sur ${scores.count} dépôt${scores.count > 1 ? "s" : ""}`
                : "aucun dépôt"}
            </div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
            <div className="label-micro text-chalk-4">Meilleur score</div>
            <div className="tnum mt-1 font-display text-[1.1rem] font-bold leading-none text-chalk">
              {scores?.best ?? 0}
            </div>
          </div>
        </div>

        {/* La moyenne dit où en est le travail ; la trajectoire dit d'où il
            vient. C'est la même lecture que la courbe d'un dépôt, appliquée
            à l'ensemble des dépôts — et le tri est celui de la dernière
            activité, donc celui du travail. */}
        {scores && (
          <div className="mt-3">
            <ScoreTrajectory series={scores.series} stats={scores.trajectory} />
          </div>
        )}
      </section>

      <section aria-labelledby="profile-projects-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="label-micro text-signal-d">01 / DÉPÔTS</p>
            <h2 id="profile-projects-title" className="mt-1 font-display text-[17px] font-bold">
              Projets
            </h2>
          </div>
          <Link
            href="/projects"
            className="inline-flex h-[var(--h-action)] items-center gap-1.5 border border-line-2
              px-2.5 font-mono text-[11px] font-bold text-chalk-2 transition-colors
              hover:border-signal-d hover:text-signal-d"
          >
            <Icon name="plus" size={12} />
            Nouveau
          </Link>
        </div>

        {projects === null ? (
          <Loading label="Lecture des projets" />
        ) : projects.length === 0 ? (
          <p className="border-t border-line-2 py-3 text-sm text-chalk-3">
            Aucun dépôt DevNet pour le moment.
          </p>
        ) : (
          <div>
            {projects.map((project, index) => {
              const repository = repositories.get(project.id);
              return (
                <div key={project.id}>
                  <ProjectCard project={project} index={index} />
                  {repository && (
                    <a
                      href={`https://github.com/${repository.owner}/${repository.repo}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-3 ml-3 inline-flex h-6 items-center gap-1.5 font-mono text-[11px]
                        text-signal-d hover:underline"
                    >
                      <Icon name="code" size={11} />
                      {repository.owner}/{repository.repo}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="profile-groups-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="label-micro text-signal-d">02 / ÉQUIPE</p>
            <h2 id="profile-groups-title" className="mt-1 font-display text-[17px] font-bold">
              Groupes de travail
            </h2>
          </div>
          <Link
            href="/groups"
            className="inline-flex h-[var(--h-action)] items-center gap-1.5 border border-line-2
              px-2.5 font-mono text-[11px] font-bold text-chalk-2 transition-colors
              hover:border-signal-d hover:text-signal-d"
          >
            Explorer
          </Link>
        </div>

        {groups === null ? (
          <Loading label="Lecture des groupes" />
        ) : groups.length === 0 ? (
          <p className="border-t border-line-2 py-3 text-sm text-chalk-3">
            Aucun groupe rejoint.
          </p>
        ) : (
          <ul className="divide-y divide-line-2 border-y border-line-2">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="flex min-h-[52px] items-center gap-3 py-2.5 transition-colors
                    hover:text-signal-d"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center border border-line-2
                    bg-surface-2 text-signal-d">
                    <Icon name="groups" size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{group.name}</span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-chalk-3">
                      {group.member_count} membres · {ROLE_LABEL[group.role]}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={14} className="text-chalk-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="profile-github-title" className="border-t border-line-2 pt-4">
        <div className="mb-3">
          <p className="label-micro text-signal-d">03 / IDENTITÉ DE CODE</p>
          <h2 id="profile-github-title" className="mt-1 font-display text-[17px] font-bold">
            GitHub
          </h2>
          <p className="mt-1 text-sm leading-[1.5] text-chalk-3">
            Relie ton compte GitHub pour rattacher tes dépôts publics à ton profil et montrer ton travail réel.
          </p>
        </div>

        {connection === undefined ? (
          <Loading label="Lecture de la connexion GitHub" />
        ) : connection ? (
          <div className="border-y border-line-2 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={connection.login} color="av-sage" size="sm" />
              <a
                href={`https://github.com/${connection.login}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 min-w-0 flex-1 items-center font-mono text-[12px] font-bold text-signal-d hover:underline"
              >
                @{connection.login}
              </a>
              <a
                href={`https://github.com/${connection.login}?tab=repositories`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 items-center font-mono text-[10.5px] font-bold text-chalk-3 hover:text-signal-d"
              >
                {repos ? `${repos.length} dépôts` : "Dépôts"}
              </a>
              <button
                type="button"
                disabled={disconnecting}
                onClick={() => void disconnect()}
                className="inline-flex h-6 items-center font-mono text-[10.5px] font-bold text-danger disabled:opacity-50"
              >
                {disconnecting ? "…" : "Déconnecter"}
              </button>
            </div>
            {repos && repos.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {repos.slice(0, 8).map((repo) => (
                  <li key={repo.id}>
                    <a
                      href={repo.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-6 items-center gap-1.5 border border-line-2 bg-surface-2
                        px-2 font-mono text-[11px] text-chalk-2 transition-colors
                        hover:border-signal-d hover:text-signal-d"
                    >
                      <Icon
                        name={repo.private ? "lock" : "code"}
                        size={11}
                        className="text-chalk-4"
                      />
                      {repo.name}
                    </a>
                  </li>
                ))}
                {repos.length > 8 && (
                  <li className="inline-flex items-center px-1 font-mono text-[11px] text-chalk-4">
                    +{repos.length - 8}
                  </li>
                )}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line-2 py-3">
            <p className="text-sm text-chalk-3">
              Relie tes dépôts à tes projets.
            </p>
            <button
              type="button"
              onClick={startGithubOAuth}
              className="inline-flex h-[var(--h-tap)] items-center gap-2 border border-signal-d
                bg-signal px-3.5 font-mono text-[11px] font-bold text-void transition-colors
                hover:bg-signal-d"
            >
              <Icon name="code" size={14} />
              Connecter GitHub
            </button>
          </div>
        )}
      </section>
    </div>
  );
}