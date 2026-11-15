import { api } from "@/lib/api/client";

/**
 * Les pages de wiki d'un dépôt.
 *
 * Même séparation que `lib/issues.ts` : ce module est le seul qui sait ce
 * qu'est une page en base, et l'écran ne fait que demander « quelles sont
 * les pages » ou « enregistre celle-là ». La date de dernière écriture
 * n'est **pas** décidée ici : elle vient de la base (migration 015,
 * déclencheur `touch_project_page`), parce qu'une date écrite par le
 * client est une date que la RLS ne peut pas protéger.
 *
 * Le corps reste du texte : le découpage en blocs affichables vit dans
 * `lib/doc.ts`, qui ne dépend de rien. Un module qui sait lire la base
 * n'a pas à savoir découper un titre.
 */

/** Les colonnes d'un auteur, telles que les écrans les consomment. */
const AUTHOR = "id, prenom, pseudo, avatar_color, account_type, verified";

export interface PageAuthor {
  id: string;
  prenom: string;
  pseudo: string;
  avatar_color: string | null;
  account_type: string;
  verified: boolean;
}

export interface ProjectPage {
  id: string;
  project_id: string;
  author_id: string;
  title: string;
  body: string;
  position: number;
  created_at: string;
  updated_at: string;
  author?: PageAuthor;
}

/**
 * `*` et la jointure, comme pour les issues : écrire la liste des
 * colonnes une par une donnerait un type où `author` est un **tableau**
 * — la forme que TypeScript devine pour une jointure non déclarée — et
 * il faudrait forcer le transtypage pour le corriger.
 */
const PAGE_COLUMNS = `*, author:users(${AUTHOR})`;

/**
 * Le sommaire d'un dépôt : les pages, dans l'ordre du sommaire.
 *
 * L'ordre suit l'index `project_pages_project_idx`. `created_at` départage
 * les positions égales, pour que l'ordre soit stable même si deux pages
 * partagent le même rang — sans ce second critère, deux lectures
 * successives pourraient rendre deux ordres différents.
 */
export async function fetchProjectPages(projectId: string): Promise<ProjectPage[]> {
  const { data } = await api
    .from("project_pages")
    .select(PAGE_COLUMNS)
    .eq("project_id", projectId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return (data as ProjectPage[]) ?? [];
}

/** Le titre est borné par la base (`between 1 and 120`) : on le borne aussi ici. */
export async function createProjectPage(options: {
  projectId: string;
  authorId: string;
  title: string;
  body?: string;
}): Promise<{ page: ProjectPage | null; error: string | null }> {
  const title = options.title.trim();

  if (!title) return { page: null, error: "Donnez un titre à la page." };
  if (title.length > 120) {
    return { page: null, error: "Le titre ne peut pas dépasser 120 caractères." };
  }

  const { data, error } = await api
    .from("project_pages")
    .insert({
      project_id: options.projectId,
      author_id: options.authorId,
      title,
      body: options.body?.trim() ?? "",
    })
    .select(PAGE_COLUMNS)
    .single();

  if (error || !data) {
    return { page: null, error: error?.message ?? "Création impossible." };
  }

  return { page: data as ProjectPage, error: null };
}

/**
 * Modifie une page.
 *
 * `updated_at` n'est **pas** envoyé : le déclencheur l'écrit. L'envoyer
 * figerait la date sur la valeur du client, et l'écran afficherait
 * ensuite « modifié il y a trois jours » sur une page qu'on vient de
 * corriger.
 */
export async function updateProjectPage(
  pageId: string,
  patch: { title?: string; body?: string },
): Promise<{ error: string | null }> {
  const clean: { title?: string; body?: string } = {};

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return { error: "Donnez un titre à la page." };
    if (title.length > 120) {
      return { error: "Le titre ne peut pas dépasser 120 caractères." };
    }
    clean.title = title;
  }

  if (patch.body !== undefined) clean.body = patch.body;

  if (Object.keys(clean).length === 0) return { error: null };

  const { error } = await api
    .from("project_pages")
    .update(clean)
    .eq("id", pageId);

  return { error: error?.message ?? null };
}

/** Retire une page. */
export async function deleteProjectPage(pageId: string): Promise<{ error: string | null }> {
  const { error } = await api.from("project_pages").delete().eq("id", pageId);
  return { error: error?.message ?? null };
}
