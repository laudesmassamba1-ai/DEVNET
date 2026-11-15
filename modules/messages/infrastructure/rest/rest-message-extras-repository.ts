import { api } from "@/lib/api/client";
import type { MessagePin, MessageReaction, MessageTarget } from "@/lib/types";
import type {
  MessageExtrasRepository,
  PinInput,
  ReactionInput,
  ReactionRow,
} from "../../ports/message-extras-repository";

/**
 * Adaptateur Supabase du domaine messages.
 *
 * Il porte la forme des requêtes et la traduction des erreurs en chaînes. Il
 * ne décide ni de l'ordre d'affichage, ni de l'existence préalable d'une
 * réaction : ces décisions appartiennent au service.
 *
 * En mode démonstration, le client maison branche `lib/demo/` derrière la
 * même interface — l'adaptateur ne le sait pas et n'a pas à le savoir.
 */
export class RestMessageExtrasRepository implements MessageExtrasRepository {
  async listReactions(
    targetType: MessageTarget,
    targetIds: string[],
  ): Promise<ReactionRow[]> {
    if (targetIds.length === 0) return [];

    // Une seule lecture pour tous les messages affichés : une requête par
    // bulle rendrait l'ouverture proportionnelle à l'historique.
    const { data } = await api
      .from("message_reactions")
      .select("target_id, emoji, user_id")
      .eq("target_type", targetType)
      .in("target_id", targetIds);

    return ((data ?? []) as Pick<
      MessageReaction,
      "target_id" | "emoji" | "user_id"
    >[]).map((row) => ({
      target_id: String(row.target_id),
      emoji: row.emoji,
      user_id: row.user_id,
    }));
  }

  async findReaction(
    targetType: MessageTarget,
    targetId: string,
    userId: string,
    emoji: string,
  ): Promise<{ row: { id: string } | null; error: string | null }> {
    const { data, error } = await api
      .from("message_reactions")
      .select("id")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .eq("user_id", userId)
      .eq("emoji", emoji)
      .maybeSingle();

    if (error) return { row: null, error: error.message };
    return { row: (data as { id: string } | null) ?? null, error: null };
  }

  async addReaction({ targetType, targetId, userId, emoji }: ReactionInput): Promise<{
    error: string | null;
  }> {
    const { error } = await api.from("message_reactions").insert({
      target_type: targetType,
      target_id: targetId,
      user_id: userId,
      emoji,
    });

    return { error: error ? error.message : null };
  }

  async deleteReaction(id: string): Promise<{ error: string | null }> {
    const { error } = await api
      .from("message_reactions")
      .delete()
      .eq("id", id);

    return { error: error ? error.message : null };
  }

  async deleteMessage(messageId: string): Promise<{ error: string | null }> {
    const { error } = await api
      .from("direct_messages")
      .delete()
      .eq("id", messageId);

    return { error: error ? error.message : null };
  }

  async listPinnedIds(
    targetType: MessageTarget,
    userId: string,
  ): Promise<string[]> {
    const { data, error } = await api
      .from("message_pins")
      .select("target_id")
      .eq("target_type", targetType)
      .eq("user_id", userId);

    // Une lecture refusée n'est pas une liste vide d'épingles : elle est
    // silencieuse ici parce que l'épingle est un confort de lecture, et que
    // l'écran n'a rien à dire d'une épingle qu'on ne voit pas.
    if (error) return [];
    return ((data ?? []) as Pick<MessagePin, "target_id">[]).map((row) =>
      String(row.target_id),
    );
  }

  async findPin(
    targetType: MessageTarget,
    targetId: string,
    userId: string,
  ): Promise<{ row: { id: string } | null; error: string | null }> {
    const { data, error } = await api
      .from("message_pins")
      .select("id")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return { row: null, error: error.message };
    return { row: (data as { id: string } | null) ?? null, error: null };
  }

  async addPin({ targetType, targetId, userId }: PinInput): Promise<{
    error: string | null;
  }> {
    const { error } = await api.from("message_pins").insert({
      target_type: targetType,
      target_id: targetId,
      user_id: userId,
    });

    return { error: error ? error.message : null };
  }

  async deletePin(id: string): Promise<{ error: string | null }> {
    const { error } = await api.from("message_pins").delete().eq("id", id);
    return { error: error ? error.message : null };
  }
}
