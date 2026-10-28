import { supabase } from "@/lib/supabase/client";
import { AUTHOR_COLUMNS } from "@/lib/social";
import { slugify, uniqueSlug } from "@/lib/groups/channels";
import type {
  AvatarColor, Community, CommunityMember, CommunityRole,
  CommunityVisibility, PostWithAuthor,
} from "@/lib/types";

/**
 * Les communautés — des fils publics, distincts des groupes.
 *
 * Cette couche ne décide de **rien** : la RLS de la migration 028 tranche
 * ce qui est lisible et écrivable ; ici on ne fait que le révéler à
 * l'écran, pour qu'un bouton n'apparaisse que là où il fonctionnera. La
 * même frontière que `lib/groups/members.ts`.
 */

const COMMUNITY_COLUMNS =
  "id, slug, name, description, rules, icon, visibility, created_by, member_count, created_at";

/** Une adhésion avec le profil résolu, pour la liste des membres. */
export interface CommunityMemberRow extends CommunityMember {
  user: {
    id: string;
    prenom: string;
    pseudo: string;
    avatar_color: AvatarColor;
    account_type: string;
  } | null;
}

/** Libellés des rôles, dans l'ordre de lecture d'une liste. */
export const ROLE_LABEL: Record<CommunityRole, string> = {
  owner: "créateur",
  moderator: "modérateur",
  member: "membre",
};

/** Libellés des visibilités, pour le sélecteur et l'en-tête. */
export const VISIBILITY_LABEL: Record<CommunityVisibility, string> = {
  public: "Public",
  restricted: "Restreint",
  private: "Privé",
};

/**
 * Ce que dit la visibilité, en une ligne — affiché sous le sélecteur pour
 * qu'on choisisse en connaissance de cause.
 */
export const VISIBILITY_HELP: Record<CommunityVisibility, string> = {
  public: "Visible par tous, on publie sans adhérer.",
  restricted: "Visible par tous, on publie après avoir rejoint.",
  private: "Réservée aux membres : invisible hors de la communauté.",
};

/** L'équipe — les deux rôles qui modèrent. Même liste que la RLS (028). */
export function isCommunityStaff(role: CommunityRole | null | undefined): boolean {
  return role === "owner" || role === "moderator";
}

/** Toutes les communautés lisibles, les plus peuplées d'abord. */
export async function fetchCommunities(): Promise<Community[]> {
  const { data } = await supabase
    .from("communities")
    .select(COMMUNITY_COLUMNS)
    .order("member_count", { ascending: false })
    .order("created_at", { ascending: false });

  return (data as Community[] | null) ?? [];
}

