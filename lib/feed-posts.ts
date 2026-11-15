import type { PostWithAuthor } from "@/lib/types";

/**
 * Fusionne une page relue avec la liste affichée, sans casser le défilement.
 *
 * `refresh()` est appelé après chaque like, réaction ou repost : remplacer
 * toute la liste par la première page repliait le fil sous les yeux du
 * lecteur. Ici, on conserve les lignes déjà affichées, on ajoute celles
 * qu'on ne connaissait pas encore, et on retrie comme le serveur — qu'un
 * post surgisse en tête ou disparaisse de la lecture ne déplace jamais ce
 * qu'on est en train de lire.
 */
export function mergePosts(
  prev: PostWithAuthor[] | null,
  incoming: PostWithAuthor[],
): PostWithAuthor[] {
  const byId = new Map((prev ?? []).map((p) => [p.id, p]));
  for (const p of incoming) if (!byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
}
