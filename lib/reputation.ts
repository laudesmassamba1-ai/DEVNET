/**
 * Couche de données de la réputation et du travail d'équipe.
 *
 * Même contrat que `lib/progress.ts` : ce fichier **collecte**, le moteur
 * pur (`lib/proofs.ts`, `lib/match.ts`) calcule. Aucune décision ici.
 *
 * ## Deux modes, un seul point d'entrée
 *
 * Le client importé est `@/lib/api/client`, qui renvoie déjà
 * Supabase **ou** le client de démonstration selon l'état du backend
 * (`lib/backend.ts`). Il n'y a donc pas de `if (demo)` dans ce fichier :
 * ajouter une bifurcation ici, c'est se garantir deux comportements à
 * maintenir au lieu d'un.
 *
 * ## Résilience
 *
 * Si la migration 023 n'a pas été jouée, les tables `proofs`, `snippets`,
 * `project_tasks`… n'existent pas et PostgREST répond une erreur. On ne
 * laisse jamais une erreur remonter jusqu'à l'écran : un profil sans
 * preuve reste un profil lisible, et c'est exactement ce qu'un backend
 * neuf doit afficher.
 */

import { api } from "@/lib/api/client";
import {
  makeProof, proofsForProject, proofsOf, replayAll, reputationByLanguage,
  type LanguageReputation, type Proof, type ReplayReport,
} from "@/lib/proofs";
import type { Candidate } from "@/lib/match";
import type {
  ProjectApplication, ProjectTask, ReviewCorrection, Snippet, User,
} from "@/lib/types";

/**
 * Await qui ne lève jamais. Le type de repli est fixé à l'appel :
 * PostgREST renvoie `any`, donc l'inférence prendrait le type de la
 * chaîne — et un `?? []` masquerait la panne au lieu de la rendre neutre.
 */
