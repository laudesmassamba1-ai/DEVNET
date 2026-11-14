"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell, IconButton } from "@/components/AppShell";
import { Avatar, EmptyState, Loading, PrimaryButton } from "@/components/Avatar";
import { ProfileWorkPanel } from "@/components/ProfileWorkPanel";
import { AvatarEditor } from "@/components/AvatarEditor";
import { useToast } from "@/components/Toast";
import { Icon } from "@/components/Icon";
import { useTour } from "@/components/TourProvider";
import { WovenBand } from "@/components/WovenBand";
import { CountUp } from "@/components/Motion";
import { ProgressPanel } from "@/components/ProgressPanel";
import { LevelCelebration } from "@/components/LevelCelebration";
import { ChallengePanel } from "@/components/ChallengePanel";
import { AchievementsPanel } from "@/components/AchievementsPanel";
import { useChallenges } from "@/hooks/useChallenges";
import { useAchievementCounters } from "@/hooks/useAchievementCounters";
import { ContributionStrip } from "@/components/ContributionMap";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { BadgeGallery } from "@/components/BadgeGallery";
import {
  asVerificationStatus, badgeFor, verificationErrorMessage,
  VERIFY_STATUS_LABEL,
} from "@/lib/verification";
import {
  requestVerification, withdrawVerification,
} from "@/lib/verification-data";
import { fetchConnection } from "@/lib/github/connect";
import { fetchProjectsByUser, summarizeRepoScores } from "@/lib/repo";
import { api } from "@/lib/api/client";
import { updateProfile } from "@/lib/api/profile";
import {
  applyTheme,
  broadcastTheme,
  DEFAULT_THEME,
  LIGHT_THEME,
  SAVANE_LIGHT_THEME,
  SAVANE_THEME,
} from "@/lib/theme";
import { useSession } from "@/hooks/useSession";
import { useProgress } from "@/hooks/useProgress";
import { loadLeaderboard, type LeaderEntry } from "@/lib/progress";
import { levelFor } from "@/lib/gamification";
import { accountLabel, avatarClass, timeAgo } from "@/lib/utils";
import {
  AVATARS, FILIERES, LANGAGES, NIVEAUX,
  type AccountType, type AvatarColor, type Post, type ProfileLink, type User,
} from "@/lib/types";

/** Thèmes disponibles : Encre par défaut, puis Papier et Savane. */
const THEMES = [
  { id: DEFAULT_THEME, label: "Encre", icon: "moon" },
  { id: LIGHT_THEME, label: "Papier", icon: "sun" },
  { id: SAVANE_THEME, label: "Savane", icon: "globe" },
  { id: SAVANE_LIGHT_THEME, label: "Savane clair", icon: "compass" },
] as const;

type Tab = "posts" | "work" | "progress" | "infos" | "settings";

/** Libellés des onglets — un tableau plutôt que des ternaires imbriqués. */
const TABS: { key: Tab; label: string }[] = [
  { key: "posts", label: "Posts" },
  { key: "work", label: "Travail" },
  { key: "progress", label: "Progrès" },
  { key: "infos", label: "Infos" },
  { key: "settings", label: "Réglages" },
];

/** Objectif de la semaine : combien de posts publier d'ici dimanche.
 *  La réalisation est comptée en base, l'objectif vit dans le navigateur —
 *  c'est un engagement personnel, pas une donnée communautaire. */
function WeeklyGoalCard({ profileId }: { profileId: string }) {
  const [target, setTarget] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("devnet:weekly-goal");
      return raw ? Number(raw) : 5;
    } catch {
      return 5;
    }
  });
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    const start = new Date();
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    let alive = true;
    api
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", profileId)
      .gte("created_at", start.toISOString())
      .then(({ count }: { count: number | null }) => {
        if (alive) setDone(count ?? 0);
      });
    return () => {
      alive = false;
    };
  }, [profileId]);

  const count = done ?? 0;
  const pct = target > 0 ? Math.min(100, Math.round((count / target) * 100)) : 0;
  const reached = target > 0 && count >= target;

  function changeTarget(v: number) {
    setTarget(v);
    try {
      localStorage.setItem("devnet:weekly-goal", String(v));
    } catch {
      /* le navigateur refuse le stockage : l'objectif reste en mémoire */
    }
  }

  return (
    <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-13 font-bold">Objectif de la semaine</div>
        <select
          value={target}
          onChange={(e) => changeTarget(Number(e.target.value))}
          aria-label="Nombre de posts à publier cette semaine"
          className="h-(--h-tap) rounded-(--radius-input) border border-line-3
            bg-surface-2 px-2 text-12 font-bold text-chalk-2"
        >
          {[3, 5, 7, 10].map((n) => (
            <option key={n} value={n}>{n} posts</option>
          ))}
        </select>
      </div>
      <p className="mb-3 text-sm leading-[1.5] text-chalk-3">
        {reached
          ? "Objectif atteint. Le fil t&apos;attend pour la suite."
          : "Ajoutez encore un post pour tenir votre semaine."}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={count}
        aria-label={`${count} posts sur ${target}`}
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-(--gradient-amber-fire) shadow-(--shadow-sh-1)
            transition-[width] duration-(--d-base) ease-(--ease-continuous)"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-12 text-chalk-4">
        <strong className="tnum text-chalk">{count}</strong> / {target} cette semaine
        {reached && <span className="text-ok">— objectif atteint</span>}
      </p>
    </div>
  );
}