/** Une communauté par son adresse publique — `null` si elle est hors de portée. */
export async function fetchCommunityBySlug(slug: string): Promise<Community | null> {
  const { data } = await supabase
    .from("communities")
    .select(COMMUNITY_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  return (data as Community | null) ?? null;
}

/** Les adhésions d'un utilisateur — pour distinguer « les miennes ». */
export async function fetchMyCommunityIds(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("community_members")
    .select("community_id")
    .eq("user_id", userId);

  return new Set(
    ((data as { community_id: string }[] | null) ?? []).map((r) => r.community_id),
  );
}

/** La liste des membres, profils joints. */
export async function fetchCommunityMembers(
  communityId: string,
): Promise<CommunityMemberRow[]> {
  const { data } = await supabase
    .from("community_members")
    .select(
      "community_id, user_id, role, joined_at, user:users(id, prenom, pseudo, avatar_color, account_type)",
    )
    .eq("community_id", communityId)
    .order("joined_at", { ascending: true });

  return (data as CommunityMemberRow[] | null) ?? [];
}

/** Le rôle du visiteur, lu dans la liste déjà chargée. */
export function myRole(
  members: CommunityMemberRow[],
  userId: string | null,
): CommunityRole | null {
  if (!userId) return null;
  return (members.find((m) => m.user_id === userId)?.role as CommunityRole) ?? null;
}

/**
 * Créer une communauté et y inscrire son créateur comme `owner`.
 *
 * Le slug est dérivé du nom puis rendu unique contre les slugs lisibles :
 * c'est l'adresse publique du fil, elle ne doit pas collisionner. La
 * seconde écriture (l'adhésion `owner`) est ce qui rend la communauté
 * administrable — sans elle, personne n'aurait le rôle dont dépendent les
 * politiques de 028.
 */
export async function createCommunity(
  input: {
    name: string;
    description: string;
    rules: string;
    icon: string;
    visibility: CommunityVisibility;
  },
  ownerId: string,
): Promise<{ community: Community | null; error: string | null }> {
  const taken = await fetchCommunities();
  const slug = uniqueSlug(slugify(input.name), taken.map((c) => c.slug));

  const { data, error } = await supabase
    .from("communities")
    .insert({
      slug,
      name: input.name.trim(),
      description: input.description.trim(),
      rules: input.rules.trim(),
      icon: input.icon,
      visibility: input.visibility,
      created_by: ownerId,
      member_count: 1,
    })
    .select(COMMUNITY_COLUMNS)
    .single();

  if (error) return { community: null, error: error.message };
  const community = data as Community;

  const { error: joinError } = await supabase
    .from("community_members")
    .insert({ community_id: community.id, user_id: ownerId, role: "owner" });

  return { community, error: joinError?.message ?? null };
}

/**
 * Modifier l'identité d'une communauté (nom, description, règlement,
 * icône, visibilité). Le slug et le créateur ne se réécrivent pas.
 */
export async function updateCommunity(
  id: string,
  patch: Partial<Pick<Community, "name" | "description" | "rules" | "icon" | "visibility">>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("communities").update(patch).eq("id", id);
  return { error: error?.message ?? null };
}

/** Supprimer une communauté — le créateur seul (`communities_delete`, 028). */
export async function deleteCommunity(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("communities").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/**
 * Rejoindre une communauté. La ligne est **la sienne** et le rôle posé est
 * `member` : c'est la seule auto-adhésion que la RLS accepte (028).
 */
export async function joinCommunity(
  communityId: string,
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("community_members")
    .insert({ community_id: communityId, user_id: userId, role: "member" });

  return { error: error?.message ?? null };
}

/** Quitter une communauté — sa propre ligne. */
export async function leaveCommunity(
  communityId: string,
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/** Régler le rôle d'un membre — l'équipe seule (`028`). */
export async function setCommunityMemberRole(
  communityId: string,
  userId: string,
  role: CommunityRole,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("community_members")
    .update({ role })
    .eq("community_id", communityId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/** Retirer un membre — l'équipe seule, ou soi-même (`028`). */
export async function removeCommunityMember(
  communityId: string,
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/** Une publication lue avec sa communauté, pour estampiller la carte. */
export interface CommunityPost extends PostWithAuthor {
  community?: Pick<Community, "id" | "slug" | "name" | "visibility"> | null;
}

/**
 * Le fil d'une communauté : ses publications, les plus récentes d'abord.
 *
 * La sélection joint la communauté pour que la carte sache dans quel fil
 * elle est lue ; sans cela, une publication de communauté serait
 * indistinguable d'une publication ordinaire.
 */
export async function fetchCommunityPosts(
  communityId: string,
  limit = 30,
): Promise<CommunityPost[]> {
  const { data } = await supabase
    .from("posts")
    .select(
      // `posts` → `users` passe par cinq chemins : la contrainte d'auteur
      // doit être nommée, sinon PostgREST répond 300 (voir `lib/social.ts`).
      `*, author:users!posts_author_id_fkey(${AUTHOR_COLUMNS}), community:communities(id, slug, name, visibility)`,
    )
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as CommunityPost[] | null) ?? [];
}

/**
 * Les publications des communautés **publiques et restreintes**, pour
 * l'onglet « Communautés » du fil.
 *
 * Les publications d'une communauté `private` sont écartées ici : leur fil
 * ne se lit qu'en y entrant, pas depuis le fil général.
 */
export async function fetchCommunityFeed(limit = 30): Promise<CommunityPost[]> {
  const { data } = await supabase
    .from("posts")
    .select(
      `*, author:users!posts_author_id_fkey(${AUTHOR_COLUMNS}), community:communities(id, slug, name, visibility)`,
    )
    .not("community_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data as CommunityPost[] | null) ?? [];
  return rows.filter((r) => r.community?.visibility !== "private");
}
