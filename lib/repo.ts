import { supabase } from "@/lib/supabase/client";
import { hashBlob, NULL_SHA } from "@/lib/git/objects";
import {
  ancestorsOf,
  createCommit,
  diffTrees,
  type Commit,
  type FileDiff,
  type RepoFile,
} from "@/lib/git/history";
import { buildTree, normalizePath, pathErrorText, sortPaths } from "@/lib/git/paths";
import { scoreRepo } from "@/lib/scoring/score";
import {
  historyStats,
  newBlobCache,
  scoreEvolution,
  type CachedFile,
  type HistoryPoint,
  type HistoryStats,
  type RepoSnapshot,
} from "@/lib/scoring";
import {
  branchErrorText,
  canDeleteBranch,
  DEFAULT_BRANCH,
  validateBranchName,
} from "@/lib/git/refs";
import type {
  GitCommit, GitCommitFile, GitFile, GitRef, PostProject, Project,
  ProjectRole, ProjectVisibility, UserLite,
} from "@/lib/types";
import type { PostWithAuthor } from "@/lib/types";
import type { ProjectStage, SeekingRole } from "@/lib/match";

/**
 * Le dépôt, côté données.
 *
 * Ce module est le **seul** endroit qui connaît à la fois Postgres et le
 * moteur de dépôt. L'écran ne fait que demander « quels sont les fichiers »,
 * « enregistre ce commit » ; c'est ici que se décide comment une
 * modification devient un commit dont le sha est celui de `git`.
 *
 * Comme partout ailleurs dans le projet, une seule fonction doit répondre
 * la même chose en mode démonstration et sur le vrai backend. Le mode démo
 * n'a pas de transactions : on écrit donc dans un ordre choisi pour qu'une
 * coupure au milieu ne laisse pas d'état incohérent — d'abord l'instantané,
 * puis le commit, puis la référence.
 */

export interface RepoFileState {
  path: string;
  content: string;
  blob_sha: string;
  updated_at: string;
}

/* ── Projets ─────────────────────────────────────────────────────── */

/**
 * Les colonnes d'un projet, à un seul endroit.
 *
 * Le stade, le recrutement et ce qui est recherché (§6) voyagent avec le
 * projet : une carte qui les ignorerait ne pourrait ni filtrer ni calculer
 * une compatibilité. Les nommer ici évite qu'un `select` oublié laisse
 * quatre champs `undefined` — le genre d'oubli qui ne casse rien tant
 * qu'aucun écran ne les lit, puis qui les casse tous d'un coup.
 */
export const PROJECT_FIELDS =
  "id, group_id, created_by, name, slug, description, emoji, language, visibility, default_branch, stage, seeking, demand_languages, demand_roles, created_at";

/**
 * Les projets d'un compte : ceux qu'il a créés, plus ceux dont il est
 * membre. Un projet appartient souvent à un groupe, donc « mes projets »
 * ne peut pas se réduire à « les miens ».
 */
export async function fetchProjects(userId: string): Promise<Project[]> {
  const [{ data: created }, { data: memberships }] = await Promise.all([
    supabase
      .from("projects")
      .select(PROJECT_FIELDS)
      .eq("created_by", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId),
  ]);

  const ids = ((memberships as { project_id: string }[]) ?? []).map((m) => m.project_id);
  if (ids.length === 0) return (created as Project[]) ?? [];

  const { data: joined } = await supabase
    .from("projects")
    .select(PROJECT_FIELDS)
    .in("id", ids);

  // Un projet créé peut aussi être un membre : on ne le montre pas deux fois.
  const seen = new Set(((created as Project[]) ?? []).map((p) => p.id));
  const rest = ((joined as Project[]) ?? []).filter((p) => !seen.has(p.id));

  return [...(created as Project[] ?? []), ...rest];
}

/** Un projet par identifiant. */
export async function fetchProject(id: string): Promise<Project | null> {
  const { data } = await supabase
    .from("projects")
    .select(PROJECT_FIELDS)
    .eq("id", id)
    .maybeSingle();

  return (data as Project) ?? null;
}

/**
 * Les projets **découvrables** — tous ceux que la RLS laisse lire.
 *
 * Le §6 fait de la liste un espace de rapprochement : on y filtre selon
 * ce qu'on sait faire et l'on postule à ce qu'on n'a pas créé. `fetchProjects`
 * ne convient pas pour cela — il ne renvoie que « mes » projets, et l'on
 * ne postule jamais à ce qu'on possède déjà. Ici on lit ce que la base
 * autorise : les projets publics, et ceux des groupes dont on est membre.
 */
export async function fetchDiscoverProjects(): Promise<Project[]> {
  const { data } = await supabase
    .from("projects")
    .select(PROJECT_FIELDS)
    .order("created_at", { ascending: false })
    .limit(200);

  return (data as Project[]) ?? [];
}

/**
 * Les dépôts d'un groupe.
 *
 * `projects.group_id` est la colonne qui rattache un dépôt à un groupe —
 * la fusion groupe ↔ dépôt vit déjà dans le modèle, cette fonction la
 * lit. L'écran d'un groupe montre ces dépôts en bandeau : un groupe est
 * un serveur Discord, et le code s'y écrit dans la même pièce.
 */
export async function fetchProjectsForGroup(groupId: string): Promise<Project[]> {
  const { data } = await supabase
    .from("projects")
    .select(PROJECT_FIELDS)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  return (data as Project[]) ?? [];
}

/**
 * Crée un projet, sa première révision, et son appartenance.
 *
 * Le dépôt naît **déjà commité** : un projet sans révision n'a pas de
 * branche, donc pas d'état de départ. C'est aussi ce que fait `git init`
 * suivi d'un premier commit.
 *
 * Le `slug` sert d'URL et de nom de dossier : on le dérive du nom, et on le
 * rend unique dans le projet pour ne pas dépendre d'une collision.
 */
