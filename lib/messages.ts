import { messageExtrasService } from "@/platform/container";
import {
  MESSAGE_EMOJIS,
  type MessageEmoji,
  type ReactionsByMessage,
  type ReactionSummary,
} from "@/modules/messages";
import type { MessageTarget } from "@/lib/types";

/**
 * Réactions, épingles et suppression sur les messages — API publique.
 *
 * Ce fichier **ne contient plus de requête**. Il garde les constantes et les
 * types que l'écran importe depuis la vague 1, et délègue les cinq cas
 * d'usage au service du domaine (`modules/messages`), composé dans
 * `platform/container.ts`.
 *
 * Pourquoi garder la façade : trois écrans appellent ces fonctions
 * (`app/messages`, `app/groups/[id]`, `components/MessageExtras`). Les faire
 * changer de chemin en même temps qu'on déplace la frontière mêlerait deux
 * migrations dans un seul diff — et rendrait impossible de dire laquelle a
 * cassé quoi.
 *
 * Ce que la façade n'ajoute **aucune** vérification de permission : la RLS
 * tranche, et une règle ici serait une seconde vérité qui divergerait au
 * premier changement de politique.
 *
 * Une seule couche pour le privé **et** les canaux : des cibles qui n'ont
 * rien à voir se portent dans une table avec une colonne de type, comme
 * pour les signalements (migration 011). Deux modules doubleraient les
 * politiques, les tests et les échecs pour une différence qui tient dans un
 * enum.
 *
 * ## Réactions : plusieurs icônes par personne, contrairement aux posts
 *
 * Sur une publication, `(post_id, user_id)` n'autorise **qu'une** icône par
 * personne : on vote, on ne cumule pas. Sur un message, `message_reactions`
 * n'a que son `id` pour clé — réagir avec l'élan **et** le rire est un geste
 * ordinaire. Chaque icône est donc une bascule indépendante.
 *
 * ## Épingles : privées
 *
 * Comme les signets, une épingle décrit ce que **moi** je garde sous les
 * yeux. La lecture est restreinte à `auth.uid() = user_id` (migration 018),
 * donc elle ne se partage pas — et l'écran ne prétend jamais afficher
 * l'épingle de quelqu'un d'autre.
 */

export { MESSAGE_EMOJIS };
export type { MessageEmoji, ReactionsByMessage, ReactionSummary };

/**
 * Lit et agrège les réactions de plusieurs messages.
 *
 * L'agrégation et l'ordre d'affichage vivent dans le service : une réaction
 * est une ligne, l'écran lit un compteur par icône rangé selon le jeu
 * déclaré — pas selon l'ordre d'arrivée.
 */
export function fetchMessageReactions(
  targetType: MessageTarget,
  targetIds: string[],
  me: string | null,
): Promise<ReactionsByMessage> {
  return messageExtrasService.fetchReactions(targetType, targetIds, me);
}

/** Pose ou retire une réaction de `me` sur un message. */
export function toggleMessageReaction(
  targetType: MessageTarget,
  targetId: string,
  me: string,
  emoji: string,
): Promise<{ active: boolean; error: string | null }> {
  return messageExtrasService.toggleReaction(targetType, targetId, me, emoji);
}

/**
 * Supprime un message privé.
 *
 * La RLS tranche : l'auteur peut supprimer le sien. L'écran ne montre le
 * bouton qu'à ceux dont on sait qu'ils y ont droit ; la suppression reste
 * une décision de la base, et son refus se dit.
 */
export function deleteMessage(messageId: string): Promise<{ error: string | null }> {
  return messageExtrasService.deleteMessage(messageId);
}

/** Les identifiants des messages épinglés par `me`. */
export function fetchPinnedMessageIds(
  targetType: MessageTarget,
  me: string,
): Promise<Set<string>> {
  return messageExtrasService.fetchPinnedIds(targetType, me);
}

/**
 * Pose ou retire l'épingle de `me`.
 *
 * Sémantique de bascule attendue par le bouton — un bouton qui ne dépingle
 * jamais serait le défaut exact trouvé sur `toggleRepost` (section 21 du
 * MEMO).
 */
export function toggleMessagePin(
  targetType: MessageTarget,
  targetId: string,
  me: string,
): Promise<{ pinned: boolean; error: string | null }> {
  return messageExtrasService.togglePin(targetType, targetId, me);
}
