"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell, IconButton } from "@/components/AppShell";
import { EmptyState, Loading } from "@/components/Avatar";
import { Icon, asIconName } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import {
  activeFilterCount,
  applyFilters,
  compatibility,
  EMPTY_FILTERS,
  PROJECT_STAGES,
  roleLabel,
  SEEKING_ROLES,
  stageSpec,
  type Candidate,
  type ProjectDemand,
  type ProjectFilters,
  type ProjectStage,
  type SeekingRole,
} from "@/lib/match";
import { applyToProject, candidateFrom, loadProofsForUser } from "@/lib/reputation";
import {
  createProject,
  fetchDiscoverProjects,
  fetchProjects,
  summarizeRepoScores,
  type RepoScoreSummary,
} from "@/lib/repo";
import { ScoreTrajectory } from "@/components/ScoreTrajectory";
import { timeAgo } from "@/lib/utils";
import type { Project } from "@/lib/types";

/**
 * Les projets.
 *
 * Un projet est un **dépôt** : des fichiers, des révisions, des
 * contributeurs. Ce n'est pas une collection de liens, et c'est
 * volontairement le seul écran où l'on crée quelque chose de
 * construction — parce que c'est le seul endroit où l'on crée un dépôt.
 *
 * Depuis le §6, cet écran est aussi celui du **rapprochement** : un projet
 * s'y publie avec son stade et ce qu'il cherche, les autres le filtrent,
 * voient un pourcentage de compatibilité calculé sur leurs **preuves**, et
 * postulent. Le pourcentage ne se décore pas : il se lit dans
 * `lib/match.ts`, et il ne pèse une déclaration qu'à 15 %.
 */
