import { supabase } from "@/lib/supabase/client";
import type { MessagePin, MessageReaction, MessageTarget } from "@/lib/types";

/**
 * Réactions, épingles et réponses sur les messages.
 *
 * Une seule couche pour le privé **et** les canaux : le projet a déjà
 * tranché cette question pour les signalements (migration 011) et les
 * réactions de message (migration 018) — des cibles qui n'ont rien à voir
 * se portent dans une table avec une colonne de type. Deux modules ici
 * doubleraient les politiques, les tests et les échecs pour une
 * différence qui tient dans un enum.
 *
 * ## Réactions : plusieurs icônes par personne, contrairement aux posts
 *
 * Sur une publication, la clé `(post_id, user_id)` n'autorise **qu'une**
 * icône par personne : on vote, on ne cumule pas. Sur un message,
 * `message_reactions` n'a que son `id` pour clé — c'est-à-dire que la
 * base autorise plusieurs réactions de la même personne sur le même
 * message. On s'aligne sur le schéma plutôt que de le contredire : dans
 * une conversation, réagir avec l'élan **et** le rire est un geste
 * ordinaire, et le refuser produirait un clic qui ne fait rien. Chaque
 * icône est donc une bascule indépendante.
 *
 * ## Épingles : privées
 *
 * Comme les signets, une épingle décrit ce que **moi** je garde sous les
 * yeux. La lecture est restreinte à `auth.uid() = user_id` (migration
 * 018), donc elle ne se partage pas — et l'écran ne prétend jamais
 * afficher une épingle de quelqu'un d'autre.
 */

/** Le jeu d'emojis, aligné sur `message_reactions_emoji_check` (migration
 *  018). Écrit en échappements Unicode : aucun emoji littéral dans le
 *  code, mais de vrais emojis à l'écran. */
export const MESSAGE_EMOJIS = [
  "\u2705",           // ✅ Approuver
  "\u2764\uFE0F",     // ❤️ Aimer
  "\u{1F602}",        // 😂 Rire
  "\u{1F62E}",        // 😮 Surpris
  "\u{1F622}",        // 😢 Triste
  "\u{1F525}",        // 🔥 Élan
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

/**
 * Lit et agrège les réactions de plusieurs messages en une requête.
 *
 * On ne fait pas une requête par bulle : une conversation affiche
 * plusieurs dizaines de messages, et une requête par message rendrait
 * l'ouverture de l'écran proportionnelle à la longueur de l'historique.
 * Le `in` porte sur les identifiants réellement affichés.
 */
export async function fetchMessageReactions(
  targetType: MessageTarget,
  targetIds: string[],
  me: string | null,
): Promise<ReactionsByMessage> {
  if (targetIds.length === 0) return {};

  const { data, error } = await supabase
    .from("message_reactions")
    .select("target_id, emoji, user_id")
    .eq("target_type", targetType)
    .in("target_id", targetIds);

  if (error) return {};

  const acc: Record<string, Map<string, { count: number; mine: boolean }>> = {};

  for (const row of (data as Pick<MessageReaction, "target_id" | "emoji" | "user_id">[]) ?? []) {
    const id = String(row.target_id);
    const byEmoji = (acc[id] ??= new Map());
    const entry = byEmoji.get(row.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (me && row.user_id === me) entry.mine = true;
    byEmoji.set(row.emoji, entry);
  }

  const out: ReactionsByMessage = {};
  for (const [id, byEmoji] of Object.entries(acc)) {
    // On affiche les icônes dans l'ordre déclaré, pas dans l'ordre
    // d'arrivée : deux personnes qui réagissent dans un ordre différent
    // ne doivent pas voir les pastilles se ranger différemment. Les
    // icônes inconnues (données anciennes) passent à la fin.
    out[id] = [...byEmoji.entries()]
      .sort(
        (a, b) =>
          emojiRank(a[0]) - emojiRank(b[0]) ||
          a[0].localeCompare(b[0]),
      )
      .map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }));
  }
  return out;
}

