import { supabase } from "@/lib/supabase/client";
import type { PostWithAuthor, UserLite } from "@/lib/types";

/**
 * Résultat d'une recherche : les données, ou un message d'erreur lisible.
 *
 * Le backend peut échouer (hors-ligne, RLS, requête refusée). Avant, on
 * renvoyait `[]` dans tous les cas : une panne devenait « aucun résultat »,
 * et l'écran mentait. On distingue donc les deux — un tableau vide est une
 * réponse, un message est une panne.
 */
export type SearchResult<T> = { data: T; error: string | null };

/** Message par défaut quand le backend ne fournit pas le sien. */
const FALLBACK_ERROR = "La recherche a échoué. Vérifie ta connexion et réessaie.";

/**
 * Découverte — retrouver une personne, une publication, un hashtag.
 *
 * Une règle gouverne ce fichier : **la même fonction doit répondre la
 * même chose en mode démo et sur le vrai backend.** Le mode démo n'a pas
 * de SQL, donc aucune agrégation ; tout ce qui compte est fait en
 * JavaScript, après la lecture. C'est moins fin que `GROUP BY`, et c'est
 * le prix de la parité — on préfère une recherche qui marche dans les
 * deux modes à une recherche optimisée qui diverge.
 */

/** Bornes de résultat : assez pour remplir l'écran, assez peu pour rester vif. */
const PEOPLE_LIMIT = 20;
const POSTS_LIMIT = 20;

/**
 * Nombre de publications lues pour calculer la frequence des hashtags.
 *
 * Arbitraire, et c'est assumé : la colonne `tags` est un `text[]`, donc
 * la compter précisément demanderait une table de jonction — qu'on a
 * refusé en migration 007 parce qu'un tag n'a pas besoin d'être compté
 * exactement. Lire les publications récentes et additionner en mémoire
 * donne un ordre de grandeur juste, pour une seule requête, dans les deux
 * modes.
 */
const TAG_SCAN_LIMIT = 200;

/**
 * Les hashtags les plus utilisés.
 *
 * L'ordre est le nombre de publications, puis alphabétique à égalité : un
 * tag à 3 et un tag à 3 se rangent dans un ordre stable, sinon la liste
 * changerait d'ordre à chaque lecture et l'œil ne retrouverait pas ce
 * qu'il venait de lire.
 */
export async function searchTags(
  limit = 12,
): Promise<SearchResult<{ tag: string; count: number }[]>> {
  const { data, error } = await supabase
    .from("posts")
    .select("tags")
    .order("created_at", { ascending: false })
    .limit(TAG_SCAN_LIMIT);

  if (error) {
    return { data: [], error: error.message ?? FALLBACK_ERROR };
  }

  const counts = new Map<string, number>();

  for (const row of (data as { tags: string[] | null }[]) ?? []) {
    for (const tag of row.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const ranked = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);

  return { data: ranked, error: null };
}

/**
 * Les personnes dont le pseudo ou le prénom ressemble à `query`.
 *
 * Le `or` est indispensable : quelqu'un qui cherche « aminata » doit
 * trouver `@aminata_dev` **et** un profil nommé Aminata. Chercher une
 * seule colonne ferait manquer la moitié des résultats — et l'utilisateur
 * croirait qu'il n'y a personne.
 */
export async function searchPeople(query: string): Promise<SearchResult<UserLite[]>> {
  const q = query.trim();
  if (!q) return { data: [], error: null };

  const pattern = `%${q}%`;

  const { data, error } = await supabase
    .from("users")
    .select("id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau")
    .or(`pseudo.ilike.${pattern},prenom.ilike.${pattern}`)
    .order("followers", { ascending: false })
    .limit(PEOPLE_LIMIT);

  if (error) {
    return { data: [], error: error.message ?? FALLBACK_ERROR };
  }

  return { data: (data as UserLite[]) ?? [], error: null };
}

/**
 * Les publications dont le texte ou le code ressemble à `query`.
 *
 * Le code est cherché aussi : « segfault » ou « Connection refused » se
 * trouve bien plus souvent dans un bloc de code que dans une phrase, et
 * c'est précisément le genre de message d'erreur qu'un développeur vient
 * chercher.
 *
 * L'ordre est le plus récent d'abord, **pas** le plus pertinent. On
 * pourrait classer par nombre de correspondances, mais un classement
 * approximatif calculé en JavaScript donnerait un ordre différent de
 * celui de Postgres sur les mêmes données — donc deux classements selon
 * le mode. Le tri par date est le seul que les deux modes promettront
 * exactement la même chose.
 */
export async function searchPosts(query: string): Promise<SearchResult<PostWithAuthor[]>> {
  const q = query.trim();
  if (!q) return { data: [], error: null };

  const pattern = `%${q}%`;

  const { data, error } = await supabase
    .from("posts")
    .select("*, author:users!posts_author_id_fkey(id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau)")
    .or(`text.ilike.${pattern},code.ilike.${pattern}`)
    .order("created_at", { ascending: false })
    .limit(POSTS_LIMIT);

  if (error) {
    return { data: [], error: error.message ?? FALLBACK_ERROR };
  }

  return { data: (data as PostWithAuthor[]) ?? [], error: null };
}

/** Les publications portant un hashtag. */
export async function postsByTag(tag: string): Promise<SearchResult<PostWithAuthor[]>> {
  const t = tag.replace(/^#/, "").trim().toLowerCase();
  if (!t) return { data: [], error: null };

  const { data, error } = await supabase
    .from("posts")
    .select("*, author:users!posts_author_id_fkey(id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau)")
    .overlaps("tags", [t])
    .order("created_at", { ascending: false })
    .limit(POSTS_LIMIT);

  if (error) {
    return { data: [], error: error.message ?? FALLBACK_ERROR };
  }

  return { data: (data as PostWithAuthor[]) ?? [], error: null };
}