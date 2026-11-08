import { supabase } from "@/lib/supabase/client";
import type { CommentWithAuthor, PostWithAuthor, PublicProfile } from "@/lib/types";
import { invalidateCache } from "@/lib/queryCache";
import { fetchBookmarkedPostIds } from "@/lib/signets";
import { fetchProjectsForPosts } from "@/lib/repo";
import { withAuthorXp } from "@/lib/author-xp";
import {
  AUTHOR_COLUMNS,
  POST_AUTHOR_COLUMNS,
  PROFILE_COLUMNS,
} from "@/lib/post-projections";
import {
  fetchFeedPage as fetchFeedPageFromContainer,
  toggleFeedLike,
} from "@/platform/container";
import {
  DEFAULT_FEED_PAGE_SIZE,
  emptyHydration,
  type FeedHydration,
  type FeedPage,
  type FetchFeedPageOptions,
} from "@/modules/feed";

export type { PublicProfile };
export { AUTHOR_COLUMNS, PROFILE_COLUMNS } from "@/lib/post-projections";
export type { FeedPage, FeedScope } from "@/modules/feed";

/**
 * Actions du graphe social.
 *
 * Toutes passent par des **lignes** — `post_likes`, `follows`,
 * `comments` — et jamais par un compteur. Ce n'est pas une préférence de
 * style : un compteur est une donnée que le client écrit, donc une
 * donnée que la RLS ne peut pas protéger, puisque la RLS raisonne en
 * lignes et non en colonnes. Tant que le like était un `int` sur le post,
 * n'importe quel utilisateur authentifié pouvait écrire `likes = 9999`
 * — et, avant que `posts_update` ne soit durcie, sur n'importe quel post.
 *
 * Chaque fonction est écrite pour donner le même résultat avec le vrai
 * client et avec le moteur de démonstration : le code de l'écran ne doit
 * pas pouvoir distinguer les deux.
 */

/**
 * Colonnes d'auteur reprises par jointure.
 *
 * Une seule liste pour tous les écrans : dès qu'on lit un auteur, on lit
 * cette liste. `filiere` et `niveau` y figurent parce que la carte de
 * post les affiche — les lire sur une colonne recopiée dans le post les
 * figerait au moment de la publication.
 */
/**
 * Colonnes d'un profil public, en plus de celles d'une carte de post.
 *
 * Le profil est la seule page où l'on parle de la personne **et** de ce
 * qu'elle fait. On ne veut pas de ces colonnes sur chaque carte du fil :
 * un post n'a pas à transporter la biographie de son auteur, et le fil
 * charge une trentaine de jointures.
 */
const COMMENT_AUTHOR_COLUMNS = AUTHOR_COLUMNS;

/**
 * L'auteur d'une **publication**, joint par sa contrainte nommée.
 *
 * PostgREST refuse une jointure ambiguë (`PGRST201`, HTTP 300) : entre
 * `posts` et `users` il n'y a pas un chemin mais cinq — `author_id`, puis
 * `post_likes`, `bookmarks`, `reactions` et `reposts`, qui font chacun un
 * many-à-many. Nommer la contrainte dit lequel on veut.
 *
 * Ce n'est pas une préférence de style : sans le nom, le fil ne rend
 * **rien** contre une vraie base — la requête entière échoue, pas
 * seulement la jointure. Le mode démonstration, lui, ignorait les clés
 * étrangères : l'écart ne se voyait donc qu'en mode réel, et il se
 * présentait comme un fil vide, c'est-à-dire comme une absence de
 * données.
 */
/* ── Modification et suppression ────────────────────────────────────── */

/**
 * Corrige le texte — et le snippet — d'un post.
 *
 * Le client n'écrit que les colonnes qu'il possède : `likes`,
 * `liked_by` et `comments` ont été retirées du droit de mise à jour
 * (migration 005, section 7), donc les nommer ici ferait échouer
 * l'écriture entière. Le compteur se recalculera de lui-même.
 *
 * `created_at` n'est pas touchée : un post modifié n'est pas un post
 * plus récent, et le remonter dans le fil ferait perdre l'ordre réel
 * des publications.
 */
