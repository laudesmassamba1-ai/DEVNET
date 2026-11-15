import { api } from "@/lib/api/client";

/**
 * Les issues d'un projet.
 *
 * Même séparation que le reste du projet : ce module est le seul qui sait
 * ce qu'est une issue en base, et l'écran ne fait que demander « quelles
 * sont les issues ouvertes » ou « ferme celle-là ». La numérotation, elle,
 * n'est **pas** décidée ici : elle vient de la base (migration 013,
 * déclencheur `assign_issue_number`), parce qu'un numéro écrit par le
 * client est un numéro que personne ne peut garantir.
 *
 * ## Ce qui n'est pas fait, et pourquoi
 *
 * Pas d'étiquettes, pas d'assignations, pas de jalons. Ce sont des
 * colonnes vides jusqu'à ce qu'un projet en ait besoin, et une étiquette
 * que personne ne remplit est pire que pas d'étiquette : elle donne au
 * lecteur l'impression d'une information qu'on lui cache.
 */

/** Les colonnes d'un auteur, telles que les screens les consomment. */
const AUTHOR = "id, prenom, pseudo, avatar_color, account_type, verified";

export interface IssueAuthor {
  id: string;
  prenom: string;
  pseudo: string;
  avatar_color: string | null;
  account_type: string;
  verified: boolean;
}

export interface Issue {
  id: string;
  project_id: string;
  author_id: string;
  number: number;
  title: string;
  body: string;
  status: "open" | "closed";
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
  author?: IssueAuthor;
  /** Nombre de commentaires — lu à part, jamais compté ligne à ligne. */
  comment_count?: number;
}

export interface IssueComment {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: IssueAuthor;
}

/**
 * La sélection d'une issue.
 *
 * `*` et non une liste de colonnes, comme partout ailleurs dans le
 * projet : la jointure est alors aussi large que le reste de la ligne, et
 * le transtypage reste possible. Écrire la liste colonne par colonne
 * donnerait un type où `author` est un **tableau** — la forme que
 * TypeScript devine pour une jointure non déclarée — et il faudrait
 * ensuite forcer le transtypage pour le corriger.
 */
// `issues` porte deux clés étrangères vers `users` (`author_id` et
// `closed_by`) : sans le nom de la contrainte, PostgREST ne sait pas
// laquelle joindre et répond 300 (`PGRST201`).
const ISSUE_COLUMNS = `*, author:users!issues_author_id_fkey(${AUTHOR})`;

/**
 * Les issues d'un projet, ouvertes d'abord puis les plus récentes.
 *
 * L'ordre est celui de l'index `issues_open_first_idx` : un écran dont
 * l'ordre ne correspond pas à un index fait trier toute la table à
 * chaque ouverture, et l'écran devient lent bien avant d'être faux.
 */
export async function fetchIssues(projectId: string): Promise<Issue[]> {
  const { data } = await api
    .from("issues")
    .select(ISSUE_COLUMNS)
    .eq("project_id", projectId)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  return (data as Issue[]) ?? [];
}

/**
 * Combien d'issues ouvertes.
 *
 * Un compteur lu à chaque affichage de l'en-tête. On ne le dérive pas de
 * `fetchIssues` : l'écran du dépôt n'a pas besoin de la liste pour
 * afficher un nombre, et le charger quand même ferait transiter tout le
 * texte des issues pour en lire la longueur.
 */
export async function fetchOpenIssueCount(projectId: string): Promise<number> {
  const { count } = await api
    .from("issues")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "open");

  return count ?? 0;
}

/**
 * Ouvre une issue.
 *
 * Le titre est borné par la base (`between 3 and 140`). On le borne aussi
 * ici, avec la **même** règle : la base refusant une saisie de deux
 * caractères par une erreur brute, on ne veut pas laisser l'utilisateur
 * découvrir la contrainte en appuyant sur Entrée.
 */
export async function createIssue(options: {
  projectId: string;
  authorId: string;
  title: string;
  body?: string;
}): Promise<{ issue: Issue | null; error: string | null }> {
  const title = options.title.trim();

  if (title.length < 3) {
    return { issue: null, error: "Le titre doit faire au moins 3 caractères." };
  }

  if (title.length > 140) {
    return { issue: null, error: "Le titre ne peut pas dépasser 140 caractères." };
  }

  // `number` n'est **pas** envoyé : la colonne est calculée par le
  // déclencheur. L'envoyer, même `null`, désactive la condition du
  // déclencheur en base, et l'issue naîtrait sans numéro.
  const { data, error } = await api
    .from("issues")
    .insert({
      project_id: options.projectId,
      author_id: options.authorId,
      title,
      body: options.body?.trim() ?? "",
    })
    .select(ISSUE_COLUMNS)
    .single();

  if (error || !data) return { issue: null, error: error?.message ?? "Création impossible." };

  return { issue: data as Issue, error: null };
}

/** Les commentaires d'une issue, du plus ancien au plus récent. */
export async function fetchIssueComments(issueId: string): Promise<IssueComment[]> {
  const { data } = await api
    .from("issue_comments")
    .select(`*, author:users(${AUTHOR})`)
    .eq("issue_id", issueId)
    .order("created_at", { ascending: true });

  return (data as IssueComment[]) ?? [];
}

/**
 * Répond sur une issue.
 *
 * On écrit sur une issue **fermée** sans y redire : c'est le cas
 * ordinaire. Le constat est fait, le problème est traité, et trois mois
 * plus tard quelqu'un pose une question à ce sujet — la réponse a sa
 * place dans le fil. Interdire l'écriture après fermeture sortirait cette
 * réponse de l'endroit où on la cherchera.
 */
export async function addIssueComment(options: {
  issueId: string;
  authorId: string;
  body: string;
}): Promise<{ error: string | null }> {
  const body = options.body.trim();

  if (!body) return { error: "Le message ne peut pas être vide." };

  const { error } = await api.from("issue_comments").insert({
    issue_id: options.issueId,
    author_id: options.authorId,
    body,
  });

  return { error: error?.message ?? null };
}

/**
 * Ferme une issue, ou la rouvre.
 *
 * `closed_at` et `closed_by` ne sont pas envoyés : le déclencheur
 * `sync_issue_closure` les écrit. Une date écrite par le client serait
 * une date fausse que la RLS ne peut pas empêcher.
 */
export async function setIssueStatus(
  issueId: string,
  status: "open" | "closed",
): Promise<{ error: string | null }> {
  const { error } = await api
    .from("issues")
    .update({ status })
    .eq("id", issueId);

  return { error: error?.message ?? null };
}

/** Retire une issue. Ses commentaires partent avec elle, en cascade. */
export async function deleteIssue(issueId: string): Promise<{ error: string | null }> {
  const { error } = await api.from("issues").delete().eq("id", issueId);
  return { error: error?.message ?? null };
}

/** La première ligne d'une issue en discussion, en toutes lettres. */
export async function fetchIssue(issueId: string): Promise<Issue | null> {
  const { data } = await api
    .from("issues")
    .select(ISSUE_COLUMNS)
    .eq("id", issueId)
    .maybeSingle();

  return (data as Issue) ?? null;
}