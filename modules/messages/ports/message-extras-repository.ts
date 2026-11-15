import type { MessageTarget } from "@/lib/types";

/**
 * Port du domaine « messages » — réactions, épingles et suppression.
 *
 * Le contrat parle de messages, pas de tables : l'adaptateur porte la forme
 * des requêtes, le service porte les décisions. Rien ici ne connaît
 * `message_reactions` ni `message_pins`.
 */
export interface ReactionRow {
  target_id: string;
  emoji: string;
  user_id: string;
}

/**
 * Le jeu d'emojis, aligné sur `message_reactions_emoji_check` (migration
 * 018). Écrit en échappements Unicode : aucun emoji littéral dans le code,
 * mais de vrais emojis à l'écran.
 *
 * Il vit dans le port parce que **l'ordre d'affichage est une règle du
 * domaine** : deux personnes qui réagissent dans un ordre différent doivent
 * voir les pastilles rangées de la même façon. Laisser cet ordre à
 * l'adaptateur ferait dépendre le rendu du fournisseur.
 */
export const MESSAGE_EMOJIS = [
  "\u2705", // ✅ Approuver
  "\u2764\uFE0F", // ❤️ Aimer
  "\u{1F602}", // 😂 Rire
  "\u{1F62E}", // 😮 Surpris
  "\u{1F622}", // 😢 Triste
  "\u{1F525}", // 🔥 Élan
] as const;

export type MessageEmoji = (typeof MESSAGE_EMOJIS)[number];

/** L'état agrégé d'une réaction, tel qu'il s'affiche sur une bulle. */
export interface ReactionSummary {
  emoji: string;
  count: number;
  /** La réaction a-t-elle été posée par le lecteur ? */
  mine: boolean;
}

/** Les réactions visibles, indexées par identifiant de message. */
export type ReactionsByMessage = Record<string, ReactionSummary[]>;

export interface ReactionInput {
  targetType: MessageTarget;
  targetId: string;
  userId: string;
  emoji: string;
}

export interface PinInput {
  targetType: MessageTarget;
  targetId: string;
  userId: string;
}

export interface MessageExtrasRepository {
  /** Toutes les réactions des messages affichés, en une lecture. */
  listReactions(targetType: MessageTarget, targetIds: string[]): Promise<ReactionRow[]>;

  /**
   * La réaction exacte, ou `null`. La table n'a aucune clé qui empêcherait
   * deux lignes identiques : le doublon ne lève pas d'erreur, donc l'échec
   * d'insertion n'est pas exploitable pour détecter l'existence.
   */
  findReaction(
    targetType: MessageTarget,
    targetId: string,
    userId: string,
    emoji: string,
  ): Promise<{ row: { id: string } | null; error: string | null }>;

  addReaction(input: ReactionInput): Promise<{ error: string | null }>;
  deleteReaction(id: string): Promise<{ error: string | null }>;

  deleteMessage(messageId: string): Promise<{ error: string | null }>;

  listPinnedIds(targetType: MessageTarget, userId: string): Promise<string[]>;

  findPin(
    targetType: MessageTarget,
    targetId: string,
    userId: string,
  ): Promise<{ row: { id: string } | null; error: string | null }>;

  addPin(input: PinInput): Promise<{ error: string | null }>;
  deletePin(id: string): Promise<{ error: string | null }>;
}