function emojiRank(emoji: string): number {
  const i = (MESSAGE_EMOJIS as readonly string[]).indexOf(emoji);
  return i < 0 ? MESSAGE_EMOJIS.length : i;
}

/**
 * Pose ou retire une réaction de `me` sur un message.
 *
 * Contrairement au like — qui se déduit de l'échec d'insertion — on
 * **lit** d'abord : la table n'a aucune clé qui empêcherait deux lignes
 * pour le même `(message, personne, icône)`, donc le doublon ne lève
 * aucune erreur et l'échec n'est pas exploitable. Une lecture, puis une
 * seule écriture. Le coût est une requête de plus ; il achète la
 * certitude de ne pas empiler deux fois la même icône.
 */
export async function toggleMessageReaction(
  targetType: MessageTarget,
  targetId: string,
  me: string,
  emoji: string,
): Promise<{ active: boolean; error: string | null }> {
  if (!me) return { active: false, error: "Non connecté" };

  const { data: existing, error: readError } = await supabase
    .from("message_reactions")
    .select("id")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("user_id", me)
    .eq("emoji", emoji)
    .maybeSingle();

  if (readError) return { active: false, error: readError.message };

  if (existing) {
    const { error } = await supabase
      .from("message_reactions")
      .delete()
      .eq("id", (existing as { id: string }).id);

    return error
      ? { active: true, error: error.message }
      : { active: false, error: null };
  }

  const { error } = await supabase.from("message_reactions").insert({
    target_type: targetType,
    target_id: targetId,
    user_id: me,
    emoji,
  });

  return error ? { active: false, error: error.message } : { active: true, error: null };
}

/**
 * Supprime un message privé.
 *
 * La RLS tranche : l'auteur peut supprimer le sien. On ne rejoue pas cette
 * règle côté client — ce serait une seconde vérité qui divergerait au
 * premier changement de politique. L'écran ne montre le bouton qu'à ceux
 * dont on sait qu'ils y ont droit ; la suppression, elle, reste une
 * décision de la base, et son refus se dit.
 */
export async function deleteMessage(
  messageId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("direct_messages")
    .delete()
    .eq("id", messageId);

  return { error: error?.message ?? null };
}

/** Les identifiants des messages épinglés par `me`. */export async function fetchPinnedMessageIds(
  targetType: MessageTarget,
  me: string,
): Promise<Set<string>> {
  if (!me) return new Set();

  const { data, error } = await supabase
    .from("message_pins")
    .select("target_id")
    .eq("target_type", targetType)
    .eq("user_id", me);

  if (error) return new Set();
  return new Set(
    ((data as Pick<MessagePin, "target_id">[]) ?? []).map((r) => String(r.target_id)),
  );
}

/**
 * Pose ou retire l'épingle de `me`.
 *
 * Même forme que la réaction : lecture puis écriture, parce que la table
 * n'interdit pas deux épingles identiques. Sémantique de bascule
 * attendue par le bouton — un bouton qui ne dépingle jamais serait le
 * défaut exact trouvé sur `toggleRepost` (section 21 du MEMO).
 */
export async function toggleMessagePin(
  targetType: MessageTarget,
  targetId: string,
  me: string,
): Promise<{ pinned: boolean; error: string | null }> {
  if (!me) return { pinned: false, error: "Non connecté" };

  const { data: existing, error: readError } = await supabase
    .from("message_pins")
    .select("id")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("user_id", me)
    .maybeSingle();

  if (readError) return { pinned: false, error: readError.message };

  if (existing) {
    const { error } = await supabase
      .from("message_pins")
      .delete()
      .eq("id", (existing as { id: string }).id);

    return error
      ? { pinned: true, error: error.message }
      : { pinned: false, error: null };
  }

  const { error } = await supabase.from("message_pins").insert({
    target_type: targetType,
    target_id: targetId,
    user_id: me,
  });

  return error ? { pinned: false, error: error.message } : { pinned: true, error: null };
}