export async function updatePost(
  postId: string,
  patch: { text: string; code?: string; lang?: string; has_code?: boolean },
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("posts")
    .update({
      text: patch.text,
      ...(patch.has_code !== undefined
        ? { has_code: patch.has_code, code: patch.code ?? "", lang: patch.lang ?? "" }
        : {}),
    })
    .eq("id", postId);

  return { error: error?.message ?? null };
}

/**
 * Supprime un post. La RLS (`posts_delete`) n'autorise que son auteur,
 * donc un échec ici signifie « pas le vôtre », pas « le réseau est tombé ».
 */
export async function deletePost(postId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  return { error: error?.message ?? null };
}

/* ── Likes ───────────────────────────────────────────────────────── */

/**
 * Ajoute ou retire le like de `me` sur le post `postId`.
 *
 * On tente l'insertion et on traite le refus de clé primaire comme « déjà
 * liké », donc comme le signal de retirer. C'est ce qui rend l'action
 * atomique : on ne lit pas la liste des likers pour la recalculer, ce
 * qui ouvrirait une fenêtre entre la lecture et l'écriture.
 */
export async function toggleLike(
  postId: string,
  me: string,
): Promise<{ liked: boolean; error: string | null }> {
  return toggleFeedLike(postId, me);
}

/* ── Réactions ────────────────────────────────────────────────────── */

/**
 * Pose ou remplace la réaction de `me` sur le post `postId`.
 *
 * Le remplacement se fait par delete+insert, car la clé `(post_id, user_id)`
 * interdit deux lignes pour le même auteur. Sur le vrai client le RE5RT
 * renvoie une erreur de clé dupliquée ; le démo la simule via
 * `COMPOSITE_KEYS`.
 *
 * Si `emoji` est null/empty, la réaction existante est retirée sans en
 * poser une nouvelle.
 */
export async function setReaction(
  postId: string,
  me: string,
  emoji: string | null,
): Promise<{ reaction: string | null; error: string | null }> {
  if (!me) return { reaction: null, error: "Non connecté" };

  // On retire d'abord : cela couvre le remplacement (changer d'emoji)
  // et le retrait pur avec le même chemin. L'erreur du retrait n'est pas
  // remontée telle quelle quand une nouvelle réaction suit — une
  // réaction de remplacement qui échoue se voit tout de suite, alors
  // qu'un retrait qui échoue ne se verrait qu'en relisant le fil.
  const { error: delError } = await supabase
    .from("reactions")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", me);

  if (!emoji) return { reaction: null, error: delError?.message ?? null };

  const { error: insError } = await supabase
    .from("reactions")
    .insert({ post_id: postId, user_id: me, emoji });

  if (!insError) return { reaction: emoji, error: null };

  const isDuplicate = /duplicate key|23505/i.test(insError.message);
  if (!isDuplicate) return { reaction: null, error: insError.message };

  // Un doublon ici ne devrait pas arriver après le delete, mais si ça
  // arrive (ex: race), on renvoie l'emoji demandé comme provisoire et
  // l'écran se resynchronise au prochain flux.
  return { reaction: emoji, error: null };
}

/**
 * L'emoji réagissant par `me`, ou null.
 *
 * Une seule ligne par `user_id` sur le post, donc `.maybeSingle()`.
 */
export async function fetchMyReaction(
  postId: string,
  me: string,
): Promise<string | null> {
  if (!me) return null;

  const { data } = await supabase
    .from("reactions")
    .select("emoji")
    .eq("post_id", postId)
    .eq("user_id", me)
    .maybeSingle();

  return (data as { emoji: string } | null)?.emoji ?? null;
}

/**
 * Les réactions du lecteur sur plusieurs posts, en une requête.
 *
 * Un fil affiche douze cartes : appeler `fetchMyReaction` sur chacune
 * ferait douze requêtes pour une information qui tient dans un `in`.
 * On renvoie donc un index `post_id → emoji`, ce qu'est l'état du fil.
 */
export async function fetchMyReactions(
  me: string,
  postIds: string[],
): Promise<Record<string, string>> {
  if (!me || postIds.length === 0) return {};

  const { data, error } = await supabase
    .from("reactions")
    .select("post_id, emoji")
    .eq("user_id", me)
    .in("post_id", postIds);

  if (error) return {};

  const out: Record<string, string> = {};
  for (const row of (data as { post_id: string; emoji: string }[]) ?? []) {
    out[String(row.post_id)] = row.emoji;
  }
  return out;
}

