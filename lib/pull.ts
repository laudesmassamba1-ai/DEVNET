/**
 * Les pull requests, côté données.
 *
 * Même séparation que `lib/issues.ts` : ce module est le seul qui sait ce
 * qu'est une pull request en base, et l'écran ne fait que demander
 * « quelles sont les demandes » ou « fusionne celle-là ». Le numéro et la
 * date de fusion ne sont **pas** décidés ici : ils viennent de la base
 * (migration 014, déclencheurs `assign_pull_request_number` et
 * `sync_pull_request_merge`).
 *
 * ## Une fusion est un enregistrement
 *
 * `fusionnerPullRequest` ne réécrit pas l'historique : elle écrit le
 * contenu de la source sur la branche de destination, **puis** appelle
 * `commitRepo`, le chemin d'enregistrement ordinaire. C'est volontaire.
 * Une fusion a donc un auteur, un message, un instantané et un sha comme
 * n'importe quel commit — et surtout, elle est refusée par le même
 * verdict que le moteur pur (`lib/git/pull.ts`), parce que la décision
 * « peut-on fusionner ? » n'appartient pas à l'écran.
 *
 * ## Ce qui n'est pas fait
 *
 * Pas de fusion à trois voies, pas de résolution assistée. `lib/git/history.ts`
 * l'explique : une fusion qui choisit un camp sans le dire donne
 * l'illusion que tout va bien. Ici, le cas le plus fréquent — la
 * destination n'a pas bougé — se fusionne en appliquant le diff ; le cas
 * où les deux côtés ont touché le même fichier est un **refus nommé**,
 * pas une fusion hasardeuse.
 */

import { supabase } from "@/lib/supabase/client";
import { NULL_SHA } from "@/lib/git/objects";
import { diffTrees, type Commit, type FileDiff, type RepoFile } from "@/lib/git/history";
import {
  apportDeLaBranche,
  appliquerBranche,
  baseDeFusion,
  commitsAbsentsDe,
  messageFusion,
  verifierFusion,
  type Verdict,
} from "@/lib/git/pull";
import {
  commitRepo,
  deleteRepoFile,
  fetchRepoFiles,
  saveRepoFile,
  type RepoFileState,
  type UserLiteForRepo,
} from "@/lib/repo";

/** Les colonnes d'un auteur, telles que les écrans les consomment. */
const AUTHOR = "id, prenom, pseudo, avatar_color, account_type, verified";

export type StatutPullRequest = "ouverte" | "fusionnee" | "fermee";

export interface AuteurPullRequest {
  id: string;
  prenom: string;
  pseudo: string;
  avatar_color: string | null;
  account_type: string;
  verified: boolean;
}

export interface PullRequest {
  id: string;
  project_id: string;
  author_id: string;
  number: number;
  source_branch: string;
  target_branch: string;
  title: string;
  body: string;
  status: StatutPullRequest;
  merged_at: string | null;
  merged_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  author?: AuteurPullRequest;
}

/**
 * `*` et non une liste de colonnes : voir la note de `lib/issues.ts`.
 *
 * La contrainte est nommée pour la même raison qu'eux : `pull_requests`
 * mène à `users` par `author_id` **et** `merged_by` — deux chemins, donc
 * une jointure ambiguë tant qu'on ne dit pas lequel.
 */
const COLONNES = `*, author:users!pull_requests_author_id_fkey(${AUTHOR})`;

/** Les demandes d'un projet, ouvertes d'abord puis les plus récentes. */
export async function fetchPullRequests(projectId: string): Promise<PullRequest[]> {
  const { data } = await supabase
    .from("pull_requests")
    .select(COLONNES)
    .eq("project_id", projectId)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  return (data as PullRequest[]) ?? [];
}

/**
 * Combien de demandes sont ouvertes.
 *
 * Lu à part, comme `fetchOpenIssueCount` : l'en-tête de l'onglet a besoin
 * d'un nombre, pas de la liste — et charger les titres et les descriptions
 * pour afficher « 1 » ferait transiter tout le texte.
 */
export async function fetchOpenPullRequestCount(projectId: string): Promise<number> {
  const { count } = await supabase
    .from("pull_requests")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "ouverte");

  return count ?? 0;
}

/**
 * La demande ouverte d'une branche vers une destination, s'il y en a une.
 *
 * L'index unique partiel `pull_requests_one_open_per_branch_idx` fait
 * échouer la création d'une seconde. On lit donc l'existante pour pouvoir
 * dire « cette branche a déjà une demande ouverte » et **mener à elle** —
 * refuser sans dire laquelle serait un cul-de-sac.
 */