export async function createProject(options: {
  name: string;
  description?: string;
  language?: string;
  emoji?: string;
  stage?: ProjectStage;
  seeking?: boolean;
  demandLanguages?: string[];
  demandRoles?: SeekingRole[];
  owner: UserLiteForRepo;
}): Promise<{ project: Project | null; error: string | null }> {
  const name = options.name.trim();
  if (!name) return { project: null, error: "Le projet a besoin d'un nom." };

  const slug = slugify(name);
  const branch = "main";

  const { data, error } = await supabase
    .from("projects")
    .insert({
      name,
      slug,
      description: options.description?.trim() ?? "",
      language: options.language ?? "",
      emoji: options.emoji ?? "package",
      stage: options.stage ?? "idea",
      seeking: options.seeking ?? false,
      demand_languages: options.demandLanguages ?? [],
      demand_roles: options.demandRoles ?? [],
      created_by: options.owner.id,
      default_branch: branch,
    })
    .select(PROJECT_FIELDS)
    .single();

  if (error || !data) return { project: null, error: error?.message ?? "Création impossible." };

  const project = data as Project;

  // L'auteur est membre à part entière du projet qu'il vient de créer.
  await supabase
    .from("project_members")
    .insert({ project_id: project.id, user_id: options.owner.id, role: "owner" });

  // La branche `main` existe avant tout commit : elle pointe sur l'arbre
  // vide, comme une branche qui n'a encore rien.
  await supabase
    .from("git_refs")
    .insert({ project_id: project.id, name: branch, kind: "branch", sha: "" });

  return { project, error: null };
}

/** Identité minimale dont le moteur a besoin pour signer un commit. */
export interface UserLiteForRepo {
  id: string;
  prenom: string;
  email: string;
}

/* ── Réglages et membres ─────────────────────────────────────────────── */

/** Champs modifiables d'un projet, une fois qu'il existe. */
export interface ProjectSettingsPatch {
  name?: string;
  description?: string;
  emoji?: string;
  language?: string;
  visibility?: ProjectVisibility;
  stage?: ProjectStage;
  seeking?: boolean;
  demand_languages?: string[];
  demand_roles?: SeekingRole[];
}

/**
 * Met à jour les réglages d'un projet.
 *
 * Le `slug` n'est pas dans le patch : il sert d'adresse et de nom de
 * dossier, et le changer casserait les liens déjà partagés. Un réglage
 * qu'on regrette doit pouvoir se défaire, pas déplacer le projet.
 *
 * La politique `projects_update` (004) borne déjà qui écrit
 * (`can_write_project`) ; l'écran ne propose le formulaire qu'au
 * propriétaire, mais la base reste l'arbitre.
 */
export async function updateProject(
  id: string,
  patch: ProjectSettingsPatch,
): Promise<{ project: Project | null; error: string | null }> {
  if (patch.name !== undefined && !patch.name.trim()) {
    return { project: null, error: "Le projet a besoin d'un nom." };
  }

  const clean: ProjectSettingsPatch = { ...patch };
  if (clean.name !== undefined) clean.name = clean.name.trim();
  if (clean.description !== undefined) clean.description = clean.description.trim();
  if (clean.language !== undefined) clean.language = clean.language.trim();

  const { data, error } = await supabase
    .from("projects")
    .update(clean)
    .eq("id", id)
    .select(PROJECT_FIELDS)
    .single();

  if (error || !data) {
    return { project: null, error: error?.message ?? "Mise à jour impossible." };
  }
  return { project: data as Project, error: null };
}

/**
 * Supprime un projet et tout ce qu'il porte.
 *
 * Les tables filles (`project_members`, `git_*`, issues, tâches…) pointent
 * sur `projects` en `on delete cascade` : une seule ligne à retirer, et le
 * reste suit. La politique `projects_delete` (004) réserve le geste au
 * créateur.
 */
