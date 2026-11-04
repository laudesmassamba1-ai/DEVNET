"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar, EmptyState, Loading } from "@/components/Avatar";
import { CommentsPanel } from "@/components/CommentsPanel";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { PostCard } from "@/components/PostCard";
import { ProjectCard } from "@/components/ProjectCard";
import { ProofPanel } from "@/components/ProofPanel";
import { PostOwnerTools } from "@/components/PostOwnerTools";
import { FollowButton } from "@/components/FollowButton";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { badgeFor } from "@/lib/verification";
import { ReportButton } from "@/components/ReportButton";
import { usePostActions } from "@/hooks/usePostActions";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import {
  fetchLikedPostIds, fetchProfileByPseudo, isFollowing,
  toggleLike, type FollowListKind,
} from "@/lib/social";
import {
  EMPTY_SCORE_SUMMARY,
  fetchProjectsByUser,
  fetchProjectsForPosts,
  summarizeRepoScores,
  type ProjectCard as ProjectCardData,
  type RepoScoreSummary,
} from "@/lib/repo";
import { ScoreTrajectory } from "@/components/ScoreTrajectory";
import { loadProofsForUser, replayUserProofs } from "@/lib/reputation";
import { loadProgress, type Progress } from "@/lib/progress";
import { fetchConnection } from "@/lib/github/connect";
import { levelFor } from "@/lib/gamification";
import type { Proof } from "@/lib/proofs";
import type {
  GithubConnection, PostWithAuthor, PublicGithubRepo, PublicProfile,
} from "@/lib/types";

/**
 * Onglets du profil public.
 *
 * « Preuves » est en tête, avant les publications et les projets. Ce n'est
 * pas un détail d'ordre : c'est l'onglet qui répond à la question pour
 * laquelle on ouvre un profil de développeur — qu'a-t-il **prouvé** — et
 * la vision en fait l'objet central du produit.
 */
type ProfileTab = "preuves" | "posts" | "projects";

/**
 * Profil public — `/u/[pseudo]`.
 *
 * Cette route est appelée depuis le fil, le profil et les groupes depuis
 * le début : elle n'existait pas, donc chaque clic sur un avatar menait à
 * une 404. C'est la pièce qui manquait pour que l'application ne soit pas
 * fermée sur elle-même — on peut lire un profil, suivre, et écrire.
 *
 * Le chemin est un **pseudo** et pas un identifiant : un pseudo est
 * lisible, partageable et stable. Exposer `u-8f3c-…` dans une URL
 * obligerait à copier une chaîne illisible.
 */