export async function fetchOpenPullRequestForBranch(
  projectId: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<PullRequest | null> {
  const { data } = await supabase
    .from("pull_requests")
    .select(COLONNES)
    .eq("project_id", projectId)
    .eq("source_branch", sourceBranch)
    .eq("target_branch", targetBranch)
    .eq("status", "ouverte")
    .maybeSingle();

  return (data as PullRequest) ?? null;
}

/**
 * Ouvre une demande.
 *
 * Le titre est borné ici avec la **même** règle que la base
 * (`between 3 and 140`) : on ne laisse pas l'utilisateur découvrir la
 * contrainte en appuyant sur Entrée.
 *
 * `number` n'est pas envoyé — le déclencheur l'écrit, et l'envoyer même
 * à `null` désactive la condition du déclencheur.
 */
export async function createPullRequest(options: {
  projectId: string;
  authorId: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body?: string;
}): Promise<{ pull: PullRequest | null; error: string | null }> {
  const title = options.title.trim();
  const source = options.sourceBranch.trim();
  const target = options.targetBranch.trim();

  if (source === target) {
    return {
      pull: null,
      error: "Une branche ne peut pas demander sa propre intégration.",
    };
  }

  if (title.length < 3) {
    return { pull: null, error: "Le titre doit faire au moins 3 caractères." };
  }

  if (title.length > 140) {
    return { pull: null, error: "Le titre ne peut pas dépasser 140 caractères." };
  }

  const { data, error } = await supabase
    .from("pull_requests")
    .insert({
      project_id: options.projectId,
      author_id: options.authorId,
      source_branch: source,
      target_branch: target,
      title,
      body: options.body?.trim() ?? "",
    })
    .select(COLONNES)
    .single();

  if (error || !data) {
    // L'index unique partiel a refusé : c'est le message le plus probable
    // ici, et un message brut de Postgres (« duplicate key… ») ne dit pas
    // à l'utilisateur quoi faire. On le traduit, sans masquer les autres.
    const doublon = /duplicate key/i.test(error?.message ?? "");
    return {
      pull: null,
      error: doublon
        ? `La branche « ${source} » a déjà une demande ouverte vers « ${target} ».`
        : (error?.message ?? "Création impossible."),
    };
  }

  return { pull: data as PullRequest, error: null };
}

/**
 * Ferme une demande, ou la rouvre.
 *
 * `closed_at` n'est pas envoyé : le déclencheur l'écrit, comme
 * `merged_at`.
 */
export async function setPullRequestStatus(
  id: string,
  status: StatutPullRequest,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("pull_requests").update({ status }).eq("id", id);
  return { error: error?.message ?? null };
}

/**
 * Ce qu'une demande apporte : la comparaison entre la base de fusion et
 * la branche, **jamais** entre les deux sommets.
 *
 * Comparer les sommets affiche comme suppressions tout ce que la
 * destination a fait depuis le départ de la branche. Le lecteur voit
 * alors « −3 lignes » alors que la branche n'a rien retiré, et il peut
 * lire une suppression comme un choix alors qu'elle n'est que le reflet
 * d'un travail qui se trouve ailleurs.
 *
 * Il est calculé à chaque lecture, jamais stocké : voir la migration 014.
 */
export async function fetchPullRequestDiff(
  projectId: string,
  pull: Pick<PullRequest, "source_branch" | "target_branch">,
): Promise<FileDiff[]> {
  const commits = await tousLesCommits(projectId);
  const source = await fetchRepoFiles(projectId, pull.source_branch);
  const cibleHead = await sommetDe(projectId, pull.target_branch);
  const sourceHead = await sommetDe(projectId, pull.source_branch);
  const baseSha = baseDeFusion(commits, cibleHead?.sha ?? "", sourceHead?.sha ?? "");

  return apportDeLaBranche(
    await fichiersDuCommit(projectId, baseSha),
    enFichiers(source),
  );
}

/**
 * Le verdict de fusion d'une demande, sans rien écrire.
 *
 * L'écran l'appelle pour savoir s'il doit proposer « Fusionner », et
 * pourquoi il ne le propose pas le cas échéant. Une décision prise à la
 * lecture et rejouée à l'écriture serait deux décisions : c'est le moyen
 * le plus sûr d'afficher un bouton qui échoue.
 */
export async function judgePullRequest(
  projectId: string,
  pull: Pick<PullRequest, "source_branch" | "target_branch">,
): Promise<Verdict> {
  return (await mergerOuPas(projectId, pull)).verdict;
}

/** L'état des deux branches, des commits, et le verdict — la lecture commune. */
async function mergerOuPas(
  projectId: string,
  pull: Pick<PullRequest, "source_branch" | "target_branch">,
): Promise<{
  verdict: Verdict;
  cible: RepoFile[];
  source: RepoFile[];
  base: RepoFile[] | null;
  commits: Commit[];
  cibleHead: Commit | null;
}> {
  const [cible, source, commits] = await Promise.all([
    fetchRepoFiles(projectId, pull.target_branch),
    fetchRepoFiles(projectId, pull.source_branch),
    tousLesCommits(projectId),
  ]);

  const [cibleHead, sourceHead] = await Promise.all([
    sommetDe(projectId, pull.target_branch),
    sommetDe(projectId, pull.source_branch),
  ]);

  // Les chemins touchés par les commits propres à la destination. C'est
  // la seule information que le moteur ne peut pas se donner tout seul :
  // un commit ne porte que son arbre, pas la liste de ses fichiers.
  //
  // Un instantané absent ne se devine pas : on renvoie `null`, et le
  // moteur **refuse** la fusion. Préférer un refus à une fusion devinée.
  const baseSha = baseDeFusion(commits, cibleHead?.sha ?? "", sourceHead?.sha ?? "");
  const base = await fichiersDuCommit(projectId, baseSha);


  let cheminsCibles: string[] | null = [];

  for (const sha of commitsAbsentsDe(
    commits,
    cibleHead?.sha ?? "",
    sourceHead?.sha ?? "",
  )) {
    const touche = await cheminsDuCommit(
      projectId,
      sha,
      commits.find((c) => c.sha === sha)?.parent_sha ?? "",
    );

    if (touche === null) {
      cheminsCibles = null;
      break;
    }

    cheminsCibles.push(...touche);
  }

  const verdict = verifierFusion({
    source: { nom: pull.source_branch, fichiers: enFichiers(source), sommet: sourceHead?.sha ?? "" },
    cible: { nom: pull.target_branch, fichiers: enFichiers(cible), sommet: cibleHead?.sha ?? "" },
    base,
    commits,
    cheminsCibles,
  });

  return { verdict, cible: enFichiers(cible), source: enFichiers(source), base, commits, cibleHead };
}

/**
 * Fusionne une demande dans sa destination.
 *
 * L'écriture reprend le chemin ordinaire : on applique le diff sur l'état
 * de travail de la destination, puis on enregistre. Si l'enregistrement ne
 * produit rien — parce que la destination contenait déjà tout — la demande
 * **n'est pas** marquée fusionnée : elle resterait ouverte en annonçant
 * être fusionnée, ce qui est le pire des deux mondes.
 *
 * Le retour contient le verdict dans tous les cas, y compris quand la
 * fusion réussit : l'écran affiche alors la phrase qui dit **pourquoi**
 * c'est possible, ce qui n'est jamais une information inutile avant de
 * valider une fusion.
 */
export async function mergePullRequest(options: {
  projectId: string;
  pull: PullRequest;
  author: UserLiteForRepo;
}): Promise<{ commit: Commit | null; verdict: Verdict; error: string | null }> {
  const { pull, author } = options;
  const { verdict, cible, source, base } = await mergerOuPas(options.projectId, pull);

  if (!verdict.fusionnable) {
    return { commit: null, verdict, error: verdict.raison };
  }

  if (base === null) {
    return { commit: null, verdict, error: verdict.raison };
  }

  const fusionne = appliquerBranche({ base, cible, source });
  const parChemin = new Map(source.map((f) => [f.path, f]));

  // On écrit fichier par fichier, dans l'ordre du diff : un seul chemin
  // a la fois, donc une coupure au milieu laisse la destination dans un
  // état intermédiaire — visible dans « modifications non enregistrées »,
  // et réparable en ré-annulant. L'inverse, écrire la destination d'un
  // bloc, n'a pas de version intermédiaire à half-way.
  for (const chemin of diffTrees(cible, fusionne)) {
    if (chemin.status === "suppression") {
      const { error } = await deleteRepoFile({
        projectId: options.projectId,
        path: chemin.path,
        branch: pull.target_branch,
      });
      if (error) return { commit: null, verdict, error };
      continue;
    }

    const { error } = await saveRepoFile({
      projectId: options.projectId,
      path: chemin.path,
      content: parChemin.get(chemin.path)?.content ?? chemin.after,
      userId: author.id,
      branch: pull.target_branch,
    });
    if (error) return { commit: null, verdict, error };
  }

  const { commit, error } = await commitRepo({
    projectId: options.projectId,
    branch: pull.target_branch,
    message: messageFusion(pull.number, pull.title),
    author,
  });

  if (error || !commit) {
    return { commit: null, verdict, error: error ?? "Rien à enregistrer." };
  }

  // La demande n'est marquée fusionnée **après** l'écriture du commit,
  // jamais avant : dans l'autre ordre, un échec laisserait une demande
  // annoncée comme fusionnée alors que la destination n'a rien reçu.
  const { error: statusError } = await setPullRequestStatus(pull.id, "fusionnee");
  if (statusError) return { commit: null, verdict, error: statusError };

  return { commit, verdict, error: null };
}

/* ── Lectures utilitaires ─────────────────────────────────────────── */

/** Le commit de sommet d'une branche. */
async function sommetDe(projectId: string, branch: string): Promise<Commit | null> {
  const { data } = await supabase
    .from("git_refs")
    .select("sha")
    .eq("project_id", projectId)
    .eq("name", branch)
    .eq("kind", "branch")
    .maybeSingle();

  const sha = (data as { sha?: string } | null)?.sha ?? "";
  if (!sha || sha === NULL_SHA) return null;

  const commits = await tousLesCommits(projectId);
  return commits.find((c) => c.sha === sha) ?? null;
}

/** Tous les commits d'un projet, du plus récent au plus ancien. */
async function tousLesCommits(projectId: string): Promise<Commit[]> {
  const { data } = await supabase
    .from("git_commits")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (data as Commit[]) ?? [];
}

/** Les fichiers d'une branche, dans la forme que le moteur attend. */
function enFichiers(files: RepoFileState[]): RepoFile[] {
  return files.map((f) => ({ path: f.path, content: f.content, blob_sha: f.blob_sha }));
}

/**
 * L'état des fichiers à un commit, ou `null` s'il n'a pas d'instantané.
 *
 * Le `null` est propagé jusqu'au verdict : un commit sans instantané ne
 * permet pas de dire quels fichiers il a touchés, donc pas de dire s'il y
 * a conflit. Renvoyer une liste vide ferait croire à un conflit absent —
 * le pire des deux mensonges, parce qu'il autorise une fusion.
 */
async function fichiersDuCommit(projectId: string, sha: string): Promise<RepoFile[] | null> {
  const rows = await lignesInstantane(projectId, sha);
  if (rows === null) return null;

  return rows.map((r) => ({
    path: r.path,
    content: r.content,
    blob_sha: r.blob,
  }));
}

/** Les lignes d'un instantané de commit, ou `null` si la lecture échoue. */
async function lignesInstantane(
  projectId: string,
  sha: string,
): Promise<{ path: string; content: string; blob: string }[] | null> {
  if (!sha || sha === NULL_SHA) return [];

  const { data, error } = await supabase
    .from("git_commit_files")
    .select("path, content, blob_sha")
    .eq("project_id", projectId)
    .eq("sha", sha);

  if (error) return null;

  return ((data as { path: string; content: string; blob_sha: string }[]) ?? []).map((r) => ({
    path: r.path,
    content: String(r.content ?? ""),
    blob: String(r.blob_sha ?? ""),
  }));
}

/**
 * Les chemins d'un commit, ou `null` s'il n'a pas d'instantané.
 *
 * Le `null` est volontaire et propagé jusqu'au verdict : un commit sans
 * instantané ne permet pas de dire quels fichiers il a touchés, donc pas
 * de dire s'il y a conflit. Renvoyer une liste vide ferait croire à un
 * conflit absent — le pire des deux mensonges, parce qu'il autorise une
 * fusion.
 */
/**
 * Les fichiers qu'un commit a **touchés** — donc la différence entre son
 * instantané et celui de son parent.
 *
 * C'est la correction qui rend le détection de conflit honnête. Un
 * instantané est l'arbre **entier** du commit : prendre ses chemins pour
 * « les fichiers modifiés » ferait dire que le commit de fusion a
 * touché tous les fichiers du dépôt, et donc qu'il est en conflit avec
 * tout ce que la branche propose. Le dépôt refuserait alors des fusions
 * parfaitement sûres, avec le bon nombre de fichiers et la mauvaise
 * raison.
 */
async function cheminsDuCommit(
  projectId: string,
  sha: string,
  parentSha: string,
): Promise<string[] | null> {
  const [ici, avant] = await Promise.all([
    lignesInstantane(projectId, sha),
    lignesInstantane(projectId, parentSha),
  ]);

  if (ici === null || avant === null) return null;

  return diffTrees(enInstantane(avant), enInstantane(ici)).map((d) => d.path);
}

/** Des lignes d'instantané, dans la forme que le moteur attend. */
function enInstantane(
  lignes: { path: string; content: string; blob: string }[],
): RepoFile[] {
  return lignes.map((l) => ({ path: l.path, content: l.content, blob_sha: l.blob }));
}

/* ── Lectures utilitaires ─────────────────────────────────────────── */