export async function deleteProject(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/** Les colonnes d'auteur minimales, partagées par l'invitation. */
const MEMBER_USER_COLUMNS = "id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau";

/** Change le rôle d'un membre. Réserve owner/maintainer côté base (027). */
export async function setProjectMemberRole(
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/** Retire un membre (soi-même, ou un autre si l'on administre — 027). */
export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/** Ajoute un membre par son identifiant. Réserve owner/maintainer (027). */
export async function addProjectMember(
  projectId: string,
  userId: string,
  role: ProjectRole = "editor",
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("project_members")
    .insert({ project_id: projectId, user_id: userId, role });

  return { error: error?.message ?? null };
}

/**
 * Trouve un compte par son pseudo exact, pour l'inviter.
 *
 * Un pseudo n'est unique qu'à la casse près côté affichage ; on compare
 * sans tenir compte de la casse (`ilike`), mais on ne devine jamais : une
 * saisie partielle ne renvoie rien plutôt qu'un homonyme probable.
 */
export async function findUserByPseudo(
  pseudo: string,
): Promise<{ user: UserLite | null; error: string | null }> {
  const value = pseudo.trim().replace(/^@/, "");
  if (!value) return { user: null, error: null };

  const { data, error } = await supabase
    .from("users")
    .select(MEMBER_USER_COLUMNS)
    .ilike("pseudo", value)
    .maybeSingle();

  if (error) return { user: null, error: error.message };
  return { user: (data as UserLite) ?? null, error: null };
}

/* ── Fichiers ────────────────────────────────────────────────────── */

/**
 * L'état de travail d'une branche : ses fichiers, triés par chemin.
 *
 * Le filtre sur la branche est **obligatoire**, pas une commodité. Avant
 * la migration 012, `git_files` n'avait pas de colonne `branch` et le
 * dépôt n'avait qu'un jeu de fichiers : « basculer » ne changeait que
 * l'étiquette affichée. Chaque branche a maintenant son propre contenu,
 * et c'est ce qui rend une pull request possible — deux branches dont les
 * fichiers sont identiques n'ont rien à comparer.
 *
 * La branche est un paramètre **obligatoire** de toute lecture ou
 * écriture. La laisser facultive avec une valeur par défaut serait
 * commode, et commode signifie « on oublie une fois, et le dépôt perd un
 * fichier sans erreur » : c'est exactement ce qui s'est produit avec
 * l'`upsert` à une colonne (section 16 du MEMO).
 */
export async function fetchRepoFiles(
  projectId: string,
  branch: string = DEFAULT_BRANCH,
): Promise<RepoFileState[]> {
  const { data } = await supabase
    .from("git_files")
    .select("path, content, blob_sha, updated_at")
    .eq("project_id", projectId)
    .eq("branch", branch);

  const rows = (data as (GitFile & { path: string })[]) ?? [];

  return sortPaths(rows.map((r) => String(r.path))).map((path) => {
    const row = rows.find((r) => String(r.path) === path)!;
    return {
      path: String(row.path),
      content: String(row.content ?? ""),
      blob_sha: String(row.blob_sha ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  });
}

/**
 * Le résultat d'une écriture de fichier.
 *
 * `diverged` dit que le fichier a changé **sous** l'appelant : la garde a
 * refusé l'écriture, et rien n'a été touché. Le distinguer d'une erreur
 * ordinaire n'est pas cosmétique — l'appelant doit pouvoir proposer de
 * relire, pas seulement afficher un message.
 */
export interface SaveFileResult {
  error: string | null;
  diverged?: boolean;
}

/**
 * Écrit un fichier dans l'état de travail.
 *
 * Le chemin est normalisé **avant** l'écriture : un chemin qui sort de la
 * racine — `../`, `/etc/passwd`, `a/../../b` — ne doit jamais atteindre la
 * base. C'est le même garde-fou que dans `lib/git/paths.ts`, et il est
 * appliqué ici parce que l'appelant est une saisie utilisateur.
 *
 * Le `blob_sha` est recalculé : c'est lui qui permet de savoir si le
 * contenu a changé sans relire tout le fichier.
 *
 * `expectedSha` est la garde de **divergence**. Fourni, il exige que le
 * contenu enregistré soit exactement celui qu'on avait lu ; sinon rien
 * n'est écrit. `null` veut dire « je crois qu'il n'y a pas de fichier » —
 * c'est le cas d'une création, qui doit échouer si la place est prise.
 * Omis, la garde est inactive : c'est ce qu'il faut pour un appelant qui
 * vient précisément d'écrire, comme la copie d'une branche.
 *
 * C'est le garde-fou que `git` applique à un `push` non forcé, et il est
 * posé **ici** plutôt que dans l'écran : une règle qui ne vit que dans un
 * composant n'est pas vérifiable, et c'est le composant qui l'oubliera en
 * premier.
 */
export async function saveRepoFile(options: {
  projectId: string;
  path: string;
  content: string;
  userId: string;
  branch?: string;
  /** sha attendu du contenu enregistré ; `null` = aucun fichier attendu. */
  expectedSha?: string | null;
}): Promise<SaveFileResult> {
  const normalized = normalizePath(options.path);

  if (!normalized.ok) {
    return { error: pathErrorText(normalized.reason) };
  }

  const path = normalized.path;
  const content = options.content;
  const blobSha = hashBlob(content);
  const size = new TextEncoder().encode(content).length;

  if (options.expectedSha !== undefined) {
    const { data: current } = await supabase
      .from("git_files")
      .select("blob_sha")
      .eq("project_id", options.projectId)
      .eq("branch", options.branch ?? DEFAULT_BRANCH)
      .eq("path", path)
      .maybeSingle();

    const nowSha = (current as { blob_sha?: string } | null)?.blob_sha;
    const expected = options.expectedSha;

    // Absent et `null` sont la même chose : un fichier qui n'existe pas n'a
    // pas de sha. Comparer `undefined` à `null` ferait diverger une
    // création qu'on a soi-même commencée.
    const same = expected === null ? nowSha === undefined || nowSha === null : nowSha === expected;

    if (!same) {
      return {
        error:
          "Le fichier a changé sur la branche depuis votre ouverture — relisez-le avant d'écrire.",
        diverged: true,
      };
    }
  }

  // `upsert` plutôt que insert-then-update : sans clé d'id' sur cette
  // table, la clé primaire est `(project_id, branch, path)`. Deux
  // écritures concurrentes du même fichier ne doivent pas créer deux
  // lignes.
  //
  // La clé de conflit porte les **trois** colonnes. Avec les deux
  // anciennes, écrire le même chemin sur deux branches écrasait l'une
  // par l'autre : le dépôt perdait un fichier, en silence.
  const { error } = await supabase.from("git_files").upsert(
    {
      project_id: options.projectId,
      branch: options.branch ?? DEFAULT_BRANCH,
      path,
      content,
      blob_sha: blobSha,
      size,
      updated_by: options.userId,
    },
    { onConflict: "project_id,branch,path" },
  );

  return { error: error?.message ?? null };
}

/** Supprime un fichier de l'état de travail d'une branche. */
export async function deleteRepoFile(options: {
  projectId: string;
  path: string;
  branch?: string;
}): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("git_files")
    .delete()
    .eq("project_id", options.projectId)
    .eq("branch", options.branch ?? DEFAULT_BRANCH)
    .eq("path", options.path);

  return { error: error?.message ?? null };
}

/* ── Branches ──────────────────────────────────────────────���────── */

/**
 * Crée une branche à partir d'une autre.
 *
 * C'est `git branch <nom> <départ>` **suivi** d'un `checkout` : la
 * nouvelle branche part du commit de sommet de `from`, et reçoit une
 * copie de son état de travail. Sans cette copie, la branche existerait
 * en graphiques et serait vide à l'écran — on verrait un dépôt sans
 * fichier, ce qui est pire qu'une branche absente, puisque tout semble
 * fonctionner.
 *
 * L'ordre des écritures suit la règle du dépôt : **les fichiers, puis la
 * référence**. Une coupure au milieu laisse des fichiers sans branche —
 * invisibles, inoffensifs, nettoyables. L'inverse laisserait une branche
 * affichée et vide, ce que l'utilisateur prendrait pour une perte.
 */
export async function createBranch(options: {
  projectId: string;
  name: string;
  /** Branche de départ — celle dont on prend l'état. */
  from?: string;
}): Promise<{ error: string | null }> {
  const from = options.from ?? DEFAULT_BRANCH;

  const check = validateBranchName(options.name);
  if (!check.ok) return { error: branchErrorText(check.reason) };

  const name = check.name;

  if (name === from) {
    return { error: `La branche « ${name} » existe déjà.` };
  }

  // La comparaison se fait sur le nom **validé** : sans cela, ` main` et
  // `main` passeraient tous deux, et le second créerait un doublon que
  // la base refuse avec un message incompréhensible.
  const { data: existing } = await supabase
    .from("git_refs")
    .select("project_id, name, kind, sha, updated_at")
    .eq("project_id", options.projectId)
    .eq("name", name)
    .maybeSingle();

  if (existing) return { error: `La branche « ${name} » existe déjà.` };

  const { data: files } = await supabase
    .from("git_files")
    .select("path, content, blob_sha, size, updated_by, updated_at")
    .eq("project_id", options.projectId)
    .eq("branch", from);

  // `project_id` vient de `options`, **pas** de la ligne relue.
  //
  // La requête ci-dessus ne demande pas cette colonne — donc
  // `f.project_id` vaut `undefined` — et recopier la valeur relue
  // inserait des lignes sans projet. Le mode démo les acceptait
  // silencieuses ; en PostgreSQL, `project_id` est `not null` et la copie
  // aurait échoué. C'est une divergence entre les deux qui ne se voyait
  // que parce que la démo est plus permissive que la base — voir la
  // règle de la section 14 du MEMO.
  const copied = ((files ?? []) as GitFile[]).map((f) => ({
    project_id: options.projectId,
    branch: name,
    path: f.path,
    content: f.content,
    blob_sha: f.blob_sha,
    size: f.size,
    updated_by: f.updated_by,
    updated_at: f.updated_at,
  }));

  if (copied.length > 0) {
    const { error } = await supabase
      .from("git_files")
      .upsert(copied, { onConflict: "project_id,branch,path" });
    if (error) return { error: error.message };
  }

  // La nouvelle branche démarre sur le **même commit** que celle dont
  // elle part : c'est ce qui fait d'elle une branche et non un projet.
  const { data: parentRef } = await supabase
    .from("git_refs")
    .select("project_id, name, kind, sha, updated_at")
    .eq("project_id", options.projectId)
    .eq("name", from)
    .maybeSingle();

  const { error } = await supabase.from("git_refs").insert({
    project_id: options.projectId,
    name,
    kind: "branch",
    sha: (parentRef as GitRef | null)?.sha ?? "",
  });

  return { error: error?.message ?? null };
}

/**
 * Supprime une branche et ses fichiers.
 *
 * La branche par défaut ne part pas : c'est la règle de git, et surtout
 * c'est celle qui empêche un dépôt de se retrouver sans point de
 * départ — auquel cas plus rien ne s'affiche et plus rien ne se crée.
 */
export async function deleteBranch(options: {
  projectId: string;
  name: string;
  defaultBranch?: string;
  /** Nombre de branches actuelles — au moins une doit rester. */
  remaining?: number;
}): Promise<{ error: string | null }> {
  const defaultBranch = options.defaultBranch ?? DEFAULT_BRANCH;

  const allowed = canDeleteBranch({
    name: options.name,
    defaultBranch,
    remaining: options.remaining ?? 2,
  });

  if (!allowed.ok) return { error: allowed.reason ?? "Suppression impossible." };

  // Fichiers d'abord, référence ensuite — même raison que la création.
  await supabase
    .from("git_files")
    .delete()
    .eq("project_id", options.projectId)
    .eq("branch", options.name);

  const { error } = await supabase
    .from("git_refs")
    .delete()
    .eq("project_id", options.projectId)
    .eq("name", options.name);

  return { error: error?.message ?? null };
}

/* ── Révisions ───────────────────────────────────────────────────── */

const PROJECT_COLUMNS =
  "sha, project_id, parent_sha, author_id, author_name, message, tree, files_changed, insertions, deletions, source, created_at";

/**
 * L'historique d'une branche, de sa tête vers la racine.
 *
 * Deux choix, tous deux déjà defends en section 17 du MEMO :
 *
 * - On lit **toutes** les révisions du projet, pas une page triée par
 *   date. Dès qu'un dépôt a deux branches, l'ordre par `created_at` n'est
 *   plus l'ordre de lecture : on afficherait les révisions d'une autre
 *   branche, intercalées, et une révision pourrait apparaître deux fois
 *   ou pas du tout selon l'horodatage à la seconde près.
 *
 * - L'ordre vient de la **chaîne des parents**, remontée depuis la tête
 *   de branche. C'est la seule autorité juste, et elle est déjà exacte
 *   puisqu'elle a produit les sha.
 *
 * Une branche dont la tête est vide — une branche fraîchement créée,
 * sans révision — renvoie une liste vide. C'est vrai, et c'est mieux
 * qu'un historique qui emprunterait celui d'une autre branche.
 */
export async function fetchCommits(
  projectId: string,
  branch: string = DEFAULT_BRANCH,
): Promise<Commit[]> {
  const [{ data }, head] = await Promise.all([
    supabase
      .from("git_commits")
      .select(PROJECT_COLUMNS)
      .eq("project_id", projectId),
    headCommit(projectId, branch),
  ]);

  const all = ((data as GitCommit[]) ?? []) as Commit[];

  if (!head) return [];

  return ancestorsOf(all, head.sha);
}

/** Les branches d'un projet. */
export async function fetchBranches(projectId: string): Promise<GitRef[]> {
  const { data } = await supabase
    .from("git_refs")
    .select("project_id, name, kind, sha, updated_at")
    .eq("project_id", projectId)
    .eq("kind", "branch")
    .order("name", { ascending: true });

  return (data as GitRef[]) ?? [];
}

/** L'état des fichiers tel qu'il était à un commit. */
async function fetchCommitFiles(projectId: string, sha: string): Promise<RepoFile[]> {
  if (!sha || sha === NULL_SHA) return [];

  const { data } = await supabase
    .from("git_commit_files")
    .select("path, content, blob_sha")
    .eq("project_id", projectId)
    .eq("sha", sha);

  const rows = (data as GitCommitFile[]) ?? [];

  return sortPaths(rows.map((r) => r.path)).map((path) => {
    const row = rows.find((r) => r.path === path)!;
    return {
      path,
      content: String(row.content ?? ""),
      blob_sha: String(row.blob_sha ?? ""),
    };
  });
}

/** Le commit de sommet d'une branche, s'il existe. */
async function headCommit(projectId: string, branch: string): Promise<Commit | null> {
  const { data: ref } = await supabase
    .from("git_refs")
    .select("project_id, name, kind, sha, updated_at")
    .eq("project_id", projectId)
    .eq("name", branch)
    .maybeSingle();

  const sha = (ref as GitRef | null)?.sha ?? "";
  if (!sha) return null;

  const { data } = await supabase
    .from("git_commits")
    .select(PROJECT_COLUMNS)
    .eq("sha", sha)
    .maybeSingle();

  return (data as Commit) ?? null;
}

/**
 * Les modifications non enregistrées sur une branche, par rapport à son
 * commit de sommet.
 *
 * C'est la réponse à « ai-je quelque chose à enregistrer ? », et elle
 * repose entièrement sur l'instantané du parent : sans lui, tout
 * paraîtrait modifié et chaque « Enregistrer » ajouterait une entrée
 * vide.
 *
 * Les fichiers lus sont ceux de la **branche** : comparer l'état de
 * `main` à la tête de `feat/ocr` afficherait comme « modifiés » des
 * fichiers que personne n'a touchés.
 */
export async function fetchPendingChanges(options: {
  projectId: string;
  branch?: string;
}): Promise<{ changes: FileDiff[]; head: Commit | null; files: RepoFile[] }> {
  const branch = options.branch ?? "main";

  const [files, head] = await Promise.all([
    fetchRepoFiles(options.projectId, branch),
    headCommit(options.projectId, branch),
  ]);

  const current: RepoFile[] = files.map((f) => ({
    path: f.path,
    content: f.content,
    blob_sha: f.blob_sha,
  }));

  const parentFiles = head ? await fetchCommitFiles(options.projectId, head.sha) : [];

  return { changes: diffTrees(parentFiles, current), head, files: current };
}

/**
 * Enregistre l'état de travail.
 *
 * L'ordre des écritures n'est pas indifférent. On écrit d'abord
 * l'instantané, puis le commit, puis la référence : si le process meurt
 * entre deux, il reste un instantané orphelin — invisible, inoffensif, et
 * nettoyable. L'inverse laisserait une branche pointant sur un commit dont
 * l'état est inconnu, ce qui produit des diffs faux, donc des commits
 * faux.
 *
 * Renvoie `null` quand il n'y a rien à enregistrer : c'est le comportement
 * de `git commit`, et c'est ce qui évite un historique de commits vides.
 */
export async function commitRepo(options: {
  projectId: string;
  branch?: string;
  message: string;
  author: UserLiteForRepo;
}): Promise<{ commit: Commit | null; error: string | null }> {
  const branch = options.branch ?? "main";

  const { changes, head, files } = await fetchPendingChanges({
    projectId: options.projectId,
    branch,
  });

  if (changes.length === 0) {
    return { commit: null, error: "Rien à enregistrer." };
  }

  const parentFiles = head ? await fetchCommitFiles(options.projectId, head.sha) : [];

  const commit = createCommit({
    files,
    parent: head,
    parentFiles,
    authorId: options.author.id,
    authorName: options.author.prenom,
    authorEmail: options.author.email,
    message: options.message,
  });

  // Le moteur renvoie `null` si le message est vide : on ne fabrique pas
  // une révision sans description, ce serait un commit qu'on ne retrouve
  // plus ensuite.
  if (!commit) return { commit: null, error: "Le message ne peut pas être vide." };

  const row: GitCommit = {
    ...commit,
    project_id: options.projectId,
  };

  const { error: snapshotError } = await supabase.from("git_commit_files").upsert(
    files.map((f) => ({
      project_id: options.projectId,
      sha: commit.sha,
      path: f.path,
      content: f.content,
      blob_sha: hashBlob(f.content),
    })),
    { onConflict: "sha,path" },
  );

  if (snapshotError) {
    return { commit: null, error: snapshotError.message };
  }

  const { error: commitError } = await supabase
    .from("git_commits")
    .insert(row as unknown as Record<string, unknown>);

  if (commitError) return { commit: null, error: commitError.message };

  const { error: refError } = await supabase
    .from("git_refs")
    .upsert(
      {
        project_id: options.projectId,
        name: branch,
        kind: "branch",
        sha: commit.sha,
      },
      { onConflict: "project_id,name" },
    );

  if (refError) return { commit: null, error: refError.message };

  return { commit, error: null };
}

/**
 * Un instantané d'histoire à importer, tel que le route GitHub le rend.
 *
 * `files` porte **l'état complet** attendu à cette révision (le client a
 * déjà appliqué les deltas du fil) — le moteur en a besoin pour calculer
 * l'arbre et le sha, exactement comme un commit local.
 */
export interface HistorySnapshot {
  message: string;
  authorName: string;
  authorEmail: string;
  /** Horodatage d'origine, en secondes. */
  when: number;
  files: RepoFile[];
}

/**
 * Rejoue une histoire importée dans un projet DevNet.
 *
 * C'est le pendant d'écriture de `POST /api/github/import` : le route lit
 * GitHub et renvoie une suite d'états, cette fonction les transforme en
 * commits DevNet dont la chaîne de parents est celle du dépôt d'origine.
 *
 * Trois points tenus :
 *
 * - **Le sha reste celui du moteur.** On ne recopie pas les sha GitHub —
 *   ils dépendent d'objets (auteurs, dates, arbres) que DevNet ne peut pas
 *   reproduire à l'identique. On recalcule donc chaque commit avec
 *   `createCommit`, ce qui garde l'historique lisible, différable et
 *   notable par le même chemin que le reste de l'app.
 * - **Un commit sans message ni différence est écarté**, pas inventé : il
 *   est compté dans `skipped`. C'est ce que ferait `git commit` — et deux
 *   révisions GitHub identiques ne doivent pas devenir deux révisions
 *   DevNet vides.
 * - **Les fichiers d'abord, la référence ensuite** : une coupure laisse au
 *   pire un instantané orphelin, jamais une branche pointant sur un état
 *   inconnu.
 */
export async function importRepoHistory(options: {
  projectId: string;
  /** L'utilisateur DevNet à qui l'import est attribué. */
  authorId: string;
  branch?: string;
  snapshots: HistorySnapshot[];
}): Promise<{ imported: number; skipped: number; error: string | null }> {
  const branch = options.branch ?? DEFAULT_BRANCH;
  if (options.snapshots.length === 0) {
    return { imported: 0, skipped: 0, error: null };
  }

  let parent: Commit | null = null;
  let parentFiles: RepoFile[] = [];
  let imported = 0;
  let skipped = 0;

  for (const snap of options.snapshots) {
    const order = sortPaths(snap.files.map((f) => f.path));
    const files: RepoFile[] = order.map((path) => {
      const found = snap.files.find((f) => f.path === path);
      return { path, content: found?.content ?? "", blob_sha: "" };
    });

    const commit = createCommit({
      files,
      parent,
      parentFiles,
      authorId: options.authorId,
      authorName: snap.authorName,
      authorEmail: snap.authorEmail,
      message: snap.message,
      when: snap.when,
    });

    if (!commit) {
      skipped += 1;
      parentFiles = files;
      continue;
    }

    const row: GitCommit = {
      ...commit,
      project_id: options.projectId,
      source: "github",
    };

    const snapshot = await supabase.from("git_commit_files").upsert(
      files.map((f) => ({
        project_id: options.projectId,
        sha: commit.sha,
        path: f.path,
        content: f.content,
        blob_sha: hashBlob(f.content),
      })),
      { onConflict: "sha,path" },
    );
    if (snapshot.error) {
      return { imported, skipped, error: snapshot.error.message };
    }

    // Le sha d'un commit est global (clé primaire) : réimporter un dépôt
    // déjà copié retrouve les mêmes commits, et les réécrire serait une
    // erreur. `ignoreDuplicates` rend le rejeu idempotent — la référence
    // et l'instantané suffisent alors à rattacher la branche.
    const commitWrite = await supabase
      .from("git_commits")
      .upsert(row as unknown as Record<string, unknown>, {
        onConflict: "sha",
        ignoreDuplicates: true,
      });
    if (commitWrite.error) {
      return { imported, skipped, error: commitWrite.error.message };
    }

    const refWrite = await supabase.from("git_refs").upsert(
      { project_id: options.projectId, name: branch, kind: "branch", sha: commit.sha },
      { onConflict: "project_id,name" },
    );
    if (refWrite.error) {
      return { imported, skipped, error: refWrite.error.message };
    }

    parent = commit;
    parentFiles = files;
    imported++;
  }

  // L'état de travail doit refléter la tête importée : on remplace les
  // fichiers de la branche par ceux du dernier instantané retenu.
  await supabase
    .from("git_files")
    .delete()
    .eq("project_id", options.projectId)
    .eq("branch", branch);

  if (parentFiles.length > 0) {
    const { error } = await supabase.from("git_files").insert(
      parentFiles.map((f) => ({
        project_id: options.projectId,
        branch,
        path: f.path,
        content: f.content,
        blob_sha: hashBlob(f.content),
        size: new TextEncoder().encode(f.content).length,
        updated_by: options.authorId,
      })),
    );
    if (error) return { imported, skipped, error: error.message };
  }

  return { imported, skipped, error: null };
}

/**
 * Le diff entre deux commits.
 *
 * On compare deux instantanés, pas le commit courant : c'est ce qui permet
 * de relire son propre historique au lieu de seulement voir ce qu'on vient
 * de faire.
 */
export async function fetchCommitDiff(options: {
  projectId: string;
  from: string;
  to: string;
}): Promise<FileDiff[]> {
  const [before, after] = await Promise.all([
    fetchCommitFiles(options.projectId, options.from),
    fetchCommitFiles(options.projectId, options.to),
  ]);

  return diffTrees(before, after);
}

/* ── La courbe du score ────────────────────────────────────────── */

/**
 * Nombre de commits tracés par défaut.
 *
 * Chaque point coûte une lecture d'instantané : c'est la **base** qui fixe
 * la limite, pas le moteur, dont l'analyse est mutualisée par le cache. Vingt
 * points font une courbe lisible ; au-delà, on montre un dessin qu'on ne lit
 * plus, au prix d'autant de requêtes.
 */
export const SCORE_HISTORY_LIMIT = 20;

export interface ScoreHistory {
  /** Du plus ancien au plus récent — l'ordre où un temps se lit. */
  points: HistoryPoint[];
  /** Commits disponibles sur la branche, avant troncature. */
  total: number;
  /** Commits ignorés faute d'instantané enregistré. */
  skipped: number;
  /** Analyses évitées grâce au cache, parce que le fichier n'avait pas bougé. */
  reused: number;
}

/**
 * Le score **commit par commit** — la courbe, et non la note.
 *
 * Une note instantanée dit où en est un dépôt ; une courbe dit comment il y
 * est arrivé. C'est la différence entre « ce dépôt vaut 700 » et « ce dépôt
 * est passé de 520 à 700 en six révisions ». La seconde phrase est vérifiable
 * par tout le monde, ce qui est précisément le but : la preuve de travail
 * n'est pas un chiffre, c'est une trajectoire.
 *
 * ## Ce que la fonction fait, dans l'ordre
 *
 * 1. elle lit l'historique de la branche (`git_commits` + `git_refs`) ;
 * 2. elle prend les `limit` commits les plus récents et les **remet dans
 *    l'ordre chronologique** — `fetchCommits` rend du plus récent au plus
 *    ancien, parce que c'est l'ordre d'une liste à l'écran, alors qu'une
 *    courbe se trace du passé vers le présent ;
 * 3. elle lit l'instantané de chaque commit (`git_commit_files`), **en
 *    parallèle** : les requêtes sont indépendantes, les enchaîner
 *    multiplierait l'attente par vingt sans rien apporter ;
 * 4. elle confie le tout à `scoreEvolution`, avec **un seul cache partagé** :
 *    un fichier inchangé entre deux commits n'est analysé qu'une fois.
 *
 * ## Les commits sans instantané sont **écartés**, pas notés zéro
 *
 * Un commit ancien peut précéder la table des instantanés, ou avoir été
 * créé par un chemin qui ne l'a pas remplie. Le noter zéro ferait plonger la
 * courbe à zéro pour un défaut de données, et une courbe qui accuse à tort
 * est pire qu'une courbe incomplète. On les compte dans `skipped`, et
 * l'écran peut le dire.
 */
export async function fetchScoreHistory(options: {
  projectId: string;
  branch?: string;
  limit?: number;
}): Promise<ScoreHistory> {
  const branch = options.branch || DEFAULT_BRANCH;
  const limit = Math.max(1, options.limit ?? SCORE_HISTORY_LIMIT);

  const commits = await fetchCommits(options.projectId, branch);
  if (commits.length === 0) return { points: [], total: 0, skipped: 0, reused: 0 };

  const recent = commits.slice(0, limit).reverse();

  const snapshots = await Promise.all(
    recent.map(async (commit): Promise<RepoSnapshot | null> => {
      const files = await fetchCommitFiles(options.projectId, commit.sha);
      if (files.length === 0) return null;
      return {
        sha: commit.sha,
        at: commit.created_at,
        files: files.map((f) => ({ path: f.path, content: f.content })),
      };
    }),
  );

  const kept = snapshots.filter((s): s is RepoSnapshot => s !== null);
  const cache = newBlobCache<CachedFile>();
  const { history, stats } = scoreEvolution(kept, cache);

  return {
    points: history,
    total: commits.length,
    skipped: recent.length - kept.length,
    reused: stats.hits,
  };
}

/** L'arborescence d'une branche — la même fonction que celle testée par le moteur. */
export async function fetchTree(projectId: string, branch: string = DEFAULT_BRANCH) {
  const files = await fetchRepoFiles(projectId, branch);
  return buildTree(files.map((f) => f.path));
}

/* ── Publications d'un projet ──────────────────────────────────── */

/**
 * Les projets d'un compte, avec leurs nombres.
 *
 * Les compteurs — publications, révisions, dernière activité — sont lus en
 * trois requêtes parallèles puis assemblés, plutôt qu'en comptant ligne à
 * ligne. Un `count(*)` par projet sur une liste de dix projets, c'est dix
 * requêtes pour un chiffre qu'on lit déjà ailleurs.
 */
export async function fetchProjectsWithCounts(userId: string): Promise<ProjectCard[]> {
  const projects = await fetchProjects(userId);
  if (projects.length === 0) return [];

  const ids = projects.map((p) => p.id);

  const [links, commits, refs] = await Promise.all([
    supabase.from("post_projects").select("project_id").in("project_id", ids),
    supabase.from("git_commits")
      .select(PROJECT_COLUMNS)
      .in("project_id", ids)
      .order("created_at", { ascending: false }),
    supabase.from("git_refs").select("project_id, name, kind, sha, updated_at")
      .eq("kind", "branch").in("project_id", ids),
  ]);

  const linkRows = (links.data as PostProject[]) ?? [];
  const commitRows = (commits.data as (GitCommit & { project_id: string })[]) ?? [];
  const refRows = (refs.data as GitRef[]) ?? [];

  // L'ordre des révisions ne vient **pas** de `created_at`.
  //
  // Deux commits écrits dans la même seconde ont le même horodatage,
  // et le tri devient alors instable : la carte peut afficher « ajoute une
  // note » comme dernière révision alors que « ajoute une ligne » l'est.
  //
  // Un dépôt donne l'ordre par la **chaîne des parents** : on part de la
  // tête de branche et on remonte `parent_sha`. C'est ce que fait git, et
  // c'est la seule chose qui reste juste quand deux révisions tombent dans
  // la même seconde.
  const bySha = new Map(commitRows.map((c) => [c.sha, c]));

  return projects.map((project) => {
    // La branche affichée est la **branche par défaut** du projet. Avant
    // les branches multiples, il n'y avait qu'une référence et n'importe
    // laquelle convenait ; dès qu'un dépôt en a deux, prendre « la
    // première venue » affiche la mauvaise — et une carte qui annonce
    // « main » quand le projet est sur autre chose est un mensonge que
    // l'utilisateur met du temps à découvrir.
    const refs = refRows.filter((r) => r.project_id === project.id);
    const branchRef =
      refs.find((r) => r.name === project.default_branch) ?? refs[0];

    const chain: (GitCommit & { project_id: string })[] = [];

    let cursor = branchRef?.sha ?? "";
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const commit = bySha.get(cursor);
      if (!commit) break;
      chain.push(commit);
      cursor = commit.parent_sha;
    }

    // Le compteur compte les révisions **réellement connues** du projet,
    // pas la longueur de la chaîne : une branche peut avoir été réécrite,
    // et le nombre affiché doit refléter ce qui existe, pas ce qui mène
    // à la tête. La chaîne, elle, ne sert qu'à retrouver la tête.
    const known = commitRows.filter((c) => c.project_id === project.id);

    return {
      ...project,
      postCount: linkRows.filter((l) => l.project_id === project.id).length,
      commitCount: known.length,
      branch: branchRef?.name ?? project.default_branch,
      lastCommitAt: chain[0]?.created_at ?? project.created_at,
      lastCommitMessage: chain[0]?.message ?? "",
    };
  });
}

/** Une carte de projet : le projet, et de quoi le juger d'un coup d'œil. */
export interface ProjectCard extends Project {
  /** Publications rattachées au projet. */
  postCount: number;
  /** Révisions du dépôt. */
  commitCount: number;
  branch: string;
  /** Horodatage de la révision la plus récente. */
  lastCommitAt: string;
  lastCommitMessage: string;
}

/**
 * Les projets auxquels des publications sont rattachées.
 *
 * Sert l'onglet « Projets » d'un profil **public** : on y montre les
 * projets d'une personne, avec le nombre de publications qu'ils
 * expliquent. C'est le seul endroit où le lien se lit dans les deux sens
 * — post → projet et profil → projet.
 */
export async function fetchProjectsByUser(userId: string): Promise<ProjectCard[]> {
  return fetchProjectsWithCounts(userId);
}

/** La synthèse des scores d'un ensemble de dépôts. */
export interface RepoScoreSummary {
  /** Moyenne des scores des dépôts réellement analysables (score > 0). */
  average: number;
  /** Nombre de dépôts analysables. */
  count: number;
  /** Meilleur score, 0 si aucun dépôt. */
  best: number;
  /**
   * Les scores des dépôts analysables, **dans l'ordre du travail** : du
   * dépôt dont l'activité est la plus ancienne au plus récent.
   */
  series: number[];
  /**
   * La trajectoire de cette série — moyenne, médiane, dispersion et
   * **verdict**. C'est la même lecture que la courbe d'un dépôt, appliquée
   * aux dépôts d'une personne : la question n'est plus « ce dépôt
   * progresse-t-il ? » mais « cette personne écrit-elle mieux qu'avant ? ».
   */
  trajectory: HistoryStats;

  /**
   * La note de **chaque** dépôt, par identifiant — la même lecture que la
   * série, découpée.
   *
   * Elle vient avec la synthèse pour une raison simple : le score se
   * calcule en relisant les fichiers, et le relire deux fois (une pour la
   * moyenne, une pour afficher la note sous chaque carte) coûterait deux
   * fois la requête. La synthèse porte donc à la fois le résumé et le détail.
   *
   * Un dépôt sans entrée n'est pas noté : `0` n'est pas une note, c'est
   * une absence de mesure, et afficher « 0 » sous un dépôt vide mentirait.
   */
  scores: Record<string, number>;
}

/** La synthèse vide : une forme valide, et rien dedans. */
export const EMPTY_SCORE_SUMMARY: RepoScoreSummary = {
  average: 0,
  count: 0,
  best: 0,
  series: [],
  trajectory: historyStats([]),
  scores: {},
};

/**
 * Résume les scores d'une liste de dépôts.
 *
 * Un dépôt dont les fichiers ne se lisent pas compte pour zéro : c'est un
 * dépôt qui ne prouve rien ici, et l'écarter du dénominateur gonflerait la
 * moyenne. Le nombre de dépôts analysables est rendu lui aussi, pour que
 * l'écran puisse dire sur quoi la moyenne porte — un « 82 » sur un seul
 * dépôt ne se lit pas comme un « 82 » sur dix.
 *
 * ## Pourquoi la synthèse porte aussi une trajectoire
 *
 * Une moyenne dit où en est quelqu'un, pas **d'où il vient**. Or l'ordre de
 * la série est déjà là : chaque dépôt est noté dans l'état de sa dernière
 * révision, donc trier par date de dernière activité revient à lire le
 * travail dans l'ordre où il a été fait. Aucune requête supplémentaire :
 * c'est la même lecture, ordonnée.
 *
 * Les dépôts non analysables sont écartés de la série comme de la moyenne :
 * un dépôt vide n'est pas une régression, c'est une absence de mesure, et
 * l'inclure ferait dire à la courbe qu'un travail a été perdu.
 *
 * C'est le seul endroit qui sait calculer cette synthèse : le profil
 * public, l'espace de travail et la liste des projets affichent les mêmes
 * chiffres, donc ils appellent la même fonction.
 */
export async function summarizeRepoScores(
  projects: readonly (Pick<ProjectCard, "id" | "default_branch"> &
    Partial<Pick<ProjectCard, "lastCommitAt">>)[],
): Promise<RepoScoreSummary> {
  // Le tri est **stable** : deux dépôts touchés le même jour gardent
  // l'ordre de la liste, qui est déjà celui de la base.
  const ordered = [...projects].sort((a, b) =>
    (a.lastCommitAt ?? "").localeCompare(b.lastCommitAt ?? ""),
  );

  const scores = await Promise.all(
    ordered.map(async (project) => {
      try {
        const files = await fetchRepoFiles(project.id, project.default_branch || DEFAULT_BRANCH);
        return scoreRepo(files).score;
      } catch {
        return 0;
      }
    }),
  );

  const scorable = scores.filter((value) => value > 0);
  const total = scorable.reduce((sum, value) => sum + value, 0);

  const detail: Record<string, number> = {};
  ordered.forEach((project, i) => {
    // Seuls les dépôts réellement notés ont une entrée : voir ci-dessus.
    if (scores[i] > 0) detail[project.id] = scores[i];
  });

  return {
    average: scorable.length > 0 ? Math.round(total / scorable.length) : 0,
    count: scorable.length,
    best: scorable.length > 0 ? Math.max(...scorable) : 0,
    series: scorable,
    trajectory: historyStats(scorable),
    scores: detail,
  };
}

/** Le projet d'une publication, s'il y en a un. */
export async function fetchProjectForPost(postId: string): Promise<Project | null> {
  const { data: link } = await supabase
    .from("post_projects")
    .select("project_id")
    .eq("post_id", postId)
    .maybeSingle();

  const projectId = (link as PostProject | null)?.project_id ?? "";
  if (!projectId) return null;

  return fetchProject(projectId);
}

/**
 * Rattache une publication à un projet.
 *
 * On retire d'abord tout rattachement existant : un post n'appartient qu'à
 * un seul projet, et changer d'avis ne doit pas laisser deux liens. La
 * RLS refuse de toute façon le rattachement au dépôt d'un autre
 * (migration 009).
 */
export async function linkPostToProject(
  postId: string,
  projectId: string | null,
): Promise<{ error: string | null }> {
  await supabase.from("post_projects").delete().eq("post_id", postId);

  if (!projectId) return { error: null };

  const { error } = await supabase
    .from("post_projects")
    .insert({ post_id: postId, project_id: projectId });

  return { error: error?.message ?? null };
}

/** Les publications rattachées à un projet. */
export async function fetchPostsForProject(projectId: string): Promise<PostWithAuthor[]> {
  const { data } = await supabase
    .from("post_projects")
    .select("post_id")
    .eq("project_id", projectId);

  const ids = ((data as PostProject[]) ?? []).map((l) => l.post_id);
  if (ids.length === 0) return [];

  const { data: posts } = await supabase
    .from("posts")
    .select("*, author:users!posts_author_id_fkey(id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau)")
    .in("id", ids)
    .order("created_at", { ascending: false });

  return (posts as PostWithAuthor[]) ?? [];
}

/** `slug` d'un nom de projet : URL, dossier, et nom lisible. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    // On retire les diacritiques : « cooperative » plutôt que « coopérative ».
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
/**
 * Les projets d'un ensemble de publications.
 *
 * Une requête, quel que soit le nombre de cartes affichées : c'est le
 * même raisonnement que pour les likes. Un `fetchProjectForPost` par post
 * ferait dix requêtes pour dix lignes, dont neuf identiques.
 *
 * Le résultat est une **table**, pas une liste : l'écran a des dizaines de
 * cartes et chacune demande « ai-je un projet ? ». Une recherche linéaire
 * par carte serait O(n²) pour rien.
 */
export async function fetchProjectsForPosts(
  postIds: string[],
): Promise<Map<string, Project>> {
  const byPost = new Map<string, Project>();
  if (postIds.length === 0) return byPost;

  const { data: links } = await supabase
    .from("post_projects")
    .select("post_id, project_id")
    .in("post_id", postIds);

  const rows = (links as PostProject[]) ?? [];
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  if (projectIds.length === 0) return byPost;

  const { data: projects } = await supabase
    .from("projects")
    .select(PROJECT_FIELDS)
    .in("id", projectIds);

  const found = (projects as Project[]) ?? [];
  for (const link of rows) {
    const project = found.find((p) => p.id === link.project_id);
    // Un post ne portant qu'un projet : le premier trouvé fait foi.
    if (project && !byPost.has(link.post_id)) byPost.set(link.post_id, project);
  }

  return byPost;
}