export default function PublicProfilePage({
  params,
}: {
  params: Promise<{ pseudo: string }>;
}) {
  const { pseudo } = use(params);
  const { profile } = useSession();
  const router = useRouter();
  const toast = useToast();

  const [user, setUser] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<PostWithAuthor[] | null>(null);
  const [likedIds, setLikedIds] = useState<string[]>([]);
  const [following, setFollowing] = useState<boolean | undefined>(undefined);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  /** Onglet affiché : publications ou projets. */
  const [tab, setTab] = useState<ProfileTab>("preuves");
  /** Projets du profil, lus avec le profil et non à l'ouverture de l'onglet. */
  const [projects, setProjects] = useState<ProjectCardData[] | null>(null);
  const [publicProgress, setPublicProgress] = useState<Progress | null>(null);
  /** Connexion GitHub : l'axe de crédibilité « ce code est réel ». */
  const [github, setGithub] = useState<GithubConnection | null>(null);
  /**
   * Les dépôts **publics** du compte GitHub relié, indexés par login.
   *
   * On range le login avec la liste plutôt qu'un simple tableau : c'est
   * lui qui dit si la liste appartient encore au profil affiché. Un
   * profil en remplace un autre sans que `load()` ait à tout vider, et une
   * liste de l'ancien compte ne s'affiche pas sous le nouveau.
   */
  const [publicRepos, setPublicRepos] = useState<{
    login: string;
    repos: PublicGithubRepo[];
    /** L'appel a échoué (limite de débit) : à distinguer d'une vraie liste vide. */
    failed: boolean;
  } | null>(null);
  /** Synthèse des scores des dépôts — moyenne, meilleur, analysables, trajectoire. */
  const [projectScoreSummary, setProjectScoreSummary] =
    useState<RepoScoreSummary>(EMPTY_SCORE_SUMMARY);
  /** Projet de chaque publication, lu en une requête. */
  const [postProjects, setPostProjects] = useState<
    Map<string, { id: string; name: string; emoji: string }>
  >(new Map());
  /** Preuves de la personne, lues à l'ouverture de l'onglet. */
  const [proofs, setProofs] = useState<Proof[] | null>(null);
  const [loadingProofs, setLoadingProofs] = useState(false);

  const isMe = profile?.id === user?.id;
  const xpLevel = publicProgress ? levelFor(publicProgress.stats.xp) : null;

  /** Compteur affiché par onglet — absent tant que la donnée n'est pas lue. */
  const tabCounts: Partial<Record<ProfileTab, number>> = {
    posts: posts?.length,
    projects: projects?.length,
    preuves: proofs?.length,
  };

  const load = useCallback(async () => {
    const found = await fetchProfileByPseudo(pseudo);
    setUser(found.user);
    setPosts(found.posts);
    setMissing(found.user === null);

    if (profile) {
      setLikedIds(await fetchLikedPostIds(profile.id, found.posts.map((p) => p.id)));
      if (found.user) {
        setFollowing(undefined);
        setFollowing(await isFollowing(profile.id, found.user.id));
      } else {
        setFollowing(undefined);
      }
    } else {
      setFollowing(undefined);
    }

    // L'en-tête annonce XP, niveau, nombre de dépôts, score moyen et
    // GitHub : ces chiffres se lisent donc avec le profil, en parallèle.
    // Un bandeau qui affiche « 0 dépôt » le temps d'un clic est un bandeau
    // faux — il faut le payer une fois, pas le laisser mentir.
    if (found.user) {
      const [snapshot, ownedProjects, github] = await Promise.all([
        loadProgress(found.user),
        fetchProjectsByUser(found.user.id),
        fetchConnection(found.user.id),
      ]);
      setPublicProgress(snapshot);
      setProjects(ownedProjects);
      setGithub(github);
      setProjectScoreSummary(await summarizeRepoScores(ownedProjects));
    } else {
      setPublicProgress(null);
      setProjects([]);
      setGithub(null);
      setProjectScoreSummary(EMPTY_SCORE_SUMMARY);
    }

    const postProjects = await fetchProjectsForPosts(found.posts.map((p) => p.id));
    setPostProjects(
      new Map(
        [...postProjects].map(([postId, p]) => [
          postId,
          { id: p.id, name: p.name, emoji: p.emoji },
        ]),
      ),
    );
  }, [pseudo, profile]);

  // Les preuves se lisent à l'ouverture de l'onglet, pas à l'ouverture du
  // profil : on ne paie pas une requête pour une section que le lecteur ne
  // regarde pas.
  useEffect(() => {
    if (tab !== "preuves" || !user || proofs !== null) return;

    let alive = true;
    void (async () => {
      setLoadingProofs(true);
      const rows = await loadProofsForUser(user.id);
      if (!alive) return;
      setProofs(rows);
      setLoadingProofs(false);
    })();

    return () => {
      alive = false;
    };
  }, [tab, user, proofs]);

  // Les dépôts GitHub publics suivent la même règle : à l'ouverture de
  // l'onglet Projets, et **une seule fois par login**. L'appel est
  // anonyme, donc borné à 60 par heure et par IP — le payer à chaque
  // visite de profil viderait la quota avant même la démo.
  useEffect(() => {
    const login = github?.login ?? null;
    if (tab !== "projects" || !login || publicRepos?.login === login) return;

    let alive = true;

    void fetch(`/api/github/users/${encodeURIComponent(login)}/repos`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { repos?: PublicGithubRepo[] }
          | null;
        if (!res.ok || !Array.isArray(body?.repos)) {
          return { repos: [] as PublicGithubRepo[], failed: true };
        }
        return { repos: body.repos, failed: false };
      })
      .catch(() => ({ repos: [] as PublicGithubRepo[], failed: true }))
      .then((result) => {
        if (!alive) return;
        setPublicRepos({ login, ...result });
      });

    return () => {
      alive = false;
    };
  }, [tab, github, publicRepos]);

  // Même logique que dans le fil, pour les mêmes raisons : après une
  // suppression, le profil est relu — le serveur a fait tomber les
  // commentaires et les likes avec le post — ; après une modification,
  // seule la ligne concernée bouge, pour que le profil ne se recharge
  // pas sous les yeux du lecteur.
  const postActions = usePostActions({
    meId: profile?.id,
    onDeleted: load,
    onUpdated: (postId, text) =>
      setPosts((prev) =>
        prev === null ? prev : prev.map((p) => (p.id === postId ? { ...p, text } : p)),
      ),
  });

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  /**
   * Ouvrir une conversation.
   *
   * On passe par `messages`, qui sait déjà créer ou rouvrir la
   * conversation : dupliquer cette logique ici créerait deux endroits
   * où décider de l'identifiant de conversation — donc deux endroits
   * où se tromper.
   */
  function openConversation() {
    if (!user) return;
    router.push(`/messages?to=${encodeURIComponent(user.pseudo)}`);
  }

  if (missing) {
    return (
      <AppShell path={`~/u/${pseudo}`}>
        <EmptyState
          title="Profil introuvable"
          hint={`Aucun compte : « ${pseudo} ».`}
        />
      </AppShell>
    );
  }
  // Le chemin `~/u/<pseudo>` redirait le titre `~/<pseudo>` du bandeau :
  // la ligne d'état se tait plutôt que de répéter l'identité.
  return (
    <AppShell title={user ? `~/${user.pseudo}` : "profil"}>
      {/* ── En-tête : l'identité, puis les actions ── */}
      <Motion role="slide" className="border-b-[var(--bw-heavy)] border-line-2 px-(--gutter) py-5">
        {/* Grille 48 px */}
        <div className="flex items-start gap-3.5">
          <Avatar name={user?.prenom} color={user?.avatar_color} size="lg" />

          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="font-display text-[1.35rem] font-bold tracking-[-0.02em] text-chalk">
                {user?.prenom ?? "…"}
              </span>
              {user?.verified && (
                <VerifiedBadge
                  size="lg"
                  // Le palier suit l'XP du profil public, pas celle du
                  // visiteur : c'est la note du compte affiché.
                  tier={badgeFor(user, publicProgress?.stats.xp ?? 0)}
                />
              )}
            </p>
            <p className="mt-0.5 font-mono text-[12px] text-chalk-4">@{user?.pseudo}</p>

            {/* La filière et le niveau se lisent seulement depuis la jointure :
                les recopier dans le post les figerait à la publication. */}
            {(user?.filiere || user?.niveau) && (
              <p className="mt-1 font-mono text-[11.5px] text-chalk-3">
                {[user.filiere, user.niveau].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        {/* La bio, si elle existe. Un compte sans bio n'affiche pas de
            ligne vide : mieux vaut une absence lisible qu'un cadre
            vide qu'il faudrait remplir. */}
        {user?.bio && (
          <p className="mt-3 text-[13px] leading-relaxed text-chalk-2">{user.bio}</p>
        )}

        {/* Les langages sont des étiquettes, pas des liens : on ne filtre
            pas encore par langage, et un bouton qui ne mène nulle part
            est un mensonge. */}
        {user && user.langages.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {user.langages.map((lang) => (
              <li
                key={lang}
                className="label-micro border border-line-2 bg-surface-1 px-1.5 py-0.5
                  font-mono text-chalk-3"
              >
                {lang}
              </li>
            ))}
          </ul>
        )}

        {/* Lieu déclaré : deux textes, rien de plus — la carte d'accueil se
            déduit de la ville, on ne stocke jamais de coordonnées ici. */}
        {user && (user.ville || user.pays) && (
          <p className="mt-2.5 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-chalk-3">
            <Icon name="globe" size={12} />
            {[user.ville, user.pays].filter(Boolean).join(", ")}
          </p>
        )}

        {/* Liens externes : de vraies ancres, ouvertes dans un nouvel onglet.
            Une liste vide ne laisse pas de titre orphelin. */}
        {user && user.links && user.links.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {user.links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
                    border border-line-3 bg-surface px-2.5 py-1 font-mono text-[11.5px]
                    text-chalk-2 transition-colors hover:border-signal hover:text-signal"
                >
                  <Icon name="link" size={12} />
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        )}

        {/* Sur son propre profil, l'action utile n'est pas de se suivre :
            c'est de corriger sa présentation. On renvoie vers l'onglet
            Paramètres, où vit le formulaire. */}
        {isMe && (
          <div className="mt-4">
            <Link
              href="/profile?tab=settings"
              className="inline-flex h-[var(--h-tap)] items-center justify-center gap-1.5
                rounded-[var(--radius-input)] border border-line-3 bg-surface px-3.5
                font-mono text-[12px] text-chalk-2 transition-colors
                hover:border-signal hover:text-signal"
            >
              <Icon name="edit" size={14} />
              modifier le profil
            </Link>
          </div>
        )}

        {/* Les deux actions sont de même poids visuel : suivre et écrire
            sont les deux gestes par lesquels un lien devient réel. */}
        {!isMe && user && (
          <div className="mt-4 flex gap-2">
            <FollowButton
              me={profile?.id ?? null}
              targetId={user.id}
              targetPseudo={user.pseudo}
              defaultFollowing={following}
              onChanged={(next, previous) => {
                // Le compteur est un cache serveur : on l'ajuste pour que
                // le clic soit suivi d'un effet, et la prochaine lecture
                // du profil remettra le chiffre exact par-dessus.
                //
                // Sans état précédent connu, on ne touche à rien : le
                // chiffre affiché vient déjà du serveur, et le retrancher
                // ou l'ajouter serait l'inventer.
                if (previous === undefined) return;
                setUser((prev) =>
                  prev
                    ? { ...prev, followers: Math.max(0, prev.followers + (next ? 1 : -1)) }
                    : prev,
                );
              }}
            />

            <button
              type="button"
              onClick={openConversation}
              aria-label={`Écrire à ${user.prenom}`}
              className="inline-flex h-[var(--h-tap)] items-center justify-center gap-1.5
                rounded-[var(--radius-input)] border border-line-3 bg-surface
                px-3.5 font-mono text-[12px] font-bold tracking-[0.12em]
                uppercase transition-[border-color,color]
                duration-[var(--d-fast)] hover:border-signal hover:text-signal"
            >
              <Icon name="messages" size={14} />
              écrire
            </button>

            {/* Signaler un compte est un geste plus grave que signaler un
                post : il n'est donc pas dans la rangée des actions
                principales, mais sous l'en-tête, discret. */}
            <div className="mt-3 flex justify-end">
              <ReportButton
                me={profile?.id ?? null}
                targetId={user.id}
                targetType="user"
                targetLabel="ce compte"
                targetAuthorId={user.id}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)]
                  border-[var(--bw-thin)] border-line px-2 py-1 font-mono text-[11px]
                  uppercase tracking-[0.1em] text-chalk-4
                  transition-[color,border-color] duration-[var(--d-fast)]
                  hover:border-danger hover:text-danger"
              />
            </div>
          </div>
        )}

        {/* Les deux compteurs mènent à la liste qui les explique. Un
            chiffre sans porte derrière n'apprend rien : c'est la liste
            qui montre des visages, et c'est elle qui rend le lien
            abstrait concret. */}
        {user && (
          <div className="mt-4 border-t border-line-2 pt-3">
            {/* La carte dev, sans ouvrir un seul onglet : qui (niveau),
                combien (dépôts), quelle qualité (scores), quelle preuve
                de code réel (GitHub). C'est le jugement, posé d'avance. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
                <div className="label-micro text-chalk-4">XP</div>
                <div className="tnum mt-1 text-[15px] font-bold text-chalk">
                  {publicProgress ? publicProgress.stats.xp : 0}
                </div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
                <div className="label-micro text-chalk-4">Niveau</div>
                <div className="mt-1 text-[12px] font-bold text-signal">
                  {xpLevel ? xpLevel.title : "Nouveau"}
                </div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
                <div className="label-micro text-chalk-4">Dépôts</div>
                <div className="tnum mt-1 text-[15px] font-bold text-chalk">
                  {projects?.length ?? 0}
                </div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
                <div className="label-micro text-chalk-4">Score moyen</div>
                <div className="tnum mt-1 text-[15px] font-bold text-chalk">
                  {projectScoreSummary.average}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-chalk-4">
                  {projectScoreSummary.count > 0
                    ? `sur ${projectScoreSummary.count} dépôt${projectScoreSummary.count > 1 ? "s" : ""}`
                    : "aucun dépôt"}
                </div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
                <div className="label-micro text-chalk-4">Meilleur score</div>
                <div className="tnum mt-1 text-[15px] font-bold text-chalk">
                  {projectScoreSummary.best}
                </div>
              </div>
              {/* GitHub relié est un fait, pas une décoration : le login
                  mène aux dépôts réels qui prouvent le reste. */}
              <div className="rounded-[var(--radius-card)] border border-line-2 bg-surface-2/80 p-2.5">
                <div className="label-micro text-chalk-4">GitHub</div>
                {github ? (
                  <a
                    href={`https://github.com/${github.login}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex h-6 max-w-full items-center truncate font-mono text-[12px] font-bold text-signal hover:underline"
                  >
                    @{github.login}
                  </a>
                ) : (
                  <div className="mt-1 font-mono text-[12px] font-bold text-chalk-4">
                    Non relié
                  </div>
                )}
              </div>
            </div>

            {/* La moyenne dit où en est le travail ; la trajectoire dit d'où
                il vient. Les deux se lisent ensemble : un profil à 700
                stable et un profil à 700 en hausse ne disent pas la même
                chose. */}
            <div className="mt-3">
              <ScoreTrajectory
                series={projectScoreSummary.series}
                stats={projectScoreSummary.trajectory}
              />
            </div>

            {/* Les deux compteurs mènent à la liste qui les explique : un
                chiffre sans porte derrière n'apprend rien. */}
            <div className="mt-3 flex gap-5">
              {([
                ["followers", "abonnés", user.followers],
                ["following", "suivis", user.following],
              ] as [FollowListKind, string, number][]).map(([kind, label, count]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() =>
                    router.push(
                      `/u/${user.pseudo}/followers${kind === "following" ? "?which=following" : ""}`,
                    )
                  }
                  className="mo-press inline-flex items-baseline gap-1.5 py-[2px]
                    font-mono text-[11.5px] uppercase tracking-[0.1em] text-chalk-4
                    transition-colors duration-[var(--d-fast)] hover:text-signal"
                >
                  <span className="tnum text-[15px] font-bold text-chalk">{count}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Motion>

      {/* ── Gr dièse de publications / projets ──
          Deux réponses à deux questions distinctes : « qu'a-t-il écrit ? »
          et « a-t-il construit quelque chose ? ». Sur un profil public,
          la seconde est celle qui décide — un recruteur ne lit pas des
          publications pour juger, il cherche la preuve d'un travail. */}
      <div className="px-(--gutter) py-4">
        <div role="tablist" aria-label="Contenu du profil" className="mb-3 flex gap-0 border-b border-line-2">
          {([
            ["preuves", "Preuves"],
            ["posts", "Publications"],
            ["projects", "Projets"],
          ] as [ProfileTab, string][]).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`tab-underline px-3.5 py-2 font-mono text-[11.5px]
                font-bold uppercase tracking-[0.12em] transition-colors
                duration-[var(--d-fast)]
                ${tab === value
                  ? "text-signal"
                  : "text-chalk-4 hover:text-chalk-2"}`}
            >
              {label}
              {tabCounts[value] !== undefined && (
                <span className="tnum ml-1.5 text-chalk-3">{tabCounts[value]}</span>
              )}
            </button>
          ))}
        </div>

        {tab === "preuves" && (
          <ProofPanel
            proofs={proofs}
            loading={loadingProofs}
            // Le rejeu relit la source **puis** recalcule : rejouer une
            // copie en mémoire ne vérifierait que la copie.
            onReplay={() => replayUserProofs(user!.id)}
          />
        )}

        {tab === "posts" && (
          <>
        {posts === null && <Loading label="Lecture du profil" />}

        {posts?.length === 0 && (
          <EmptyState title="Aucune publication" />
        )}

        {posts?.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            meId={profile?.id ?? null}
            liked={likedIds.includes(p.id)}
            onToggleLike={async (id) => {
              if (!profile) return;
              const { error } = await toggleLike(id, profile.id);
              if (error) {
                toast("Action impossible", "err");
                return;
              }
              // On relit le profil plutôt que de deviner le compteur :
              // il vient du cache écrit par le déclencheur, et c'est lui
              // qui fait foi.
              await load();
            }}
            onOpenComments={setCommentsFor}
            onOpenProfile={(p2) => router.push(`/u/${p2}`)}
            project={postProjects.get(p.id) ?? null}
            onOpenProject={(projectId) => router.push(`/projects/${projectId}`)}
            isMine={postActions.isMine(p)}
            {...postActions.cardProps}
          />
        ))}
          </>
        )}

        {tab === "projects" && (
          <>
            {projects === null && <Loading label="Lecture des projets" />}

            {projects?.length === 0 && (
              <EmptyState
                title="Aucun projet"
                hint={isMe ? undefined : "Pas de dépôt public."}
                action={
                  isMe ? (
                    <button
                      type="button"
                      onClick={() => router.push("/projects")}
                      className="mo-press inline-flex h-[var(--h-tap)] items-center gap-2
                        rounded-[var(--radius-input)] border border-signal bg-signal
                        px-4 text-[13px] font-bold text-void shadow-sh-2"
                    >
                      <Icon name="plus" size={14} strokeWidth={2} />
                      Nouveau projet
                    </button>
                  ) : undefined
                }
              />
            )}

            {projects?.map((pr, i) => (
              <ProjectCard
                key={pr.id}
                project={pr}
                index={i}
                // La note vient de la synthèse déjà calculée pour la
                // moyenne : une seule lecture des fichiers pour les deux.
                score={projectScoreSummary.scores[pr.id]}
              />
            ))}

            {/*
              Les dépôts GitHub, à côté des dépôts DevNet — et **uniquement
              les publics**. La route derrière n'emploie aucun jeton : ce
              qui est privé ne peut pas arriver ici, ce n'est pas un filtre
              posé sur un accès plus large.

              Deux blocs distincts plutôt qu'une liste fourre-tout : un
              dépôt DevNet est noté par le moteur de revue, un dépôt GitHub
              ne l'est pas, et les mêter ensembles donnerait à croire qu'on
              note le code d'autrui.
            */}
            {github?.login && publicRepos && (
              <div className="mt-5 border-t border-line-2 pt-4">
                <div className="label-micro mb-2.5 flex items-center gap-1.5 text-chalk-3">
                  <Icon name="fork" size={12} />
                  Dépôts GitHub publics — @{github.login}
                </div>

                {publicRepos.failed && (
                  <p className="font-mono text-[11.5px] text-chalk-4">
                    Liste indisponible : limite d&apos;appels GitHub atteinte.
                    {" "}
                    <a
                      href={`https://github.com/${github.login}?tab=repositories`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold text-signal hover:underline"
                    >
                      Voir sur GitHub →
                    </a>
                  </p>
                )}

                {!publicRepos.failed && publicRepos.repos.length === 0 && (
                  <p className="font-mono text-[11.5px] text-chalk-4">
                    Aucun dépôt public sur ce compte.
                  </p>
                )}

                {!publicRepos.failed && publicRepos.repos.length > 0 && (
                  <ul className="space-y-1.5">
                    {publicRepos.repos.map((repo) => (
                      <li key={repo.id}>
                        <a
                          href={repo.html_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mo-press flex items-start gap-2 rounded-[var(--radius-card)]
                            border border-line-2 bg-surface-2/70 px-3 py-2
                            transition-colors duration-[var(--d-fast)] hover:border-signal"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-[12.5px] font-bold text-chalk">
                              {repo.name}
                            </span>
                            {repo.description && (
                              <span className="mt-0.5 line-clamp-2 block text-[11.5px]
                                leading-snug text-chalk-3">
                                {repo.description}
                              </span>
                            )}
                          </span>

                          <span className="flex shrink-0 flex-col items-end gap-1
                            font-mono text-[10.5px] text-chalk-4">
                            {repo.language && <span>{repo.language}</span>}
                            {repo.stargazers_count > 0 && (
                              <span className="tnum inline-flex items-center gap-1">
                                <Icon name="star" size={11} />
                                {repo.stargazers_count}
                              </span>
                            )}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        <PostOwnerTools actions={postActions} />
      </div>

      <CommentsPanel
        postId={commentsFor}
        open={commentsFor !== null}
        onClose={() => setCommentsFor(null)}
        me={profile?.id ?? null}
        canModerate={user?.id === profile?.id}
      />
    </AppShell>
  );
}