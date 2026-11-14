import type { Conversation, UserLite } from "@/lib/types";

export type Peer = {
  conv: Conversation;
  other: (UserLite & { xp?: number }) | null;
};

/** Clé de conversation stable entre deux participants, triée. */
export function convKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * Filtre d'affichage de la liste : prénom, pseudo et dernier message.
 * `null` (chargement) reste `null`.
 */
export function filterConversations(
  convs: Peer[] | null,
  search: string,
): Peer[] | null {
  if (convs === null) return null;
  const needle = search.trim().toLowerCase();
  if (!needle) return convs;
  return convs.filter(
    (p) =>
      (p.other?.prenom ?? "").toLowerCase().includes(needle) ||
      (p.other?.pseudo ?? "").toLowerCase().includes(needle) ||
      (p.conv.last_message ?? "").toLowerCase().includes(needle),
  );
}

/** Filtre les messages d'une conversation par texte recherché. */
export function filterMessagesByText<T extends { text: string }>(
  messages: T[] | null,
  search: string,
): T[] | null {
  if (messages === null) return null;
  const needle = search.trim().toLowerCase();
  if (!needle) return messages;
  return messages.filter((m) => m.text.toLowerCase().includes(needle));
}
