import type { MessageTarget } from "@/lib/types";
import {
  MESSAGE_EMOJIS,
  type MessageExtrasRepository,
  type ReactionsByMessage,
} from "../ports/message-extras-repository";

/**
 * Cas d'usage des messages : réagir, épingler, supprimer.
 *
 * Ce que le service décide — et que l'adaptateur ne décide pas :
 *
 * - **l'agrégation et l'ordre des pastilles.** Une réaction est une ligne ;
 *   l'écran lit un compteur par icône, rangé selon le jeu déclaré. Cet ordre
 *   ne dépend pas du fournisseur.
 * - **la bascule en deux temps.** La base autorise plusieurs réactions et
 *   plusieurs épingles identiques : elle ne peut donc pas signaler le
 *   doublon par une erreur. On lit, puis on écrit — une requête de plus qui
 *   achète la certitude de ne pas empiler deux fois la même icône.
 * - **le refus d'écrire sans lecteur.** Sans identifiant, l'écriture serait
 *   refusée par la RLS ; le dire ici évite un aller-retour inutile.
 *
 * Ce que le service ne décide **pas** : qui a le droit. La RLS tranche, et
 * une règle ici serait une seconde vérité qui divergerait au premier
 * changement de politique.
 */
export function createMessageExtrasService(
  getRepository: () => MessageExtrasRepository,
) {
  return {
    async fetchReactions(
      targetType: MessageTarget,
      targetIds: string[],
      me: string | null,
    ): Promise<ReactionsByMessage> {
      // Aucun identifiant : aucune requête. Une conversation vide ne doit
      // pas coûter un aller-retour réseau.
      if (targetIds.length === 0) return {};

      const rows = await getRepository().listReactions(targetType, targetIds);
      const acc: Record<string, Map<string, { count: number; mine: boolean }>> = {};

      for (const row of rows) {
        const id = String(row.target_id);
        const byEmoji = (acc[id] ??= new Map());
        const entry = byEmoji.get(row.emoji) ?? { count: 0, mine: false };
        entry.count += 1;
        if (me && row.user_id === me) entry.mine = true;
        byEmoji.set(row.emoji, entry);
      }

      const out: ReactionsByMessage = {};
      for (const [id, byEmoji] of Object.entries(acc)) {
        out[id] = [...byEmoji.entries()]
          // Ordre déclaré, pas ordre d'arrivée. Les icônes inconnues
          // (données anciennes) passent à la fin, à ordre alphabétique.
          .sort(
            (a, b) =>
              emojiRank(a[0]) - emojiRank(b[0]) || a[0].localeCompare(b[0]),
          )
          .map(([emoji, value]) => ({
            emoji,
            count: value.count,
            mine: value.mine,
          }));
      }

      return out;
    },

    async toggleReaction(
      targetType: MessageTarget,
      targetId: string,
      me: string,
      emoji: string,
    ): Promise<{ active: boolean; error: string | null }> {
      if (!me) return { active: false, error: "Non connecté" };

      const repository = getRepository();
      const existing = await repository.findReaction(
        targetType,
        targetId,
        me,
        emoji,
      );

      if (existing.error) return { active: false, error: existing.error };

      if (existing.row) {
        const { error } = await repository.deleteReaction(existing.row.id);
        return error
          ? { active: true, error }
          : { active: false, error: null };
      }

      const { error } = await repository.addReaction({
        targetType,
        targetId,
        userId: me,
        emoji,
      });
      return error ? { active: false, error } : { active: true, error: null };
    },

    async deleteMessage(messageId: string): Promise<{ error: string | null }> {
      return getRepository().deleteMessage(messageId);
    },

    async fetchPinnedIds(
      targetType: MessageTarget,
      me: string,
    ): Promise<Set<string>> {
      if (!me) return new Set();
      const ids = await getRepository().listPinnedIds(targetType, me);
      return new Set(ids);
    },

    async togglePin(
      targetType: MessageTarget,
      targetId: string,
      me: string,
    ): Promise<{ pinned: boolean; error: string | null }> {
      if (!me) return { pinned: false, error: "Non connecté" };

      const repository = getRepository();
      const existing = await repository.findPin(targetType, targetId, me);

      if (existing.error) return { pinned: false, error: existing.error };

      if (existing.row) {
        const { error } = await repository.deletePin(existing.row.id);
        return error ? { pinned: true, error } : { pinned: false, error: null };
      }

      const { error } = await repository.addPin({
        targetType,
        targetId,
        userId: me,
      });
      return error ? { pinned: false, error } : { pinned: true, error: null };
    },
  };
}

function emojiRank(emoji: string): number {
  const index = (MESSAGE_EMOJIS as readonly string[]).indexOf(emoji);
  return index < 0 ? MESSAGE_EMOJIS.length : index;
}