export default function ProjectsPage() {
  const { profile } = useSession();
  const router = useRouter();
  const toast = useToast();

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [filters, setFilters] = useState<ProjectFilters>(EMPTY_FILTERS);
  /**
   * « découvrir » ou « mes projets ».
   *
   * La découverte est l'état par défaut depuis le §6 : c'est là qu'on
   * filtre et qu'on postule. « Mes projets » reste à un geste, parce
   * qu'on revient souvent travailler sur le sien.
   */
  const [scope, setScope] = useState<"discover" | "mine">("discover");

  // Nouveau projet
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("");
  const [stage, setStage] = useState<ProjectStage>("idea");
  const [seeking, setSeeking] = useState(false);
  const [demandLanguages, setDemandLanguages] = useState("");
  const [demandRoles, setDemandRoles] = useState<SeekingRole[]>([]);
  const [busy, setBusy] = useState(false);

  // Candidature
  const [applyTo, setApplyTo] = useState<Project | null>(null);
  const [applyRole, setApplyRole] = useState("");
  const [applyMessage, setApplyMessage] = useState("");
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setProjects(null);
    const [list, proofs] = await Promise.all([
      scope === "mine" ? fetchProjects(profile.id) : fetchDiscoverProjects(),
      loadProofsForUser(profile.id),
    ]);
    setProjects(list);
    setCandidate(candidateFrom(profile, proofs));
  }, [profile, scope]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  /**
   * La trajectoire des **dépôts de l'utilisateur**, calculée à part.
   *
   * Elle se calcule après l'affichage, et uniquement sur « mes projets » :
   * noter des dépôts demande de lire leurs fichiers, et faire attendre la
   * liste — qui doit s'ouvrir vite — sur un chiffre de synthèse serait un
   * mauvais échange. Sur « découvrir », il n'y a rien à tracer : la
   * trajectoire de dépôts qui ne sont pas les siens ne veut rien dire.
   *
   * Le résultat est attaché à sa clé de requête plutôt que réinitialisé en
   * début d'effet — même raison que le panneau de score : un `setState`
   * synchrone dans un effet déclenche des rendus en cascade, et une réponse
   * tardive d'une autre liste ne peut pas s'afficher sous la liste courante.
   */
  const [ownScores, setOwnScores] = useState<
    { key: string; value: RepoScoreSummary } | null
  >(null);
  const scoresKey = `${scope}#${(projects ?? []).map((p) => p.id).join(",")}`;

  useEffect(() => {
    if (scope !== "mine" || !projects || projects.length < 2) return;

    let alive = true;
    void summarizeRepoScores(projects)
      .then((value) => {
        if (alive) setOwnScores({ key: scoresKey, value });
      })
      .catch(() => {
        // Une trajectoire illisible ne doit pas casser la liste : elle
        // n'apparaît pas, et c'est tout.
      });

    return () => {
      alive = false;
    };
  }, [scope, projects, scoresKey]);

  const currentScores = ownScores && ownScores.key === scoresKey ? ownScores.value : null;

  /**
   * La liste filtrée.
   *
   * `applyFilters` travaille sur la forme de `lib/match.ts` — un langage de
   * projet **ou** un langage demandé, un stade en seuil, un rôle. On lui
   * donne donc la projection des colonnes, puis on retrouve le projet.
   */
  const visible = useMemo(() => {
    if (!projects) return [];
    const rows = projects.map((p) => ({
      project: p,
      language: p.language,
      stage: p.stage,
      seeking: p.seeking,
      demandLanguages: p.demand_languages,
      demandRoles: p.demand_roles,
    }));
    return applyFilters(rows, filters);
  }, [projects, filters]);

  /** Tous les langages cités par un projet — pour proposer un filtre juste. */
  const languageOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects ?? []) {
      if (p.language) set.add(p.language);
      for (const l of p.demand_languages) set.add(l);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const active = activeFilterCount(filters);

  function demandOf(p: Project): ProjectDemand {
    return {
      stage: p.stage,
      languages: p.demand_languages,
      roles: p.demand_roles,
      seeking: p.seeking,
    };
  }

  function toggleFilter<K extends keyof ProjectFilters>(key: K, value: ProjectFilters[K]) {
    setFilters((f) => ({ ...f, [key]: f[key] === value ? EMPTY_FILTERS[key] : value }));
  }

  async function submit() {
    if (!profile) return;

    setBusy(true);
    const { project, error } = await createProject({
      name,
      description,
      language,
      stage,
      seeking,
      demandLanguages: demandLanguages
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
      demandRoles,
      owner: profile,
    });
    setBusy(false);

    if (error || !project) {
      toast(error ?? "Création impossible.", "err");
      return;
    }

    setOpen(false);
    setName("");
    setDescription("");
    setLanguage("");
    setStage("idea");
    setSeeking(false);
    setDemandLanguages("");
    setDemandRoles([]);
    // On entre directement dans le dépôt : un projet vide n'a rien à
    // montrer, et le lecteur veut immédiatement écrire quelque chose.
    router.push(`/projects/${project.id}`);
  }

  async function submitApplication() {
    if (!profile || !applyTo) return;
    setApplying(true);
    const { error } = await applyToProject({
      projectId: applyTo.id,
      userId: profile.id,
      role: applyRole || applyTo.demand_roles[0] || "developpement",
      message: applyMessage,
    });
    setApplying(false);

    if (error) {
      toast(error, "err");
      return;
    }
    toast("Candidature envoyée.", "ok");
    setApplyTo(null);
    setApplyMessage("");
    setApplyRole("");
  }

  return (
    <AppShell
      title="Projets"
      path="~/projets"
      action={
        <IconButton label="Nouveau projet" name="plus" dataTour="projects-new" onClick={() => setOpen(true)} />
      }
    >
      <div className="px-(--gutter) pt-3" data-tour="projects-list">
        <Motion role="slide" delay={40}>
          <p className="mb-4 text-[13px] leading-relaxed text-chalk-3">
            Chaque projet est un dépôt. Ceux qui recrutent affichent votre compatibilité.
          </p>
        </Motion>

        <div className="mb-3 inline-flex rounded-[var(--radius-chip)] border border-line-2 bg-surface-2 p-0.5 shadow-sh-1">
          {([["discover", "Découvrir"], ["mine", "Mes projets"]] as const).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                aria-pressed={scope === value}
                className={`mo-press rounded-[var(--radius-chip)] px-3 py-1.5 font-mono text-[11.5px]
                  transition-colors ${scope === value
                    ? "bg-signal/15 text-signal-d"
                    : "text-chalk-3 hover:text-chalk"}`}
              >
                {label}
              </button>
            ),
          )}
        </div>

        {projects && projects.length > 0 && (
          <FilterBar
            filters={filters}
            active={active}
            languages={languageOptions}
            onToggle={toggleFilter}
            onReset={() => setFilters(EMPTY_FILTERS)}
            onSet={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
          />
        )}

        {projects === null && <Loading label="Lecture des projets" />}

        {projects?.length === 0 && (
          <EmptyState
            icon={<Icon name="package" size={20} strokeWidth={1.5} />}
            title="Aucun projet"
            action={
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mo-press inline-flex h-[var(--h-tap)] items-center gap-2
                  rounded-[var(--radius-input)] border border-signal bg-signal
                  px-4 text-[13px] font-bold text-void shadow-sh-2"
              >
                <Icon name="plus" size={14} strokeWidth={2} />
                Nouveau projet
              </button>
            }
          />
        )}

        {scope === "mine" && currentScores && (
          <div className="mb-3">
            <ScoreTrajectory series={currentScores.series} stats={currentScores.trajectory} />
          </div>
        )}

        {projects && projects.length > 0 && visible.length === 0 && (
          <EmptyState
            icon={<Icon name="target" size={20} strokeWidth={1.5} />}
            title="Aucun projet ne correspond"
            action={
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="mo-press inline-flex h-[var(--h-tap)] items-center gap-2
                  rounded-[var(--radius-input)] border border-line-3 bg-surface
                  px-4 text-[13px] font-bold text-chalk-2 shadow-sh-1"
              >
                <Icon name="close" size={14} strokeWidth={2} />
                Effacer les filtres
              </button>
            }
          />
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {visible.map(({ project: p }, i) => {
            const match = candidate ? compatibility(candidate, demandOf(p)) : null;
            const spec = stageSpec(p.stage);

            return (
              <Motion key={p.id} role="rise" delay={Math.min(i * 50, 300)}>
                <div
                  className="group flex h-full flex-col rounded-[var(--radius-card)] border border-line-2 bg-surface
                    px-3.5 py-3 shadow-sh-1 transition-colors hover:border-signal"
                >
                  <Link href={`/projects/${p.id}`} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-input)]
                        border border-line-2 bg-surface-2 text-signal-d"
                    >
                      <Icon name={asIconName(p.emoji, "layers")} size={18} strokeWidth={1.7} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-display text-[15px] font-bold text-chalk">
                          {p.name}
                        </span>
                        <Icon
                          name="branch"
                          size={11}
                          className="shrink-0 text-chalk-4 transition-colors group-hover:text-signal"
                        />
                      </span>

                      {p.description && (
                        <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-chalk-3">
                          {p.description}
                        </span>
                      )}
                    </span>

                    {match && p.seeking && (
                      <CompatibilityBadge score={match.score} tone={match.verdict.tone} label={match.verdict.label} />
                    )}
                  </Link>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-chalk-4">
                    <span className="inline-flex items-center gap-1 rounded-[var(--radius-chip)] border border-line-2 px-1.5 py-0.5">
                      <Icon name="target" size={11} />
                      {spec.label}
                    </span>
                    {p.language && (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="code" size={11} />
                        {p.language}
                      </span>
                    )}
                    <span>{timeAgo(p.created_at)}</span>
                  </div>

                  {p.seeking && (p.demand_languages.length > 0 || p.demand_roles.length > 0) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {p.demand_languages.map((l) => (
                        <span
                          key={`dl-${l}`}
                          className="rounded-[var(--radius-chip)] border border-line-2 bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-chalk-3"
                        >
                          {l}
                        </span>
                      ))}
                      {p.demand_roles.map((r) => (
                        <span
                          key={`dr-${r}`}
                          className="rounded-[var(--radius-chip)] border border-signal/40 bg-signal/10 px-1.5 py-0.5 font-mono text-[10.5px] text-signal-d"
                        >
                          {roleLabel(r)}
                        </span>
                      ))}
                    </div>
                  )}

                  {p.seeking && p.created_by !== profile?.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setApplyTo(p);
                        setApplyRole(p.demand_roles[0] ?? "developpement");
                        setApplyMessage("");
                      }}
                      className="mo-press mt-3 inline-flex h-[var(--h-tap)] items-center justify-center gap-2
                        self-start rounded-[var(--radius-input)] border border-signal bg-signal px-3.5
                        text-[13px] font-bold text-void shadow-sh-2"
                    >
                      <Icon name="send" size={14} strokeWidth={2} />
                      Postuler
                    </button>
                  )}
                </div>
              </Motion>
            );
          })}
        </div>
      </div>

      {/* ── Nouveau projet ──
          Le nom suffit à créer un dépôt fonctionnel. Le stade et ce que le
          projet cherche se déclarent ici parce que sans eux il n'entre dans
          aucun filtre et n'a de compatibilité avec personne : publier un
          projet muet, c'est le publier pour rien. */}
      <Sheet open={open} onClose={() => setOpen(false)} title="Nouveau projet">
        <label htmlFor="proj-name" className="prompt-label mb-1.5 block text-chalk-2">
          nom du projet
        </label>
        <input
          id="proj-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="registre-cooperatives"
          autoFocus
          className="mb-4 h-[var(--h-input)] w-full rounded-[var(--radius-input)]
            border border-line-3 bg-surface px-3.5 text-[14px] shadow-sh-1 outline-none
            transition-[transform,box-shadow] duration-[var(--d-base)]
            ease-[var(--ease-spring)] placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]"
        />

        <label htmlFor="proj-desc" className="prompt-label mb-1.5 block text-chalk-2">
          description <span className="text-chalk-4">— facultatif</span>
        </label>
        <textarea
          id="proj-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Ce que ce dépôt fait, en une phrase."
          className="mb-4 w-full rounded-[var(--radius-input)] border border-line-3
            bg-surface px-3.5 py-3 text-[14px] shadow-sh-1 outline-none
            transition-[transform,box-shadow] placeholder:text-chalk-4
            focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]"
        />

        <div className="mb-4 grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="proj-lang" className="prompt-label mb-1.5 block text-chalk-2">
              langage principal
            </label>
            <input
              id="proj-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="Python"
              className="h-[var(--h-input)] w-full rounded-[var(--radius-input)]
                border border-line-3 bg-surface px-3.5 text-[14px] shadow-sh-1 outline-none
                placeholder:text-chalk-4
                focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]"
            />
          </div>
          <div>
            <label htmlFor="proj-stage" className="prompt-label mb-1.5 block text-chalk-2">
              stade
            </label>
            <select
              id="proj-stage"
              value={stage}
              onChange={(e) => setStage(e.target.value as ProjectStage)}
              className="h-[var(--h-input)] w-full rounded-[var(--radius-input)]
                border border-line-3 bg-surface px-3 text-[14px] shadow-sh-1 outline-none
                focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]"
            >
              {PROJECT_STAGES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <span className="mb-1.5 block prompt-label text-chalk-2">recherche des membres</span>
        <label className="mb-4 flex items-center gap-2.5 text-[13px] text-chalk-2">
          <input
            type="checkbox"
            checked={seeking}
            onChange={(e) => setSeeking(e.target.checked)}
            className="size-4 accent-[#FF8A3D]"
          />
          Ce projet recrute.
        </label>

        {seeking && (
          <>
            <label htmlFor="proj-demand-langs" className="prompt-label mb-1.5 block text-chalk-2">
              langages recherchés <span className="text-chalk-4">— séparés par des virgules</span>
            </label>
            <input
              id="proj-demand-langs"
              value={demandLanguages}
              onChange={(e) => setDemandLanguages(e.target.value)}
              placeholder="Python, SQL"
              className="mb-4 h-[var(--h-input)] w-full rounded-[var(--radius-input)]
                border border-line-3 bg-surface px-3.5 text-[14px] shadow-sh-1 outline-none
                placeholder:text-chalk-4
                focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]"
            />

            <span className="mb-1.5 block prompt-label text-chalk-2">rôles recherchés</span>
            <div className="mb-5 flex flex-wrap gap-1.5">
              {SEEKING_ROLES.map((r) => {
                const on = demandRoles.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() =>
                      setDemandRoles((prev) =>
                        on ? prev.filter((x) => x !== r.id) : [...prev, r.id],
                      )
                    }
                    className={`mo-press rounded-[var(--radius-chip)] border px-2.5 py-1 font-mono text-[11px] transition-colors
                      ${on
                        ? "border-signal bg-signal/15 text-signal-d"
                        : "border-line-2 text-chalk-3 hover:border-signal"}`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mo-press h-[var(--h-tap)] flex-1 rounded-[var(--radius-input)]
              border border-transparent text-[13px] font-bold text-chalk-2
              transition-colors hover:bg-surface-2 hover:text-chalk"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="mo-press flex h-[var(--h-tap)] flex-1 items-center justify-center gap-2
              rounded-[var(--radius-input)] border border-signal bg-signal
              text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-40"
          >
            Créer le projet
          </button>
        </div>
      </Sheet>

      {/* ── Postuler ──
          Une candidature dit **quel rôle** on vient tenir et **un mot** :
          c'est ce que le mainteneur lit pour décider, et ce qui distingue
          une candidature d'un clic. */}
      <Sheet
        open={applyTo !== null}
        onClose={() => setApplyTo(null)}
        title={applyTo ? `Postuler — ${applyTo.name}` : "Postuler"}
      >
        {applyTo && (
          <>
            <p className="mb-4 text-[12.5px] leading-relaxed text-chalk-3">
              {applyTo.demand_languages.length > 0 || applyTo.demand_roles.length > 0
                ? "Ce projet cherche : " +
                  [...applyTo.demand_languages, ...applyTo.demand_roles.map(roleLabel)].join(", ")
                : "Recrute, sans rôle précisé."}
            </p>

            <label htmlFor="apply-role" className="prompt-label mb-1.5 block text-chalk-2">
              rôle visé
            </label>
            <select
              id="apply-role"
              value={applyRole}
              onChange={(e) => setApplyRole(e.target.value)}
              className="mb-4 h-[var(--h-input)] w-full rounded-[var(--radius-input)]
                border border-line-3 bg-surface px-3 text-[14px] shadow-sh-1 outline-none
                focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]"
            >
              {(applyTo.demand_roles.length > 0
                ? applyTo.demand_roles
                : SEEKING_ROLES.map((r) => r.id)
              ).map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>

            <label htmlFor="apply-message" className="prompt-label mb-1.5 block text-chalk-2">
              message
            </label>
            <textarea
              id="apply-message"
              value={applyMessage}
              onChange={(e) => setApplyMessage(e.target.value)}
              rows={3}
              placeholder="Ce que vous apportez, en deux phrases."
              className="mb-5 w-full rounded-[var(--radius-input)] border border-line-3
                bg-surface px-3.5 py-3 text-[14px] shadow-sh-1 outline-none
                placeholder:text-chalk-4
                focus:-translate-x-px focus:-translate-y-px focus:shadow-[3px_3px_0_#FF8A3D]"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setApplyTo(null)}
                className="mo-press h-[var(--h-tap)] flex-1 rounded-[var(--radius-input)]
                  border border-transparent text-[13px] font-bold text-chalk-2
                  transition-colors hover:bg-surface-2 hover:text-chalk"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submitApplication}
                disabled={applying}
                className="mo-press flex h-[var(--h-tap)] flex-1 items-center justify-center gap-2
                  rounded-[var(--radius-input)] border border-signal bg-signal
                  text-[13px] font-bold text-void shadow-sh-2 disabled:opacity-40"
              >
                <Icon name="send" size={14} strokeWidth={2} />
                Envoyer
              </button>
            </div>
          </>
        )}
      </Sheet>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Barre de filtres                                                    */
/* ------------------------------------------------------------------ */

function FilterBar({
  filters,
  active,
  languages,
  onToggle,
  onSet,
  onReset,
}: {
  filters: ProjectFilters;
  active: number;
  languages: string[];
  onToggle: <K extends keyof ProjectFilters>(key: K, value: ProjectFilters[K]) => void;
  onSet: <K extends keyof ProjectFilters>(key: K, value: ProjectFilters[K]) => void;
  onReset: () => void;
}) {
  const selectClass =
    "h-[34px] rounded-[var(--radius-chip)] border border-line-2 bg-surface px-2.5 " +
    "font-mono text-[11.5px] text-chalk-2 shadow-sh-1 outline-none focus:border-signal";

  return (
    <Motion role="slide" delay={80}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-chalk-4">
          <Icon name="search" size={12} />
          filtrer
        </span>

        <select
          aria-label="Langage"
          value={filters.language}
          onChange={(e) => onSet("language", e.target.value)}
          className={selectClass}
        >
          <option value="">Tous langages</option>
          {languages.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <select
          aria-label="Stade"
          value={filters.stage}
          onChange={(e) => onSet("stage", e.target.value as ProjectStage | "")}
          className={selectClass}
        >
          <option value="">Tous stades</option>
          {PROJECT_STAGES.map((s) => (
            <option key={s.id} value={s.id}>au moins : {s.label}</option>
          ))}
        </select>

        <select
          aria-label="Rôle"
          value={filters.role}
          onChange={(e) => onSet("role", e.target.value as SeekingRole | "")}
          className={selectClass}
        >
          <option value="">Tous rôles</option>
          {SEEKING_ROLES.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => onToggle("seekingOnly", true)}
          aria-pressed={filters.seekingOnly}
          className={`mo-press h-[34px] rounded-[var(--radius-chip)] border px-2.5 font-mono text-[11.5px]
            transition-colors ${filters.seekingOnly
              ? "border-signal bg-signal/15 text-signal-d"
              : "border-line-2 text-chalk-3 hover:border-signal"}`}
        >
          recrute
        </button>

        {active > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="mo-press inline-flex h-[34px] items-center gap-1 rounded-[var(--radius-chip)]
              px-2 font-mono text-[11.5px] text-chalk-4 transition-colors hover:text-danger"
          >
            <Icon name="close" size={11} strokeWidth={2} />
            tout voir ({active})
          </button>
        )}
      </div>
    </Motion>
  );
}

/* ------------------------------------------------------------------ */
/* Compatibilité                                                       */
/* ------------------------------------------------------------------ */

function CompatibilityBadge({
  score,
  tone,
  label,
}: {
  score: number;
  tone: "ok" | "warn" | "danger";
  label: string;
}) {
  const color =
    tone === "ok" ? "text-signal-d border-signal/50 bg-signal/12"
    : tone === "warn" ? "text-chalk-2 border-line-3 bg-surface-2"
    : "text-danger border-danger/40 bg-danger/8";

  return (
    <span
      title={`Compatibilité : ${label}`}
      className={`shrink-0 rounded-[var(--radius-input)] border px-2 py-1 text-center ${color}`}
    >
      <span className="tnum block font-display text-[16px] font-bold leading-none">{score}</span>
      <span className="mt-0.5 block font-mono text-[9.5px] uppercase tracking-[0.08em]">% compat.</span>
    </span>
  );
}