export default function ProfilePage() {
  const { profile, loading: sessionLoading, failed, retry, refresh } = useSession();
  const router = useRouter();
  const toast = useToast();
  const { start: startTour } = useTour();

  const [tab, setTab] = useState<Tab>("work");

  // L'onglet peut être visé par l'adresse (`/profile?tab=progress`) : la
  // notification horaire des défis y renvoie directement, et un lien
  // partagé ouvre l'onglet qu'il nomme au lieu de retomber sur la vue par
  // défaut. On valide la valeur contre `TABS` : un `?tab=` inconnu ne doit
  // pas peindre un onglet qui n'existe pas.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted && TABS.some((t) => t.key === wanted))
    // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(wanted as Tab);
  }, []);

  const [editing, setEditing] = useState(false);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [switchingType, setSwitchingType] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [verifyNote, setVerifyNote] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [profileSummary, setProfileSummary] = useState({
    projects: 0,
    groups: 0,
    githubLogin: null as string | null,
    scoreAverage: 0,
    scoreCount: 0,
    scoreLoading: true,
  });

  const profileId = profile?.id;

  // Un seul état de demande à la fois : la base ne garde qu'une ligne par
  // compte (`users.verification_status`), donc pas d'historique à
  // reconstruire — le libellé vient directement du type.
  const verifyStatus = asVerificationStatus(profile?.verification_status);

  // La progression se recalcule à chaque ouverture de l'onglet : c'est
  // quelques centaines de lignes à lire, et l'affichage ne peut donc pas
  // être en retard sur ce que l'utilisateur a réellement publié.
  const { progress, loading: progressLoading, reload } = useProgress(profile);

  // Les défis du jour, comptés depuis les tables réelles — le même
  // principe que la progression : recalculés à chaque ouverture pour ne
  // jamais être en retard sur l'activité réelle.
  const challenges = useChallenges(profile);

  // Les compteurs des succès lisent leurs propres tables — preuves,
  // forks, notes. Ils dépendent du score de progression pour les likes
  // et la meilleure série, déjà calculés ailleurs.
  const achievementCounters = useAchievementCounters(
    profile,
    progress?.stats.likes ?? 0,
    progress?.stats.streak?.best ?? 0,
  );

  // Le classement est une lecture séparée : on ne le déclenche qu'à la
  // première ouverture de l'onglet, pas à chaque visite de la page.
  useEffect(() => {
    if (tab !== "progress" || !profile || leaderboard.length > 0) return;
    let alive = true;
    loadLeaderboard(profile).then((rows) => {
      if (alive) setLeaderboard(rows);
    });
    return () => {
      alive = false;
    };
  }, [tab, profile, leaderboard.length]);

  // Charge les posts de l'utilisateur
  useEffect(() => {
    if (!profileId) return;
    let alive = true;

    api
      .from("posts").select("*").eq("author_id", profileId)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: Post[] | null }) => {
        if (alive) setPosts(data ?? []);
      });

    void Promise.all([
      fetchProjectsByUser(profileId),
      api.from("group_members").select("group_id").eq("user_id", profileId),
      fetchConnection(profileId),
    ]).then(async ([projectsRows, memberships, github]) => {
      // Le score moyen est lu **avec** le profil, pas à l'ouverture d'un
      // onglet : il figure dans l'en-tête, qui est le premier écran. Le
      // calculer paresseusement ferait afficher « 0 » jusqu'à ce qu'on
      // ouvre les Projets — un chiffre faux le temps d'un clic.
      const scores = await summarizeRepoScores(projectsRows);
      if (!alive) return;
      setProfileSummary({
        projects: projectsRows.length,
        groups: memberships.data?.length ?? 0,
        githubLogin: github?.login ?? null,
        scoreAverage: scores.average,
        scoreCount: scores.count,
        scoreLoading: false,
      });
    });

    return () => {
      alive = false;
    };
  }, [profileId]);

  async function logout() {
    await api.auth.signOut();
    router.replace("/login");
  }

  const onSaved = useCallback(() => {
    setEditing(false);
    // Le profil affiché (prénom, avatar, bio) vient de la session : sans ce
    // rafraîchissement, l'en-tête garderait l'ancienne identité jusqu'au
    // prochain rechargement — on vient justement de la changer.
    void refresh();
    // Le score dépend de la bio (badge « Carte d'identité ») : il faut le
    // recalculer dès qu'elle change, sinon l'onglet Progrès ment.
    void reload();
  }, [refresh, reload]);

  async function switchAccountType(current: AccountType) {
    const next = current === "professional" ? "student" : "professional";
    setSwitchingType(true);
    try {
      const { error } = await api
        .from("users")
        .update({ account_type: next })
        .eq("id", profileId);
      if (error) throw error;
      await refresh();
      toast(
        next === "professional"
          ? "Compte professionnel activé"
          : "Compte étudiant rétabli",
        "ok",
      );
    } catch {
      toast("Type de compte inchangé", "err");
    } finally {
      setSwitchingType(false);
    }
  }

  /**
   * Envoie sa demande de vérification.
   *
   * On n'écrit que `verification_status` et `verification_note` : `verified`
   * n'est pas atteignable depuis ici, la colonne gardée est refusée par la
   * base (déclencheur 037) comme par la démo. C'est le principe du flux —
   * **demander n'est pas s'accorder**.
   */
  async function sendVerification() {
    if (verifyBusy || !profileId) return;
    setVerifyBusy(true);
    try {
      await requestVerification(profileId, verifyNote.trim());
      await refresh();
      setVerifyNote("");
      toast("Demande envoyée à l'administration", "ok");
    } catch (err) {
      toast(verificationErrorMessage(err), "err");
    } finally {
      setVerifyBusy(false);
    }
  }

  /** Retire sa demande, tant qu'elle n'est pas tranchée. */
  async function cancelVerification() {
    if (verifyBusy || !profileId) return;
    setVerifyBusy(true);
    try {
      await withdrawVerification(profileId);
      await refresh();
      toast("Demande retirée", "ok");
    } catch (err) {
      toast(verificationErrorMessage(err), "err");
    } finally {
      setVerifyBusy(false);
    }
  }

  async function exportData() {
    if (!profileId) return;
    setExporting(true);
    try {
      const [postsRes, commentsRes, bookmarksRes, followsRes] = await Promise.all([
        api.from("posts").select("*").eq("author_id", profileId),
        api.from("comments").select("*").eq("author_id", profileId),
        api.from("bookmarks").select("*").eq("user_id", profileId),
        api.from("follows").select("*").eq("follower_id", profileId),
      ]);
      const anyError = postsRes.error || commentsRes.error || bookmarksRes.error || followsRes.error;
      if (anyError) throw anyError;

      const dump = {
        exported_at: new Date().toISOString(),
        community: "DevNet",
        profile: profile ? {
          id: profile.id,
          prenom: profile.prenom,
          pseudo: profile.pseudo,
          email: profile.email,
          filiere: profile.filiere,
          niveau: profile.niveau,
          langages: profile.langages,
          bio: profile.bio,
          account_type: profile.account_type,
          verified: profile.verified,
          created_at: profile.created_at,
        } : null,
        posts: postsRes.data ?? [],
        comments: commentsRes.data ?? [],
        signets: bookmarksRes.data ?? [],
        abonnements: followsRes.data ?? [],
      };

      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `devnet-${profile?.pseudo ?? "moi"}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(href);
      toast("Export prêt dans vos téléchargements", "ok");
    } catch {
      toast("Export impossible", "err");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell
      title="Profil"
      action={
        <div className="flex items-center gap-2">
          <IconButton label="Voir mon profil public" name="eye"
            onClick={() => profile?.pseudo && router.push(`/u/${profile.pseudo}`)} />
          <IconButton label="Revoir la visite guidée" name="help"
            onClick={startTour} />
          <IconButton label="Modifier le profil" name="edit"
            onClick={() => setEditing((v) => !v)} />
        </div>
      }
    >
      {sessionLoading || !profile ? (
        failed ? (
          <EmptyState
            title="Profil illisible"
            icon={<Icon name="flag" size={20} strokeWidth={1.5} />}
            action={
              <PrimaryButton onClick={retry}>Re-tenter</PrimaryButton>
            }
          />
        ) : (
          <Loading label="Chargement du profil" />
        )
      ) : editing ? (
        <EditForm
          key={profile.id}
          profile={profile}
          onCancel={() => { setEditing(false); applyTheme(profile.theme); }}
          onSaved={() => { onSaved(); toast("Profil mis à jour"); }}
        />
      ) : (
        <>
          <div className="px-(--gutter)" data-tour="profile-header">
            <div className="mt-4 mb-3 flex items-start gap-3.5">
              <Avatar name={profile.prenom} color={profile.avatar_color} size="lg" />
              <div className="min-w-0 flex-1 pt-0.5">
                <h1 className="font-display text-[1.65rem] font-bold tracking-[-0.04em] leading-tight">
                  {profile.prenom}
                </h1>
                <div className="mt-0.5 mb-2 font-mono text-12 text-chalk-3">
                  @{profile.pseudo}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`rounded-(--radius-chip) border-(--bw-thin) px-2 py-1 text-12
                    font-bold tracking-[0.06em] uppercase
                    ${profile.account_type === "professional"
                      ? "border-warn bg-warn text-page"
                      : "border-ok bg-ok text-page"}`}
                  >
                    {accountLabel(profile.account_type)}
                  </span>
                    {profile.verified && (
                      <VerifiedBadge
                        size="lg"
                        tier={badgeFor(profile, progress?.stats.xp ?? 0)}
                      />
                    )}
                </div>
              </div>
            </div>

            <p className={`mb-3.5 text-13 leading-[1.6] ${profile.bio ? "text-chalk-2" : "text-chalk-4 italic"}`}>
              {profile.bio ||
                "Aucune bio — clique sur l'icône crayon pour en ajouter une."}
            </p>

            <div className="mb-4 flex flex-wrap gap-1.5">
              {(profile.langages ?? []).length === 0
                ? <span className="text-12 text-chalk-4">Aucun langage renseigné</span>
                : profile.langages.map((l) => (
                  <span key={l}
                    className="rounded-(--radius-chip) border-(--bw-thin) border-line-2
                      bg-surface-2 px-2 py-1 text-12 font-semibold tracking-[0.06em]
                      text-info uppercase">
                    {l}
                  </span>
                ))}
            </div>

            <div className="mb-4 flex gap-7 border-t border-line-3 pt-3.5">
              <div>
                <div className="tnum font-display text-[1.35rem] font-bold leading-none">
                  <CountUp value={posts?.length ?? 0} />
                </div>
                <div className="label-micro mt-0.5 text-chalk-3">Posts</div>
              </div>
              <div>
                <div className="tnum font-display text-[1.35rem] font-bold leading-none">
                  <CountUp value={profile.followers ?? 0} />
                </div>
                <div className="label-micro mt-0.5 text-chalk-3">Abonnés</div>
              </div>
              <div>
                <div className="tnum font-display text-[1.35rem] font-bold leading-none">
                  <CountUp value={profile.following ?? 0} />
                </div>
                <div className="label-micro mt-0.5 text-chalk-3">Suivis</div>
              </div>
              {progress && (
                <div className="ml-auto text-right">
                  <div className="tnum font-display text-[1.35rem] font-bold leading-none text-signal">
                    <CountUp value={progress.stats.xp} />
                  </div>
                  <div className="label-micro mt-0.5 text-chalk-3">XP</div>
                </div>
              )}
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-(--radius-card) border border-line-2 bg-surface-2/60 px-3 py-2.5">
                <div className="label-micro text-chalk-4">XP</div>
                <div className="tnum mt-1 font-display text-[1.2rem] font-bold leading-none text-signal">
                  <CountUp value={progress?.stats.xp ?? 0} />
                </div>
              </div>
              <div className="rounded-(--radius-card) border border-line-2 bg-surface-2/60 px-3 py-2.5">
                <div className="label-micro text-chalk-4">Niveau</div>
                <div className="mt-1 text-sm font-bold leading-tight text-signal">
                  {progress ? levelFor(progress.stats.xp).title : "Nouveau"}
                </div>
              </div>
              <div className="rounded-(--radius-card) border border-line-2 bg-surface-2/60 px-3 py-2.5">
                <div className="label-micro text-chalk-4">Dépôts</div>
                <div className="tnum mt-1 font-display text-[1.2rem] font-bold leading-none text-chalk">
                  {profileSummary.projects}
                </div>
              </div>
              <div className="rounded-(--radius-card) border border-line-2 bg-surface-2/60 px-3 py-2.5">
                <div className="label-micro text-chalk-4">Score moyen</div>
                {profileSummary.scoreLoading ? (
                  <div className="mt-1 flex items-center gap-2">
                    <Loading label="" />
                    <span className="text-12 text-chalk-4">Calcul en cours…</span>
                  </div>
                ) : (
                  <>
                    <div className="tnum mt-1 font-display text-[1.2rem] font-bold leading-none text-chalk">
                      {profileSummary.scoreAverage}
                    </div>
                    <div className="mt-0.5 text-12 uppercase tracking-[0.08em] text-chalk-4">
                      {profileSummary.scoreCount > 0
                        ? `sur ${profileSummary.scoreCount} dépôt${profileSummary.scoreCount > 1 ? "s" : ""}`
                        : "aucun dépôt analysable"}
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-(--radius-card) border border-line-2 bg-surface-2/60 px-3 py-2.5">
                <div className="label-micro text-chalk-4">Groupes</div>
                <div className="tnum mt-1 font-display text-[1.2rem] font-bold leading-none text-chalk">
                  {profileSummary.groups}
                </div>
              </div>
              <div className="rounded-(--radius-card) border border-line-2 bg-surface-2/60 px-3 py-2.5">
                <div className="label-micro text-chalk-4">GitHub</div>
                <div className="mt-1 font-mono text-12 font-bold leading-tight text-chalk-2">
                  {profileSummary.githubLogin ? `@${profileSummary.githubLogin}` : "Non relié"}
                </div>
              </div>
            </div>

            <WovenBand tone="phosphor" className="mt-4" />

            <div className="relative -mx-(--gutter) border-b border-line-3 px-(--gutter)">
              <div
                role="tablist"
                aria-label="Contenu du profil"
                data-tour="profile-tabs"
                className="grid grid-cols-5"
              >
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    type="button"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={`tab-underline min-h-(--h-tap) min-w-0 px-1 py-3 text-12 font-bold
                      tracking-[0.03em] whitespace-nowrap uppercase transition-colors
                      duration-(--d-fast) ${tab === t.key
                        ? "text-chalk"
                        : "text-chalk-3 hover:bg-surface-2 hover:text-chalk"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {tab === "work" && (
              <ProfileWorkPanel profileId={profile.id} />
            )}

            {tab === "posts" && (
              <div className="py-4">
                {posts === null && <Loading />}
                {posts?.length === 0 && (
                  <EmptyState title="Aucun post" />
                )}
                {posts?.map((p) => (
                  <article key={p.id}
                    className="mo-rise mb-3 rounded-(--radius-card) border
                      border-l-[6px] border-line-3 border-l-line-3 bg-surface px-4 py-4 shadow-sh-1">
                    {/* Le texte est rendu tel quel : React l'échappe, et
                        `esc()` ici pouvait couper une entité en deux au
                        milieu (`&l`), laissant un fragment illisible au
                        bord de l'aperçu. */}
                    <div className="mb-2 line-clamp-3 whitespace-pre-wrap text-13 leading-[1.6]">
                      {p.text.slice(0, 240)}
                    </div>
                    {p.has_code && (
                      <div className="mb-2 inline-flex items-center rounded-(--radius-chip) border
                        border-line-3 bg-surface-3 px-2 py-0.5 font-mono text-12 font-bold
                        tracking-[0.06em] text-chalk uppercase">
                        {p.lang || "Code"}
                      </div>
                    )}
                    <div className="flex gap-4 text-12 text-chalk-3">
                      <span className="flex items-center gap-1.5">
                        <Icon name="like" size={12} />
                        <span className="tnum">{p.likes || 0}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Icon name="comment" size={12} />
                        <span className="tnum">{p.comments || 0}</span>
                      </span>
                      <span className="ml-auto">{timeAgo(p.created_at)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {tab === "progress" && (
              <div className="mo-slide space-y-3 py-4">
                {profileId && <WeeklyGoalCard profileId={profileId} />}
                <ChallengePanel challenges={challenges} />
                <ProgressPanel
                  stats={progress?.stats ?? null}
                  loading={progressLoading}
                  leaderboard={leaderboard}
                />
                {profile && (
                  <AchievementsPanel
                    counters={{
                      ...achievementCounters,
                      challengesDone: challenges.filter((c) => c.done).length,
                    }}
                  />
                )}
              </div>
            )}

            {tab === "infos" && (
              <div className="mo-slide space-y-2 py-4">
                <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                  <div className="label-micro mb-1.5 text-chalk-3">
                    Email
                  </div>
                  <div className="text-14">{profile.email}</div>
                </div>
                {progress && progress.stats.activeDays.length > 0 && (
                  <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                    <div className="label-micro mb-2.5 text-chalk-3">
                      Activité — 14 derniers jours
                    </div>
                    <ContributionStrip activeDays={progress.stats.activeDays} />
                  </div>
                )}
                <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                  <div className="label-micro mb-1.5 text-chalk-3">
                    Formation
                  </div>
                  <div className="text-14">
                    {[profile.filiere, profile.niveau].filter(Boolean).join(" — ") || "—"}
                  </div>
                </div>
                <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                  <div className="label-micro mb-2 text-chalk-3">
                    Type de compte
                  </div>
                  <button type="button" title="Gérer le type de compte"
                    onClick={() => setTab("settings")}
                    className={`inline-flex cursor-pointer rounded-(--radius-chip) border-(--bw-thin) px-2 py-1
                    text-12 font-bold tracking-[0.06em] uppercase transition-colors
                    ${profile.account_type === "professional"
                      ? "border-warn bg-warn text-page hover:border-warn/70"
                      : "border-ok bg-ok text-page hover:border-ok/70"}`}
                  >
                    {accountLabel(profile.account_type)}
                  </button>
                  {!profile.verified && profile.account_type === "professional" && (
                    <p className="mt-2.5 text-12 leading-[1.5] text-chalk-3">
                      Le type de compte ne suffit pas : le cachet s&apos;obtient après une
                      demande examinée dans{" "}
                      <button type="button" onClick={() => setTab("settings")}
                        className="font-bold text-signal">
                        Réglages
                      </button>.
                    </p>
                  )}
                </div>
                <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                  <div className="label-micro mb-1.5 text-chalk-3">Membre depuis</div>
                  <div className="text-14">
                    {new Date(profile.created_at).toLocaleDateString("fr",
                      { year: "numeric", month: "long", day: "numeric" })}
                  </div>
                </div>
                <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                  <div className="label-micro mb-2.5 text-chalk-3">Abonnements</div>
                  <div className="flex gap-6 text-14">
                    <span>
                      <strong className="tnum text-chalk"><CountUp value={profile.followers} /></strong>{" "}
                      abonné{profile.followers > 1 ? "s" : ""}
                    </span>
                    <span>
                      <strong className="tnum text-chalk"><CountUp value={profile.following} /></strong>{" "}
                      abonnements
                    </span>
                  </div>
                </div>
                {profile.langages.length > 0 && (
                  <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                    <div className="label-micro mb-2 text-chalk-3">Langages</div>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.langages.map((l) => (
                        <span key={l}
                          className="rounded-(--radius-chip) border-(--bw-thin)
                            border-line-3 px-2 py-1 text-12 text-chalk-3">
                          {l}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "settings" && (
              <div className="mo-slide space-y-3 py-4">
                <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                  <div className="mb-1 text-13 font-bold">Compte</div>
                  <div className="mb-4 text-sm text-chalk-3">{profile.email}</div>
                  <button type="button" onClick={logout}
                    className="flex h-(--h-tap) w-full items-center justify-center gap-2
                      rounded-(--radius-input) border border-danger bg-transparent
                      text-13 font-bold text-danger transition-colors hover:bg-danger
                      hover:text-chalk">
                    <Icon name="logout" size={14} strokeWidth={2} />
                    Se déconnecter
                  </button>
                </div>

                <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                  <div className="mb-1 text-13 font-bold">Type de compte</div>
                  <p className="mb-3 text-sm leading-[1.5] text-chalk-3">
                    Le type de compte décrit qui vous êtes ; il ne vérifie rien. Le
                    cachet se demande plus bas, et il s&apos;obtient après examen.
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-12 font-semibold uppercase tracking-[0.06em]
                      text-chalk-3">
                      {accountLabel(profile.account_type)}
                    </span>
                    <button
                      type="button"
                      disabled={switchingType}
                      onClick={() => void switchAccountType(profile.account_type)}
                      className="mo-press inline-flex h-(--h-tap) items-center gap-2
                        rounded-(--radius-input) border border-line-3 px-3.5
                        text-12 font-bold text-chalk-2 transition-colors
                        hover:border-signal hover:text-signal disabled:opacity-40"
                    >
                      <Icon name="globe" size={12} strokeWidth={2} />
                      {switchingType ? "…" : accountLabel(profile.account_type) === "Étudiant"
                        ? "Passer en professionnel"
                        : "Passer en étudiant"}
                    </button>
                  </div>
                </div>

                {/*
                  La demande de vérification — le flux qui manquait : la
                  copie parlait d'un « badge demandable » sans jamais
                  proposer de le demander. Un seul dossier à la fois, car
                  `verification_status` est une colonne, pas une table :
                  `attente` remplace `none`, `acceptee` remplace `attente`.
                */}
                <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                  <div className="mb-1 flex items-center gap-2 text-13 font-bold">
                    <Icon name="verified" size={14} strokeWidth={2} />
                    Vérification
                    <span className="rounded-(--radius-chip) border-(--bw-thin)
                      border-line-3 px-1.5 py-0.5 font-mono text-12 font-bold
                      uppercase tracking-[0.1em] text-chalk-3">
                      {VERIFY_STATUS_LABEL[verifyStatus]}
                    </span>
                  </div>

                  <p className="mb-3 text-sm leading-[1.5] text-chalk-3">
                    {verifyStatus === "none" &&
                      "Le cachet atteste du nom affiché. Une demande, un examen : il ne s'obtient pas seul."}
                    {verifyStatus === "attente" &&
                      "Demande en attente — un administrateur la tranchera. Vous pouvez la retirer."}
                    {verifyStatus === "refusee" &&
                      "Demande refusée. Vous pouvez en soumettre une nouvelle en précisant ce qui manque."}
                    {verifyStatus === "acceptee" &&
                      "Compte vérifié. Le palier affiché suit votre XP ; il ne se retire pas en changeant de type de compte."}
                  </p>

                  {verifyStatus === "attente" && profile.verification_note && (
                    <p className="mb-3 border-l border-line-2 pl-2.5 text-12
                      leading-relaxed text-chalk-2">
                      {profile.verification_note}
                    </p>
                  )}

                  {verifyStatus !== "acceptee" && verifyStatus !== "attente" && (
                    <textarea
                      aria-label="Note de vérification"
                      value={verifyNote}
                      onChange={(e) => setVerifyNote(e.target.value)}
                      rows={3}
                      maxLength={400}
                      placeholder="Nom réel, lien GitHub ou professionnel, pourquoi ce cachet…"
                      className="mb-2 w-full resize-none rounded-(--radius-input)
                        border border-line-2 bg-base px-3 py-2 text-13 text-chalk
                        placeholder:text-chalk-4 focus:border-signal"
                    />
                  )}

                  <div className="flex gap-2">
                    {(verifyStatus === "none" || verifyStatus === "refusee") && (
                      <button
                        type="button"
                        disabled={verifyBusy}
                        onClick={() => void sendVerification()}
                        className="mo-press inline-flex h-(--h-tap) flex-1
                          items-center justify-center gap-2 rounded-(--radius-input)
                          border border-signal bg-signal/10 text-12 font-bold
                          text-signal transition-colors hover:bg-signal/20
                          disabled:opacity-40"
                      >
                        <Icon name="verified" size={14} strokeWidth={2.4} />
                        {verifyBusy ? "…" : "Demander la vérification"}
                      </button>
                    )}

                    {verifyStatus === "attente" && (
                      <button
                        type="button"
                        disabled={verifyBusy}
                        onClick={() => void cancelVerification()}
                        className="mo-press inline-flex h-(--h-tap) flex-1
                          items-center justify-center gap-2 rounded-(--radius-input)
                          border border-line-3 text-12 font-bold text-chalk-3
                          transition-colors hover:border-danger hover:text-danger
                          disabled:opacity-40"
                      >
                        <Icon name="close" size={14} strokeWidth={2.4} />
                        {verifyBusy ? "…" : "Annuler la demande"}
                      </button>
                    )}
                  </div>

                  {profile.is_admin && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Link
                        href="/admin"
                        className="inline-flex items-center gap-1.5 font-mono text-12
                          font-bold text-signal hover:underline"
                      >
                        <Icon name="lock" size={11} strokeWidth={2.4} />
                        Panneau d&apos;administration                      </Link>
                      <Link
                        href="/moderation"
                        className="inline-flex items-center gap-1.5 font-mono text-12
                          font-bold text-chalk-2 hover:underline"
                      >
                        <Icon name="flag" size={11} strokeWidth={2.4} />
                        Modération
                      </Link>
                    </div>
                  )}

                  {/* L'échelle des cachets : sans elle, on ne voit jamais
                      que le sien. Le palier atteint s'y détache par la
                      taille ; le survol donne le titre de chaque forme. */}
                  <div className="mt-3 border-t border-line-2 pt-3">
                    <p className="mb-2 font-mono text-12 font-bold uppercase
                      tracking-[0.1em] text-chalk-4">
                      Les onze cachets
                    </p>
                    <BadgeGallery
                      earned={badgeFor(profile, progress?.stats.xp ?? 0)?.index ?? -1}
                    />
                  </div>
                </div>

                <div className="rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
                  <div className="mb-1 text-13 font-bold">Mes données</div>
                  <p className="mb-3 text-sm leading-[1.5] text-chalk-3">
                    Toutes vos données en un fichier JSON.
                  </p>
                  <button type="button" disabled={exporting} onClick={exportData}
                    className="flex h-(--h-tap) w-full items-center justify-center gap-2
                      rounded-(--radius-input) border border-line-2 bg-transparent
                      text-13 font-bold text-chalk-2 transition-colors
                      hover:border-signal hover:text-signal disabled:opacity-40">
                    <Icon name="download" size={14} strokeWidth={2} />
                    {exporting ? "Export en cours…" : "Exporter mes données"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {/* La célébration se monte avec la page : le palier franchi entre
          deux visites est annoncé ici, où la progression se lit. */}
      <LevelCelebration xp={progress?.stats.xp} />
    </AppShell>
  );
}
/**
 * Formulaire d'édition isolé : il s'initialise depuis le profil reçu en
 * prop, donc pas d'effet nécessaire pour pré-remplir les champs.
 */
function EditForm({
  profile,
  onCancel,
  onSaved,
}: {
  profile: User;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [prenom, setPrenom] = useState(profile.prenom ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [filiere, setFiliere] = useState(profile.filiere ?? "");
  const [niveau, setNiveau] = useState(profile.niveau ?? "");
  const [ville, setVille] = useState(profile.ville ?? "");
  const [pays, setPays] = useState(profile.pays ?? "");
  const [langages, setLangages] = useState<string[]>(profile.langages ?? []);
  const [color, setColor] = useState<AvatarColor>(profile.avatar_color);
  const [theme, setTheme] = useState(profile.theme ?? DEFAULT_THEME);
  const [links, setLinks] = useState<ProfileLink[]>(profile.links ?? []);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? "");
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  const BIO_MAX = 240;

  /** Bascule un langage : la liste est un ensemble, pas une sélection unique. */
  function toggleLang(l: string) {
    setLangages((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));
  }

  function setLink(i: number, patch: Partial<ProfileLink>) {
    setLinks((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  /** Ajoute un préfixe `https://` aux URL saisies sans schéma (« github.com/… »). */
  function normalizeUrl(raw: string): string {
    const url = raw.trim();
    if (!url) return "";
    return /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
  }

  async function save() {
    const cleanPrenom = prenom.trim();
    if (!cleanPrenom) return toast("Le prénom ne peut pas être vide", "err");

    setSaving(true);
    const cleanLinks: ProfileLink[] = links
      .map((l) => ({ label: l.label.trim(), url: normalizeUrl(l.url) }))
      .filter((l) => l.url)
      .map((l) => ({ label: l.label || l.url.replace(/^https?:\/\//, ""), url: l.url }));

    const { error } = await updateProfile(profile.id, {
      prenom: cleanPrenom,
      bio: bio.trim().slice(0, BIO_MAX),
      filiere,
      niveau,
      ville: ville.trim(),
      pays: pays.trim(),
      langages,
      avatar_color: color,
      avatar_url: avatarUrl,
      theme,
      links: cleanLinks,
    });

    setSaving(false);
    if (error) return toast("Erreur lors de la sauvegarde", "err");
    onSaved();
  }

  // Deux variantes du même champ : `inputBox` sans largeur, pour les champs
  // posés côte à côte (lignes de liens), et `inputCls` pleine largeur.
  const inputBox =
    "h-(--h-input) rounded-(--radius-input) border border-line-3 bg-surface px-3.5 text-14 " +
    "shadow-sh-1 placeholder:text-chalk-4";
  const inputCls = `w-full ${inputBox}`;
  const label = "label mb-1.5 block text-chalk";

  return (
    <div className="mo-slide px-4 py-4">
      <h2 className="mb-4 font-display text-[1.3rem] font-bold">Modifier le profil</h2>

      {/* Aperçu vivant : on voit la couleur d'avatar et le prénom s'accorder
          avant d'enregistrer — sinon on choisit à l'aveugle. */}
      <div className="mb-5 flex items-center gap-3 rounded-(--radius-card) border border-line-3 bg-surface p-3.5">
        <span
          className={`grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border text-[20px] font-bold ${avatarClass(color)}`}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- aperçu d'un média utilisateur, déjà compressé côté serveur
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (prenom.trim()[0] ?? "?").toUpperCase()
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-15 font-bold text-chalk">
            {prenom.trim() || "Sans prénom"}
          </p>
          <p className="truncate text-sm text-chalk-3">
            @{profile.pseudo} · {accountLabel(profile.account_type)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditingAvatar(true)}
              className="inline-flex h-(--h-tap) items-center gap-1.5 rounded-(--radius-input) border border-signal px-3 text-12 font-bold text-signal"
            >
              {avatarUrl ? "Changer la photo" : "Ajouter une photo"}
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={() => setAvatarUrl("")}
                className="inline-flex h-(--h-tap) items-center rounded-(--radius-input) border border-line-3 px-3 text-12 font-bold text-chalk-3 hover:border-danger hover:text-danger"
              >
                Retirer
              </button>
            )}
          </div>
        </div>
      </div>

      {editingAvatar && (
        <AvatarEditor
          currentUrl={avatarUrl || undefined}
          name={profile.pseudo}
          onCancel={() => setEditingAvatar(false)}
          onApply={(url) => {
            setAvatarUrl(url);
            setEditingAvatar(false);
          }}
        />
      )}

      <div className="mb-4">
        <label className={label}>Thème</label>
        <div className="flex flex-wrap gap-2.5">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTheme(t.id); broadcastTheme(t.id); }}
              aria-label={`Thème ${t.label}`}
              aria-pressed={theme === t.id}
              className={`mo-press inline-flex items-center gap-1.5 rounded-(--radius-chip) border px-3 py-1.5 text-12 font-bold
                transition-colors ${
                  theme === t.id
                    ? "border-signal bg-signal/10 text-signal"
                    : "border-line-3 text-chalk-3 hover:border-chalk-3 hover:text-chalk"
                }`}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className={label}>Couleur d&apos;avatar</label>
        <div className="flex gap-2.5">
          {AVATARS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Couleur ${c}`}
              aria-pressed={color === c}
              className={`mo-press grid h-10 w-10 place-items-center rounded-full border-2 text-15 font-bold
                transition-transform ${avatarClass(c)} ${
                  color === c ? "scale-110 border-chalk" : "border-transparent opacity-70 hover:opacity-100"
                }`}
            >
              {(prenom.trim()[0] ?? "?").toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className={label}>Prénom</label>
        <input
          aria-label="Prénom"
          value={prenom}
          onChange={(e) => setPrenom(e.target.value)}
          placeholder="Ton prénom"
          className={inputCls}
        />
      </div>

      <div className="mb-4">
        <label className={label}>Pseudo</label>
        <input value={profile.pseudo} aria-label="Pseudonyme" disabled className={`${inputCls} cursor-not-allowed opacity-60`} />
        <p className="mt-1.5 text-12 text-chalk-4">
          Identifiant public (URL, mentions) — non modifiable.
        </p>
      </div>

      <div className="mb-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <label className="label text-chalk">Bio</label>
          <span className={`tnum text-12 ${bio.length > BIO_MAX ? "text-err" : "text-chalk-4"}`}>
            {bio.length}/{BIO_MAX}
          </span>
        </div>
        <textarea
          aria-label="Bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          placeholder="Une ligne sur vous…"
          className="w-full rounded-(--radius-input) border border-line-3 bg-surface px-3.5 py-3
            text-14 shadow-sh-1 placeholder:text-chalk-4"
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Filière</label>
          <select value={filiere} aria-label="Filière" onChange={(e) => setFiliere(e.target.value)}
            className={`${inputCls} cursor-pointer`}>
            {FILIERES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Niveau</label>
          <select value={niveau} aria-label="Niveau" onChange={(e) => setNiveau(e.target.value)}
            className={`${inputCls} cursor-pointer`}>
            {NIVEAUX.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Ville</label>
          <input value={ville} aria-label="Ville" onChange={(e) => setVille(e.target.value)}
            placeholder="Abidjan" className={inputCls} />
        </div>
        <div>
          <label className={label}>Pays</label>
          <input value={pays} aria-label="Pays" onChange={(e) => setPays(e.target.value)}
            placeholder="Côte d'Ivoire" className={inputCls} />
        </div>
      </div>

      <div className="mb-4">
        <label className={label}>Langages</label>
        <div className="flex flex-wrap gap-2">
          {LANGAGES.map((l) => {
            const on = langages.includes(l);
            return (
              <button
                key={l}
                type="button"
                onClick={() => toggleLang(l)}
                aria-pressed={on}
                className={`rounded-(--radius-chip) border px-3 py-1.5 text-sm font-semibold
                  transition-colors ${
                    on
                      ? "border-signal bg-signal/12 text-chalk"
                      : "border-line-3 text-chalk-3 hover:border-line-2 hover:text-chalk-2"
                  }`}
              >
                {l}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-5">
        <label className={label}>Liens</label>
        <div className="flex flex-col gap-2">
          {links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label="Libellé du lien"
                value={l.label}
                onChange={(e) => setLink(i, { label: e.target.value })}
                placeholder="GitHub"
                className={`${inputBox} w-[38%]`}
              />
              <input
                aria-label="URL du lien"
                value={l.url}
                onChange={(e) => setLink(i, { url: e.target.value })}
                placeholder="github.com/vous"
                className={`${inputBox} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => setLinks((cur) => cur.filter((_, idx) => idx !== i))}
                aria-label="Retirer ce lien"
                className="mo-press grid h-(--h-input) w-10 shrink-0 place-items-center
                  rounded-(--radius-input) border border-line-3 text-chalk-3
                  transition-colors hover:text-danger"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
          {links.length < 6 && (
            <button
              type="button"
              onClick={() => setLinks((cur) => [...cur, { label: "", url: "" }])}
              className="flex h-(--h-tap) items-center justify-center gap-1.5 rounded-(--radius-input)
                border border-dashed border-line-3 text-13 font-bold text-chalk-2
                transition-colors hover:border-chalk-3 hover:text-chalk"
            >
              <Icon name="plus" size={16} /> Ajouter un lien
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2.5">
        <button type="button" onClick={onCancel}
          className="rounded-(--radius-input) border border-transparent px-5 text-13
            font-bold text-chalk-2 transition-colors hover:bg-surface-2 hover:text-chalk">
          Annuler
        </button>
        <button type="button" onClick={save} disabled={saving}
          className="mo-press flex h-(--h-tap) flex-1 items-center justify-center rounded-(--radius-input)
            border border-line-3 bg-signal text-13 font-bold text-void shadow-sh-2
            disabled:opacity-40">
          Enregistrer
        </button>
      </div>
    </div>
  );
}
