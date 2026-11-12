import { api } from "@/lib/api/client";
import type { AvatarColor, GroupMember, GroupRole } from "@/lib/types";
import { loadAuthorXp } from "@/lib/author-xp";

/**
 * Les membres d'un groupe — et leurs pouvoirs.
 *
 * ## La règle de partage entre écran et base
 *
 * La RLS décide de ce qui est **possible** ; cette couche ne fait que la
 * révéler à l'écran, pour qu'un bouton n'apparaisse que là où il
 * fonctionnera. L'audit du projet l'a imposé dans cet ordre : « ajouter
 * une UI de rôles sans d'abord câbler la RLS produirait exactement le
 * défaut que le projet combat — un bouton qui affiche une action et ne
 * la fait pas. » (migration 020 pour la partie RLS.)
 *
 * Conséquence assumée : l'écran connaît le rôle du visiteur. Ce n'est
 * pas une autorisation — réécrire le client ne donne aucun droit —
 * c'est de la **prévisibilité** : on ne montre pas un bouton qui
 * échouera.
 */

/** Une adhésion avec le profil résolu, pour la liste des membres. */
export interface MemberRow extends GroupMember {
  user: {
    id: string;
    prenom: string;
    pseudo: string;
    avatar_color: AvatarColor;
    avatar_url?: string;
    account_type: string;
    verified?: boolean;
    is_admin?: boolean;
    xp?: number;
  } | null;
}

/** Libellés des rôles, dans l'ordre de lecture d'une liste. */
export const ROLE_LABEL: Record<GroupRole, string> = {
  owner: "créateur",
  moderator: "modérateur",
  member: "membre",
};

/** L'équipe — les deux rôles qui modèrent. Même liste que la RLS. */
export function isStaff(role: GroupRole | null | undefined): boolean {
  return role === "owner" || role === "moderator";
}

/** La liste des membres d'un groupe, profils joints. */
export async function fetchMembers(groupId: string): Promise<MemberRow[]> {
  const { data } = await api
    .from("group_members")
    .select(
      "group_id, user_id, role, joined_at, " +
        "user:users(id, prenom, pseudo, avatar_color, avatar_url, account_type, verified, is_admin)",
      )
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  const rows = (data as unknown as MemberRow[]) ?? [];
  const xp = await loadAuthorXp(rows.map((r) => r.user?.id));
  if (xp.size === 0) return rows;
  return rows.map((row) => {
    const value = row.user ? xp.get(row.user.id) : undefined;
    if (!row.user || value === undefined) return row;
    return { ...row, user: { ...row.user, xp: value } };
  });
}

/**
 * Le rôle de quelqu'un dans un groupe, lu depuis la même requête que la
 * liste. Une seconde lecture du rôle serait une seconde source — et deux
 * sources divergent au premier changement de rôle.
 */
export function myRole(
  members: MemberRow[],
  userId: string | undefined,
): GroupRole | null {
  if (!userId) return null;
  return members.find((m) => m.user_id === userId)?.role ?? null;
}

/**
 * Régler le rôle d'un membre — réservé au créateur par la RLS
 * (`group_members_update`, 005 réécrite en 020).
 *
 * La ligne se relit après écriture (`select` sur l'`update`) : le rôle
 * affiché doit être celui que la base a accepté, pas celui qu'on a
 * espéré.
 */
export async function setMemberRole(
  groupId: string,
  userId: string,
  role: GroupRole,
): Promise<{ error: string | null }> {
  const { error } = await api
    .from("group_members")
    .update({ role })
    .eq("group_id", groupId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/**
 * Retirer un membre — par lui-même, par le créateur, ou par l'équipe
 * visant un membre simple (`group_members_delete`, étendue en 020).
 */
export async function removeMember(
  groupId: string,
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await api
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);

  return { error: error?.message ?? null };
}

/**
 * Supprimer un message de groupe — l'auteur, le créateur, ou l'équipe
 * (`gm_delete`, étendue en 020).
 *
 * La suppression est renvoyée en erreur **textuelle** à l'écran, qui
 * décide du message : une RLS qui refuse en silence ne doit pas
 * ressembler à un succès.
 */
export async function deleteGroupMessage(
  messageId: string,
): Promise<{ error: string | null }> {
  const { error } = await api
    .from("group_messages")
    .delete()
    .eq("id", messageId);

  return { error: error?.message ?? null };
}
