/**
 * Le moteur de fork.
 *
 * ## Ce que fait un fork, exactement
 *
 * Forker un projet, c'est créer un projet neuf **et** y copier l'état
 * de travail de la branche source. Trois écritures, dans cet ordre :
 *
 *   1. le projet (cœur de `createProject`, réutilisé) ;
 *   2. les fichiers de la branche copiés dans le nouveau dépôt ;
 *   3. la ligne d'héritage dans `project_forks` + le lien
 *      `forked_from` du projet, pour l'affichage sans jointure.
 *
 * L'ordre compte : sans les fichiers, le fork est une coquille vide ;
 * sans la ligne d'héritage, on perd le fil qui permettra plus tard la
 * pull request « du fork vers la source ».
 *
 * ## Le nom
 *
 * Un fork hérite du nom de sa source avec le suffixe « (greffe) » pour
 * la lisibilité, mais un nom doit rester unique : si le titre proposé
 * est pris, on numérote — « Greffe de MonProjet 2 » — plutôt que de
 * bloquer l'utilisateur.
 */

import { createProject, fetchRepoFiles, type UserLiteForRepo } from "./repo";
import type { Project } from "./types";
import { api } from "./api/client";
import { makeProof } from "./proofs";

/**
 * Le champ `forked_from` n'existe qu'après la migration 025. Les
 * écrans le lisent avec `maybeSingle` pour survivre à un backend pas
 * encore migré : un champ absent vaut « pas un fork », jamais une
 * erreur bloquante.
 */
async function safeUpdateForkedFrom(forkId: string, sourceId: string): Promise<void> {
  const { error } = await api
    .from("projects")
    .update({ forked_from: sourceId })
    .eq("id", forkId);
  if (error) {
    // Pas encore migré : le lien d'affichage manquera, mais le fork, ses
    // fichiers et sa ligne d'héritage sont en place. On ne bloque pas le
    // geste entier pour une colonne d'affichage.
    console.warn("forked_from non écrit :", error.message);
  }
}

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface ForkRelation {
  id: string;
  fork_id: string;
  source_id: string;
  root_project_id: string;
  source_branch: string;
  source_sha: string;
  forked_by: string;
  forked_at: string;
}

/** LeSuffixe du fork — « greffe », le mot du métier pour une greffe de dépôt. */
export const FORK_SUFFIX = "(greffe)";

/**
 * Le nom proposé du fork : « X (greffe) ». Si la place est prise — la
 * source portait déjà ce nom — on numérote : « X (greffe) 2 ».
 */
export function forkName(sourceName: string, taken: (name: string) => boolean): string {
  const base = `${sourceName.trim()} ${FORK_SUFFIX}`;
  if (!taken(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base} ${i}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/* ------------------------------------------------------------------ */
/* Le fork                                                            */
/* ------------------------------------------------------------------ */

/**
 * Crée un fork d'un projet pour un utilisateur donné.
 *
 * Les fichiers copiés sont ceux de la **branche demandée** — pas la
 * totalité du dépôt : forker `main` ne doit pas entraîner une branche
 * expérimentale non publiée de la source.
 *
 * La source doit exister, le.embed forké doit être un projet visible ;
 * on ne vérifie pas plus : l'utilisateur peut forker n'importe quel
 * projet qu'il voit. Un fork est un hommage public, pas une demande.
 */
export async function forkProject(options: {
  /** Projet source à greffer. */
  source: Project;
  /** Branche à cloner — `main` par défaut. */
  branch?: string;
  /** Qui fork. */
  owner: UserLiteForRepo;
  /** Titres déjà pris — pour le suffixe numéroté. */
  takenNames?: string[];
  /** Description libre du fork ; le défaut mentionne la source. */
  description?: string;
}): Promise<{ project: Project | null; relation: ForkRelation | null; error: string | null }> {
  const branch = options.branch ?? "main";

  const takenSet = new Set(options.takenNames ?? []);
  const name = forkName(options.source.name, (n) => takenSet.has(n));

  const { project, error } = await createProject({
    name,
    description:
      options.description ??
      `Fork de ${options.source.name} (${options.source.language ?? "code"}).`,
    language: options.source.language,
    emoji: options.source.emoji,
    stage: options.source.stage,
    owner: options.owner,
  });

  if (error || !project) {
    return { project: null, relation: null, error: error ?? "Fork impossible." };
  }

  // Copie du dépôt : lecture, puis réécriture dans le projet neuf.
  const files = await fetchRepoFiles(options.source.id, branch);
  if (files.length) {
    const rows = files.map((f) => ({
      project_id: project.id,
      branch,
      path: f.path,
      content: f.content,
      blob_sha: f.blob_sha,
      updated_by: options.owner.id,
    }));
    const { error: copyError } = await api.from("git_files").insert(rows);
    if (copyError) {
      return { project, relation: null, error: `Fork créé, mais copie incomplète : ${copyError.message}` };
    }
  }

  // La ligne d'héritage.
  const relationPayload = {
    fork_id: project.id,
    source_id: options.source.id,
    source_branch: branch,
    source_sha: "",
    forked_by: options.owner.id,
  };
  const { data: relData, error: relError } = await api
    .from("project_forks")
    .insert(relationPayload)
    .select("id, fork_id, source_id, root_project_id, source_branch, source_sha, forked_by, forked_at")
    .single();

  if (relError) {
    // En démo comme en base, une écriture manquante ne bloque pas les
    // fichiers déjà copiés : le fork existe, son arbre aussi. Seule la
    // relation manque — on le signale sans mentir sur le succès.
    return { project, relation: null, error: relError.message };
  }

  // Le lien affichable sur le projet.
  await safeUpdateForkedFrom(project.id, options.source.id);

  return { project, relation: (relData as unknown as ForkRelation) ?? null, error: null };
}

/** Recharge la relation de fork d'un projet, s'il en a une. */
export async function fetchForkOf(projectId: string): Promise<ForkRelation | null> {
  const { data } = await api
    .from("project_forks")
    .select("id, fork_id, source_id, root_project_id, source_branch, source_sha, forked_by, forked_at")
    .eq("fork_id", projectId)
    .maybeSingle();
  return (data as unknown as ForkRelation) ?? null;
}

/** Les forks d'un projet — ses enfants directs, les plus récents d'abord. */
export async function fetchForksOf(sourceId: string): Promise<ForkRelation[]> {
  const { data } = await api
    .from("project_forks")
    .select("id, fork_id, source_id, root_project_id, source_branch, source_sha, forked_by, forked_at")
    .eq("source_id", sourceId)
    .order("forked_at", { ascending: false });
  return (data as unknown as ForkRelation[]) ?? [];
}

/** Fabrique la preuve de fork côté client (miroir démo). */
export function demoForkProof(input: {
  userId: string;
  forkProjectId: string;
  sourceName: string;
  language?: string;
}): ReturnType<typeof makeProof> {
  return makeProof({
    id: crypto.randomUUID(),
    user_id: input.userId,
    kind: "fork",
    language: input.language ?? "",
    project_id: input.forkProjectId,
    subject: input.forkProjectId,
    summary: `Fork de ${input.sourceName}`,
  });
}
