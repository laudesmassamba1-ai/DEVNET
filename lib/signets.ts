import { api } from "@/lib/api/client";
import type { Bookmark, PostWithAuthor } from "@/lib/types";
import { cachedQuery } from "@/lib/queryCache";

/**
 * Les signets.
 *
 * Un signet est une ligne dans `bookmarks`, rien de plus — exactement
 * comme le like. Deux propriétés en découlent, et toutes deux sont
 * voulues :
 *
 * - **la lecture est privée**. Un like est public parce que son
 *   compteur s'affiche sur la carte ; un signet n'a aucun compteur à
 *   afficher, et publier la liste de lecture de quelqu'un reviendrait à
 *   exposer son historique. La RLS et la politique de démonstration
 *   restreignent donc la lecture à la ligne du lecteur.
 *
 * - **pas de compteur sur `posts`**. Contrairement aux likes et aux
 *   réactions, on n'ajoute pas `bookmarks` comme colonne du post : le
 *   nombre de signets d'une publication n'intéresse que son auteur,
 *   qui peut le compter, et personne d'autre ne l'affiche. Une colonne
 *   de plus à maintenir par déclencheur pour une information que
 *   l'interface ne montre pas, ce serait du travail sans contrepartie.
 */

const POST_AUTHOR = "id, prenom, pseudo, avatar_color, account_type, verified, filiere, niveau";

/**
 * Enregistre ou retire le signet d'une publication.
 *
 * Comme le like, l'état se **déduit** de l'échec d'insertion : on
 * tente d'insérer, et le refus de clé primaire est le signal de
 * retirer. C'est atomique sans fenêtre entre lecture et écriture.
 */
export async function toggleBookmark(
  postId: string,
  me: string,
): Promise<{ bookmarked: boolean; error: string | null }> {
  if (!me) return { bookmarked: false, error: "Non connecté" };

  const { error: insertError } = await api
    .from("bookmarks")
    .insert({ post_id: postId, user_id: me });

  if (!insertError) return { bookmarked: true, error: null };

  const isDuplicate = /duplicate key|23505/i.test(insertError.message);
  if (!isDuplicate) return { bookmarked: false, error: insertError.message };

  const { error: deleteError } = await api
    .from("bookmarks")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", me);

  if (deleteError) return { bookmarked: true, error: deleteError.message };
  return { bookmarked: false, error: null };
}

/** Les publications signetées par `me`, dans une requête. */
export async function fetchBookmarkedPostIds(
  me: string,
  postIds: string[],
): Promise<string[]> {
  if (!me || postIds.length === 0) return [];

  const { data, error } = await api
    .from("bookmarks")
    .select("post_id")
    .eq("user_id", me)
    .in("post_id", postIds);

  if (error) return [];
  return ((data as { post_id: string }[]) ?? []).map((r) => String(r.post_id));
}

/**
 * La liste de lecture, du plus récent signet au plus ancien.
 *
 * La jointure passe par `bookmarks` puis par `posts`, en deux requêtes,
 * et non par une jointure PostgREST à travers la table de jonction.
 * Même raison que pour les listes de suivi : nommer la jointure exige
 * de connaître le nom exact de la contrainte de clé étrangère, et ce
 * nom casse dès qu'on renomme une contrainte.
 */
export async function fetchBookmarks(
  me: string,
): Promise<{ rows: PostWithAuthor[]; empty: boolean }> {
  if (!me) return { rows: [], empty: true };

  const { data: links, error } = await api
    .from("bookmarks")
    .select("post_id, created_at")
    .eq("user_id", me)
    .order("created_at", { ascending: false });

  if (error) return { rows: [], empty: true };

  const rows = (links as Bookmark[] | null) ?? [];
  if (rows.length === 0) return { rows: [], empty: true };

  const { data: posts } = await api
    .from("posts")
    .select(`*, author:users!posts_author_id_fkey(${POST_AUTHOR})`)
    .in(
      "id",
      rows.map((r) => r.post_id),
    );

  // L'ordre vient des signets, pas des publications : une liste de
  // lecture se lit dans l'ordre où on a choisi de garder les choses, et
  // non dans celui où elles ont été publiées. Un post vieux qu'on
  // vient de retrouver doit remonter.
  const parDate = new Map(
    ((posts as PostWithAuthor[] | null) ?? []).map((p) => [p.id, p]),
  );

  return {
    rows: rows
      .map((r) => parDate.get(r.post_id))
      .filter((p): p is PostWithAuthor => p !== undefined),
    empty: false,
  };
}

/** Le nombre de signets d'une publication — pour son auteur uniquement. */
export async function fetchBookmarkCount(postId: string): Promise<number> {
  if (!postId) return 0;

  const { count } = await api
    .from("bookmarks")
    .select("post_id", { count: "exact", head: true })
    .eq("post_id", postId);

  return count ?? 0;
}

/* ── Versions en cache ──────────────────────────────────────────── */

/** Version en cache de `fetchBookmarkedPostIds` (TTL 30s). */
export async function fetchBookmarkedPostIdsCached(
  me: string,
  postIds: string[],
): Promise<string[]> {
  if (postIds.length === 0 || !me) return [];
  return cachedQuery("bookmarkedPostIds", [me, postIds.sort()], () =>
    fetchBookmarkedPostIds(me, postIds),
  );
}