/**
 * Les réactions d'un post, groupées par emoji.
 *
 * Réservé au sélecteur : la ligne de réactions affichée au-dessus de la
 * barre d'actions a besoin du détail, pas seulement du total.
 */
export async function fetchReactionCounts(
  postId: string,
): Promise<Record<string, number>> {
  if (!postId) return {};

  const { data, error } = await supabase
    .from("reactions")
    .select("emoji")
    .eq("post_id", postId);

  if (error) return {};

  const out: Record<string, number> = {};
  for (const row of (data as { emoji: string }[]) ?? []) {
    out[row.emoji] = (out[row.emoji] ?? 0) + 1;
  }
  return out;
}

/* ── Reposts ──────────────────────────────────────────────────────── */

/** Publie ou retire le repost de `me`. Retourne si le post est republié. */
export async function toggleRepost(
  postId: string,
  me: string,
): Promise<{ reposted: boolean; error: string | null }> {
  if (!me) return { reposted: false, error: "Non connecté" };

  // On **lit** avant d'écrire, parce qu'un « toggle » qui ne sait pas
  // dans quel état il est ne peut pas être atomique dans les deux sens :
  // supprimer puis insérer revient toujours à « republié », et le retrait
  // devient impossible. Une lecture, puis une seule écriture.
  //
  // Le coût est une requête de plus que pour `toggleLike`. Il est
  // justifié : le like se déduit de l'échec d'insertion, alors que le
  // retrait du repost n'a aucun « échec » à exploitable — il réussit
  // toujours, qu'il y ait une ligne ou non.
  const { data: existing, error: readError } = await supabase
    .from("reposts")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", me)
    .maybeSingle();

  if (readError) return { reposted: false, error: readError.message };

  if (existing) {
    const { error } = await supabase
      .from("reposts")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", me);

    return error
      ? { reposted: true, error: error.message }
      : { reposted: false, error: null };
  }

  const { error } = await supabase
    .from("reposts")
    .insert({ post_id: postId, user_id: me });

  // Un doublon ici signifierait qu'un autre posteur a fait la même chose
  // entre la lecture et l'écriture : l'état demandé est atteint, donc on
  // ne le signale pas comme une panne.
  if (error && !/duplicate key|23505/i.test(error.message)) {
    return { reposted: false, error: error.message };
  }

  return { reposted: true, error: null };
}

/**
 * Les identifiants des posts aimés par `me`.
 *
 * Une seule requête, quel que soit le nombre de posts : on ne veut pas
 * une requête par carte du fil. Le `in` est donc construit à partir des
 * identifiants présents, et une liste vide court-circuite — un `in ()`
 * est une erreur de syntaxe dans PostgREST, pas un résultat vide.
 */
export async function fetchLikedPostIds(me: string, postIds: string[]): Promise<string[]> {
  if (postIds.length === 0 || !me) return [];

  const { data, error } = await supabase
    .from("post_likes")
    .select("post_id")
    .eq("user_id", me)
    .in("post_id", postIds);

  if (error) return [];
  return ((data as { post_id: string }[]) ?? []).map((r) => String(r.post_id));
}

/** Identifiants des posts que `me` a republiés. */
export async function fetchRepostIds(me: string, postIds: string[]): Promise<string[]> {
  if (postIds.length === 0 || !me) return [];

  const { data, error } = await supabase
    .from("reposts")
    .select("post_id")
    .eq("user_id", me)
    .in("post_id", postIds);

  if (error) return [];
  return ((data as { post_id: string }[]) ?? []).map((r) => String(r.post_id));
}

/**
 * État d'interaction du lecteur pour une page du fil.
 *
 * Quatre lectures dans une seule requête serveur : likes, reposts, réactions
 * et signets. Le navigateur ne filtre plus sur l'identifiant qu'il croit
 * être le sien — la route lit la session et la RLS décide.
 *
 * Un échec rend `null` : l'écran garde l'état qu'il avait au lieu de croire
 * que plus rien n'est aimé.
 */