async function safe<T>(p: PromiseLike<{ data: unknown; error?: unknown }>, fallback: T): Promise<T> {
  try {
    const { data, error } = await p;
    if (error) return fallback;
    return (data as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Preuves                                                             */
/* ------------------------------------------------------------------ */

const PROOF_COLUMNS =
  "id, user_id, kind, language, project_id, subject, fingerprint, summary, created_at";

/** Toutes les preuves d'une personne, les plus récentes d'abord. */
export async function loadProofsForUser(userId: string): Promise<Proof[]> {
  const rows = await safe(
    api.from("proofs").select(PROOF_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    [] as Proof[],
  );
  return proofsOf(rows, userId);
}

/** Les preuves rattachées à un projet — qui a fait quoi, ici. */
export async function loadProofsForProject(projectId: string): Promise<Proof[]> {
  const rows = await safe(
    api.from("proofs").select(PROOF_COLUMNS)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(500),
    [] as Proof[],
  );
  return proofsForProject(rows, projectId);
}

/** La réputation par langage d'une personne, recalculée depuis ses preuves. */
export async function loadReputation(userId: string): Promise<LanguageReputation[]> {
  return reputationByLanguage(await loadProofsForUser(userId));
}

/**
 * Le résultat du bouton « Rejouer les preuves ».
 *
 * On relit **puis** on recalcule : c'est la seule façon de vérifier que
 * ce qui est stocké est bien ce que le calcul produit. Rejouer une copie
 * en mémoire ne vérifierait que la copie.
 */
export async function replayUserProofs(userId: string): Promise<ReplayReport> {
  return replayAll(await loadProofsForUser(userId));
}

/**
 * Enregistre une exécution réussie.
 *
 * C'est la **seule** preuve que le client écrit lui-même : un run n'a pas
 * de ligne source. La politique RLS l'accepte précisément pour ce genre,
 * et son poids vaut 1 — le forger n'achète rien.
 */
export async function recordExecutionProof(input: {
  userId: string;
  language: string;
  subject: string;
  summary: string;
}): Promise<Proof | null> {
  const proof = makeProof({
    id: cryptoRandomId(),
    user_id: input.userId,
    kind: "execution",
    language: input.language,
    subject: input.subject,
    summary: input.summary,
  });

  try {
    const { error } = await api.from("proofs").insert({
      id: proof.id,
      user_id: proof.user_id,
      kind: proof.kind,
      language: proof.language,
      project_id: proof.project_id,
      subject: proof.subject,
      fingerprint: proof.fingerprint,
      summary: proof.summary,
      created_at: proof.created_at,
    });
    return error ? null : proof;
  } catch {
    return null;
  }
}

/** Identifiant local, faute de `crypto.randomUUID` sur les vieux navigateurs. */
function cryptoRandomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/* Candidat : ce qu'un projet voit d'une personne                      */
/* ------------------------------------------------------------------ */

/**
 * Compose l'entrée du calcul de compatibilité (§6).
 *
 * `reputation` vient des **preuves** ; `languages` et `roles` viennent du
 * profil, c'est-à-dire d'une déclaration. Le moteur ne pèse la
 * déclaration qu'à 15 % — c'est volontaire et documenté dans
 * `lib/match.ts`.
 */
export function candidateFrom(
  user: Pick<User, "langages" | "bio">,
  proofs: Proof[],
): Candidate {
  const reputation = reputationByLanguage(proofs).map((l) => ({
    language: l.language,
    weight: l.weight,
  }));

  return {
    reputation,
    languages: user.langages ?? [],
    totalProofs: proofs.length,
    roles: [],
    hasBio: Boolean(user.bio && user.bio.trim()),
  };
}

/* ------------------------------------------------------------------ */
/* Snippets (§4)                                                       */
/* ------------------------------------------------------------------ */

const SNIPPET_COLUMNS = "id, author_id, title, language, code, output, ran_at, created_at";

export async function loadSnippets(options: { authorId?: string; limit?: number } = {}): Promise<Snippet[]> {
  let query = api.from("snippets").select(SNIPPET_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 40);
  if (options.authorId) query = query.eq("author_id", options.authorId);
  return safe(query, [] as Snippet[]);
}

/**
 * Publie un snippet. `ranAt` doit être une **exécution réussie réelle** :
 * c'est lui qui déclenche la preuve côté base. Publier sans exécuter
 * laisse `ran_at` nul, donc ne crée aucune réputation — le choix est
 * délibéré.
 */
export async function publishSnippet(input: {
  authorId: string;
  title: string;
  language: string;
  code: string;
  output: string;
  ranAt: string | null;
}): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data, error } = await api.from("snippets").insert({
      id: cryptoRandomId(),
      author_id: input.authorId,
      title: input.title.trim(),
      language: input.language,
      code: input.code,
      output: input.output,
      ran_at: input.ranAt,
    }).select("id").single();
    if (error) return { id: null, error: message(error) };
    return { id: (data as { id: string } | null)?.id ?? null, error: null };
  } catch (err) {
    return { id: null, error: message(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Revue ligne à ligne (§5)                                            */
/* ------------------------------------------------------------------ */

const CORRECTION_COLUMNS =
  "id, project_id, path, line_no, original, proposed, language, author_id, status, comment, decided_by, decided_at, created_at";

export async function loadCorrections(projectId: string, path?: string): Promise<ReviewCorrection[]> {
  let query = api.from("review_corrections").select(CORRECTION_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (path) query = query.eq("path", path);
  return safe(query, [] as ReviewCorrection[]);
}

export async function proposeCorrection(input: {
  projectId: string;
  path: string;
  lineNo: number;
  original: string;
  proposed: string;
  language: string;
  authorId: string;
  comment: string;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await api.from("review_corrections").insert({
      id: cryptoRandomId(),
      project_id: input.projectId,
      path: input.path,
      line_no: input.lineNo,
      original: input.original,
      proposed: input.proposed,
      language: input.language,
      author_id: input.authorId,
      status: "proposee",
      comment: input.comment,
    });
    return { error: error ? message(error) : null };
  } catch (err) {
    return { error: message(err) };
  }
}

/**
 * Accepte ou refuse une proposition.
 *
 * C'est la base qui pose la preuve (déclencheur `corrections_proof`) :
 * on n'écrit ici que le verdict, jamais la réputation. Un client qui
 * pourrait écrire la preuve n'aurait pas une réputation prouvée.
 */
export async function decideCorrection(input: {
  id: string;
  accept: boolean;
  deciderId: string;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await api.from("review_corrections").update({
      status: input.accept ? "acceptee" : "refusee",
      decided_by: input.deciderId,
      decided_at: new Date().toISOString(),
    }).eq("id", input.id);
    return { error: error ? message(error) : null };
  } catch (err) {
    return { error: message(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Tâches d'équipe (§7)                                                */
/* ------------------------------------------------------------------ */

const TASK_COLUMNS =
  "id, project_id, title, body, status, position, assignee, language, created_by, done_at, created_at";

export async function loadTasks(projectId: string): Promise<ProjectTask[]> {
  const rows = await safe(
    api.from("project_tasks").select(TASK_COLUMNS)
      .eq("project_id", projectId)
      .order("position", { ascending: true })
      .limit(300),
    [] as ProjectTask[],
  );
  return rows;
}

export async function createTask(input: {
  projectId: string;
  title: string;
  body?: string;
  language?: string;
  createdBy: string;
  status?: ProjectTask["status"];
}): Promise<{ error: string | null }> {
  try {
    const { error } = await api.from("project_tasks").insert({
      id: cryptoRandomId(),
      project_id: input.projectId,
      title: input.title.trim(),
      body: input.body ?? "",
      status: input.status ?? "todo",
      position: Date.now() % 100000,
      assignee: null,
      language: input.language ?? "",
      created_by: input.createdBy,
    });
    return { error: error ? message(error) : null };
  } catch (err) {
    return { error: message(err) };
  }
}

/**
 * Déplace une tâche entre deux colonnes.
 *
 * Franchir le pas vers `done` **pose la preuve** côté base. C'est
 * pourquoi on n'écrit jamais `done` sans `done_at` : un déclencheur qui
 * ne saurait pas quand la tâche a été finie daterait la preuve au moment
 * du rejeu, et deux rejeux donneraient deux dates.
 */
export async function moveTask(input: {
  id: string;
  status: ProjectTask["status"];
}): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === "done") patch.done_at = new Date().toISOString();
  try {
    const { error } = await api.from("project_tasks").update(patch).eq("id", input.id);
    return { error: error ? message(error) : null };
  } catch (err) {
    return { error: message(err) };
  }
}

export async function assignTask(input: {
  id: string;
  assignee: string | null;
  language?: string;
}): Promise<{ error: string | null }> {
  try {
    const patch: Record<string, unknown> = { assignee: input.assignee };
    if (input.language !== undefined) patch.language = input.language;
    const { error } = await api.from("project_tasks").update(patch).eq("id", input.id);
    return { error: error ? message(error) : null };
  } catch (err) {
    return { error: message(err) };
  }
}

/** Retire une tâche — le créateur seul, ou l'équipe (RLS). */
export async function deleteTask(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await api.from("project_tasks").delete().eq("id", id);
    return { error: error ? message(error) : null };
  } catch (err) {
    return { error: message(err) };
  }
}

/** Réécrit le titre, le corps ou le langage d'une tâche. */
export async function editTask(input: {
  id: string;
  title?: string;
  body?: string;
  language?: string;
}): Promise<{ error: string | null }> {
  try {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.body !== undefined) patch.body = input.body;
    if (input.language !== undefined) patch.language = input.language;
    if (Object.keys(patch).length === 0) return { error: null };
    const { error } = await api.from("project_tasks").update(patch).eq("id", input.id);
    return { error: error ? message(error) : null };
  } catch (err) {
    return { error: message(err) };
  }
}

/** Retire une tâche du tableau. */
export async function removeTask(id: string): Promise<{ error: string | null }> {
  return deleteTask(id);
}

/**
 * Les membres du projet — l'équipe que la tâche peut désigner.
 *
 * On lit `project_members` **avec** le profil joint : un tableau de tâches
 * qui afficherait un identifiant à la place d'un nom ne serait pas un
 * espace d'équipe. La jointure est faite par PostgREST (`users(...)`) et le
 * moteur de démonstration la comprend, comme les jointures du fil.
 */
export interface ProjectMemberView {
  user_id: string;
  role: string;
  prenom: string;
  pseudo: string;
  avatar_color: string | null;
}

export async function loadProjectMembers(projectId: string): Promise<ProjectMemberView[]> {
  const rows = await safe(
    api
      .from("project_members")
      .select("user_id, role, profile:users(prenom, pseudo, avatar_color)")
      .eq("project_id", projectId)
      .limit(200),
    [] as {
      user_id: string;
      role: string;
      profile?: { prenom?: string; pseudo?: string; avatar_color?: string | null } | null;
    }[],
  );

  return rows.map((r) => ({
    user_id: r.user_id,
    role: r.role,
    prenom: r.profile?.prenom ?? "",
    pseudo: r.profile?.pseudo ?? "",
    avatar_color: r.profile?.avatar_color ?? null,
  }));
}

/* ------------------------------------------------------------------ */
/* Candidatures (§6)                                                   */
/* ------------------------------------------------------------------ */

const APPLICATION_COLUMNS =
  "id, project_id, user_id, role, message, status, decided_by, decided_at, created_at";

export async function loadApplications(options: {
  projectId?: string;
  userId?: string;
}): Promise<ProjectApplication[]> {
  let query = api.from("project_applications").select(APPLICATION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (options.projectId) query = query.eq("project_id", options.projectId);
  if (options.userId) query = query.eq("user_id", options.userId);
  return safe(query, [] as ProjectApplication[]);
}

/**
 * Une candidature **avec son auteur**, pour la file de décision.
 *
 * Une liste qui n'afficherait qu'un identifiant ne serait pas une file :
 * décider d'accepter quelqu'un demande de lire qui c'est. La jointure est
 * la même que celle des membres (`profile:users(...)`), et le moteur de
 * démonstration la résout par `user_id`, comme le fait PostgREST.
 */
export interface ProjectApplicationView extends ProjectApplication {
  prenom: string;
  pseudo: string;
  avatar_color: string | null;
}

export async function loadApplicationViews(projectId: string): Promise<ProjectApplicationView[]> {
  const rows = await safe(
    api
      .from("project_applications")
      .select(
        "id, project_id, user_id, role, message, status, decided_by, decided_at, created_at, " +
        // `project_applications` vise `users` par `user_id` et
        // `decided_by` : on nomme celle qui porte le candidat.
        "profile:users!project_applications_user_id_fkey(prenom, pseudo, avatar_color)",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200),
    [] as (ProjectApplication & {
      profile?: { prenom?: string; pseudo?: string; avatar_color?: string | null } | null;
    })[],
  );

  return rows.map((r) => ({
    ...r,
    prenom: r.profile?.prenom ?? "",
    pseudo: r.profile?.pseudo ?? "",
    avatar_color: r.profile?.avatar_color ?? null,
  }));
}

export async function applyToProject(input: {
  projectId: string;
  userId: string;
  role: string;
  message: string;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await api.from("project_applications").insert({
      id: cryptoRandomId(),
      project_id: input.projectId,
      user_id: input.userId,
      role: input.role,
      message: input.message.trim(),
      status: "attente",
    });
    return { error: error ? message(error) : null };
  } catch (err) {
    return { error: message(err) };
  }
}

/** Accepter une candidature crée l'adhésion **et** la preuve, côté base. */
export async function decideApplication(input: {
  id: string;
  accept: boolean;
  deciderId: string;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await api.from("project_applications").update({
      status: input.accept ? "acceptee" : "refusee",
      decided_by: input.deciderId,
      decided_at: new Date().toISOString(),
    }).eq("id", input.id);
    return { error: error ? message(error) : null };
  } catch (err) {
    return { error: message(err) };
  }
}

/* ------------------------------------------------------------------ */

/** Les erreurs de PostgREST ont une forme `{ message }`, pas `Error`. */
function message(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return "erreur inconnue";
}