export async function fetchFeedHydration(postIds: string[]): Promise<FeedHydration | null> {
  if (postIds.length === 0) return emptyHydration();

  const parameters = new URLSearchParams({ ids: postIds.join(",") });
  try {
    const response = await fetch(`/api/feed/hydration?${parameters.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as FeedHydration;
  } catch {
    return null;
  }
}

/* ── Suivi ───────────────────────────────────────────────────────── */

/** Vrai si `me` suit `target`. Un seul `.maybeSingle()` : la clé primaire le garantit. */
export async function isFollowing(me: string, target: string): Promise<boolean> {
  if (!me || !target || me === target) return false;

  const { data } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", me)
    .eq("followee_id", target)
    .maybeSingle();

  return Boolean(data);
}

/** Ajoute ou retire le suivi, comme `toggleLike`. */
export async function toggleFollow(
  me: string,
  target: string,
): Promise<{ following: boolean; error: string | null }> {
  // La base interdit de se suivre soi-même (`follows_no_self`). On évite
  // l'aller-retour inutile, et surtout on n'affiche jamais un bouton qui
  // ne pourrait pas fonctionner.
  if (!me || !target || me === target) {
    return { following: false, error: "Impossible de se suivre soi-même" };
  }

  const { error: insertError } = await supabase
    .from("follows")
    .insert({ follower_id: me, followee_id: target });

  if (!insertError) return { following: true, error: null };

  if (!/duplicate key|23505/i.test(insertError.message)) {
    return { following: false, error: insertError.message };
  }

  const { error: deleteError } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", me)
    .eq("followee_id", target);

  if (deleteError) return { following: true, error: deleteError.message };
  return { following: false, error: null };
}

/* ── Commentaires ────────────────────────────────────────────────── */

/**
 * Les commentaires d'un post, du plus ancien au plus récent.
 *
 * La liste est **plate** : `parent_id` est renvoyé, mais c'est l'écran qui
 * reconstitue le fil. On ne demande pas à la base de rendre un arbre —
 * PostgREST ne le sait pas, et un arbre calculé ici serait une seconde
 * vérité à maintenir en phase avec la clé étrangère. Le tri par
 * `created_at` est celui de la conversation ; l'imbrication est un
 * habillage qui s'y superpose.
 */
export async function fetchComments(postId: string): Promise<CommentWithAuthor[]> {
  const { data } = await supabase
    .from("comments")
    .select(`*, author:users(${COMMENT_AUTHOR_COLUMNS})`)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  return withAuthorXp((data as CommentWithAuthor[]) ?? []);
}

/**
 * Poste un commentaire, éventuellement en réponse à un autre.
 *
 * `parentId` désigne **toujours un commentaire racine** : répondre à une
 * réponse s'affiche sous la réponse, mais s'attache au commentaire racine
 * du fil. C'est la règle de la migration 018 — au-delà d'un niveau, un fil
 * devient illisible sur un téléphone et la notification n'a plus de forme
 * lisible. C'est l'appelant qui remonte à la racine (voir
 * `CommentsPanel`) : la couche données ne fait que transporter la valeur.
 *
 * La longueur est bornée par la base (1 à 1000).
 */
export async function addComment(
  postId: string,
  author: string,
  text: string,
  parentId?: string | null,
): Promise<{ error: string | null }> {
  const clean = text.trim();
  if (!clean) return { error: "Le commentaire est vide" };
  if (clean.length > 1000) return { error: "1000 caractères maximum" };

  const { error } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      author_id: author,
      text: clean,
      parent_id: parentId ?? null,
    });

  return { error: error?.message ?? null };
}

/** Supprime un commentaire — le sien, ou l'un de son post. */
export async function deleteComment(commentId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  return { error: error?.message ?? null };
}

/* ── Lecture du fil ──────────────────────────────────────────────── */

/**
 * Posts par page.
 *
 * Douze, pas quarante : c'est ce qui remplit un écran de téléphone sans
 * le faire déborder, et surtout ce qui garde le bouton « charger plus »
 * présent dans une démonstration au lieu d'être un code mort qu'on ne
 * voit jamais.
 */
export const PAGE_SIZE = DEFAULT_FEED_PAGE_SIZE;

/**
 * Une page du fil, du plus récent au plus ancien.
 *
 * Pagination par **curseur** sur `created_at`, et non par `offset` : avec
 * un décalage, publier un post pendant que le lecteur parcourt la liste
 * décale toutes les lignes d'un cran — il saute une publication ou en
 * voit une deux fois. Un curseur ne bouge jamais : « plus ancien que le
 * dernier post que j'ai vu » reste vrai quoi qu'il arrive entre-temps.
 *
 * Deux `created_at` identiques sont le seul cas limite : la page suivante
 * commence alors sur la même seconde. Ça n saute rien — au pire, la
 * lecture s'arrête sur deux publications partageant leur horodatage —
 * et cela reste plus rare qu'une publication pendant qu'on lit.
 */
export function fetchFeedPage(options: FetchFeedPageOptions = {}): Promise<FeedPage> {
  return fetchFeedPageFromContainer(options);
}

/**
 * Une publication par son identifiant.
 *
 * C'est ce que permet le lien permanent : une notification de like ou
 * de mention mène à **la publication**, pas au fil où elle se trouve
 * peut-être trois pages plus bas. Une notification qui mène à un
 * endroit sans l'objet oblige à chercher — elle n'est alors qu'un
 * pense-bête qui donne soif d'information.
 */
export async function fetchPostById(id: string): Promise<PostWithAuthor | null> {
  if (!id) return null;

  const { data } = await supabase
    .from("posts")
    .select(`*, author:${POST_AUTHOR_COLUMNS}`)
    .eq("id", id)
    .maybeSingle();

  const row = (data as PostWithAuthor) ?? null;
  if (!row) return null;
  const [enriched] = await withAuthorXp([row]);
  return enriched ?? row;
}

/** Le profil public d'un pseudo, et une première page de ses posts. */
export async function fetchProfileByPseudo(
  pseudo: string,
): Promise<{ user: PublicProfile | null; posts: PostWithAuthor[]; more: boolean }> {
  const { data: user } = await supabase
    .from("users")
    .select(PROFILE_COLUMNS)
    .ilike("pseudo", pseudo)
    .maybeSingle();

  if (!user) return { user: null, posts: [], more: false };

  const { data: posts } = await supabase
    .from("posts")
    .select(`*, author:${POST_AUTHOR_COLUMNS}`)
    .eq("author_id", (user as PublicProfile).id)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1);

  const rows = await withAuthorXp((posts as PostWithAuthor[]) ?? []);

  return {
    user: user as PublicProfile,
    posts: rows.slice(0, PAGE_SIZE),
    more: rows.length > PAGE_SIZE,
  };
}

/** Sens de lecture d'une liste de suivi. */
export type FollowListKind = "followers" | "following";

/**
 * Les personnes qu'un compte suit, ou celles qui le suivent.
 *
 * **Deux requêtes, volontairement.** PostgREST ne sait pas parcourir
 * `follows` vers `users` par une jointure de many-à-many qu'on puisse
 * nommer sans connaître le nom exact des contraintes de clé étrangère —
 * et ce nom change dès qu'on renomme une contrainte. On lit donc les liens
 * (une seule requête, déjà indexée sur les deux colonnes), puis les profils
 * par `.in("id", …)`.
 *
 * C'est plus lent qu'une jointure en théorie. En pratique, une liste
 * d'abonnés se compte par dizaines, pas par milliers : si un jour elle
 * dépasse la page, il faudra une pagination par curseur — mais ce jour-là,
 * les deux requêtes tiendront largement.
 *
 * L'ordre suit `follows.created_at` — le plus récent suivi en tête, donc
 * une liste qui change au même endroit que la page d'accueil. On ne trie
 * pas par nombre d'abonnés : ce serait un classement, et un classement
 * pousse à suivre les gros comptes. Ce que la page montre, c'est l'ordre
 * dans lequel les liens ont été noués.
 */
export async function fetchFollowList(
  targetId: string,
  kind: FollowListKind,
): Promise<PublicProfile[]> {
  if (!targetId) return [];

  // La colonne filtrée est celle qui vaut pour *ce* profil ; l'autre est
  // celle dont on veut les valeurs.
  const filter = kind === "followers" ? "followee_id" : "follower_id";
  const wanted = kind === "followers" ? "follower_id" : "followee_id";

  const { data: links } = await supabase
    .from("follows")
    .select(`created_at, ${wanted}`)
    .eq(filter, targetId)
    .order("created_at", { ascending: false });

  const rows = (links ?? []) as { created_at: string; follower_id: string; followee_id: string }[];
  const ids = rows.map((r) => r[wanted]).filter(Boolean);
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from("users")
    .select(PROFILE_COLUMNS)
    .in("id", ids);

  const byId = new Map(
    ((profiles ?? []) as PublicProfile[]).map((u) => [u.id, u]),
  );

  // Le tri se fait ici, pas en base : `.in()` ne garantit aucun ordre, et
  // une liste de suivi rangée par ordre alphabétique perdrait le seul
  // indice qu'elle porte — la date du lien.
  return ids
    .map((id) => byId.get(id))
    .filter((u): u is PublicProfile => u !== undefined);
}

/* ── Versions en cache pour la navigation ────────────────────────── */

import { cachedQuery } from "@/lib/queryCache";

/** Version en cache de `fetchFeedPage` (TTL 30s). */
export async function fetchFeedPageCached(options: {
  scope?: "all" | "followed";
  me?: string | null;
  before?: string | null;
  pageSize?: number;
}): Promise<FeedPage> {
  return cachedQuery("feedPage", [options], () => fetchFeedPage(options));
}

/** Version en cache de `fetchFeedHydration` (TTL 30s). */
export function fetchFeedHydrationCached(
  postIds: string[],
): Promise<FeedHydration | null> {
  if (postIds.length === 0) return Promise.resolve(emptyHydration());
  return cachedQuery("feedHydration", [[...postIds].sort()], () => fetchFeedHydration(postIds));
}

/** Version en cache de `fetchLikedPostIds` (TTL 30s). */
export async function fetchLikedPostIdsCached(
  me: string,
  postIds: string[],
): Promise<string[]> {
  if (postIds.length === 0 || !me) return [];
  return cachedQuery("likedPostIds", [me, postIds.sort()], () =>
    fetchLikedPostIds(me, postIds),
  );
}

/** Version en cache de `fetchRepostIds` (TTL 30s). */
export async function fetchRepostIdsCached(
  me: string,
  postIds: string[],
): Promise<string[]> {
  if (postIds.length === 0 || !me) return [];
  return cachedQuery("repostIds", [me, postIds.sort()], () =>
    fetchRepostIds(me, postIds),
  );
}

/** Version en cache de `fetchMyReactions` (TTL 30s). */
export async function fetchMyReactionsCached(
  me: string,
  postIds: string[],
): Promise<Record<string, string>> {
  if (postIds.length === 0 || !me) return {};
  return cachedQuery("myReactions", [me, postIds.sort()], () =>
    fetchMyReactions(me, postIds),
  );
}

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

/** Version en cache de `fetchProjectsForPosts` (TTL 30s). */
export async function fetchProjectsForPostsCached(
  postIds: string[],
): Promise<Map<string, { id: string; name: string; emoji: string }>> {
  if (postIds.length === 0) return new Map();
  return cachedQuery("projectsForPosts", [postIds.sort()], () =>
    fetchProjectsForPosts(postIds),
  );
}

/** Version en cache de `fetchProfileByPseudo` (TTL 30s). */
export async function fetchProfileByPseudoCached(
  pseudo: string,
): Promise<{ user: PublicProfile | null; posts: PostWithAuthor[]; more: boolean }> {
  return cachedQuery("profileByPseudo", [pseudo], () =>
    fetchProfileByPseudo(pseudo),
  );
}

/** Version en cache de `fetchFollowList` (TTL 30s). */
export async function fetchFollowListCached(
  targetId: string,
  kind: FollowListKind,
): Promise<PublicProfile[]> {
  return cachedQuery("followList", [targetId, kind], () =>
    fetchFollowList(targetId, kind),
  );
}

/** Invalide le cache lié aux posts (likes, reactions, etc.). */
export function invalidatePostCache() {
  invalidateCache("feedHydration");
  invalidateCache("likedPostIds");
  invalidateCache("repostIds");
  invalidateCache("myReactions");
  invalidateCache("bookmarkedPostIds");
  invalidateCache("projectsForPosts");
  invalidateCache("feedPage");
}