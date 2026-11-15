import { api } from "@/lib/api/client";

/**
 * Accusés de lecture et état de conversation.
 *
 * Ce module répond à une seule question, posed par l'interface à chaque
 * message affiché : **« ce message a-t-il été lu, et par qui ? »**
 *
 * ## Pourquoi `last_read_at` vit sur l'adhésion, pas sur le message
 *
 * Marquer chaque message comme lu (« voici 40 lignes à mettre à jour »)
 * paraît plus direct, mais c'est faux : la lecture n'est pas un
 * événement par message, c'est un **état** de la personne dans la
 * conversation. Quelqu'un qui ouvre une conversation de 200 messages a
 * lu les 200 d'un coup, et `last_read_at` le dit en une ligne.
 *
 * C'est aussi la seule forme qui survit au temps réel : le message
 * « lu » n'a pas besoin d'être poussé, il se **recalcule** à la
 * lecture, à partir d'un instant. Un message lu dans une autre session,
 * sur un autre appareil, s'affiche donc juste — ce qu'un drapeau posé
 * au clic ne garantit pas.
 *
 * ## Ce que le module ne fait pas
 *
 * Il ne gère pas la **livraison** (« le message est-il arrivé sur le
 * réseau du destinataire »). WhatsApp l'affiche, et c'est honnête de
 * l'imiter — mais une vraie preuve de livraison est un accusé du
 * serveur destinataire, que Supabase ne renvoie pas. Inventer un
 * `delivered_at` que le client poserait lui-même serait un mensonge* affiché comme une donnée : le `✓✓` signifierait alors « l'écran a
  * décidé que c'était parti ». On garde donc deux états honnêtes —
  * envoyé, lu — et le second l'est vraiment.
 */

/** L'état d'un message qu'on a écrit. */
export type ReceiptState = "envoye" | "lu";

/**
 * Un message et ce qu'on sait de sa lecture.
 *
 * `readAt` est l'instant jusqu'auquel le lecteur a tout lu : le message
 * est lu si sa date est **antérieure ou égale** à cet instant. Le
 * `≤` n'est pas un détail : lire et envoyer dans la même seconde est un
 * cas réel, pas un cas limite de laboratoire.
 */
export interface MessageReceipt {
  /** L'instant de lecture du destinataire, s'il a lu. */
  readAt: string | null;
  /** Lu, ou seulement parti. */
  state: ReceiptState;
}

/**
 * L'état de lecture de `sentAt` d'après les `last_read_at` reçus.
 *
 * On prend le `last_read_at` du destinataire — celui de l'expéditeur ne
 * prouve rien sur son propre message. La comparaison est faite une
 * seule fois, ici, pour que le même calcul ne soit pas réécrit dans
 * chaque écran.
 */
export function receiptFor(
  sentAt: string,
  readMarks: Record<string, string | null>,
  me: string,
): MessageReceipt {
  const peer = Object.entries(readMarks).find(([userId]) => userId !== me);
  const readAt = peer?.[1] ?? null;

  if (!readAt) return { readAt: null, state: "envoye" };

  const readTime = Date.parse(readAt);
  const sentTime = Date.parse(sentAt);

  // Une horloge incohérente ne doit pas faire afficher « lu » sur un
  // message postérieur : on ne « lu » que ce qui existait déjà.
  if (!Number.isFinite(readTime) || !Number.isFinite(sentTime) || sentTime > readTime) {
    return { readAt: null, state: "envoye" };
  }

  return { readAt, state: "lu" };
}

/**
 * « Lu par 2 sur 5 », pour un groupe ou un canal.
 *
 * Le groupe n'affiche pas un `✓✓` : il affiche une **fraction**, parce
 * que c'est la seule information honnête — un `✓✓` dans un canal de
 * vingt personnes signifierait « lu par quelqu'un », ce que personne ne
 * croit en voyant un double tick.
 *
 * On compte les membres dont `last_read_at` est postérieur au message.
 * Les membres qui n'ont jamais ouvert le canal ne sont pas comptés comme
 * l'ayant lu : le nombre est donc « au moins n », pas « exactement n ».
 */
export function readBy(
  sentAt: string,
  marks: { userId: string; readAt: string | null }[],
  me: string,
): { count: number; total: number } {
  const sentTime = Date.parse(sentAt);
  const others = marks.filter((m) => m.userId !== me);

  const count = others.filter((m) => {
    if (!m.readAt) return false;
    const t = Date.parse(m.readAt);
    return Number.isFinite(t) && t >= sentTime;
  }).length;

  return { count, total: others.length };
}

/**
 * Les instants de lecture d'une conversation, indexés par personne.
 *
 * Une seule requête par ouverture de conversation. Le `null` d'un membre
 * est conservé : il distingue « pas encore lu » de « ne fait pas partie
 * de la conversation », deux informations qu'une ligne absente
 * confondrait.
 */
export async function fetchConversationReadMarks(
  conversationId: string,
): Promise<Record<string, string | null>> {
  if (!conversationId) return {};

  const { data, error } = await api
    .from("conversation_members")
    .select("user_id, last_read_at")
    .eq("conversation_id", conversationId);

  if (error) return {};

  const out: Record<string, string | null> = {};
  for (const row of (data as { user_id: string; last_read_at: string | null }[]) ?? []) {
    out[row.user_id] = row.last_read_at ?? null;
  }
  return out;
}

/** Les instants de lecture d'un canal, pour le « lu par n sur m ». */
export async function fetchChannelReadMarks(
  channelId: string,
): Promise<{ userId: string; readAt: string | null }[]> {
  if (!channelId) return [];

  const { data, error } = await api
    .from("channel_members")
    .select("user_id, last_read_at")
    .eq("channel_id", channelId);

  if (error) return [];

  return ((data as { user_id: string; last_read_at: string | null }[]) ?? []).map(
    (r) => ({ userId: r.user_id, readAt: r.last_read_at ?? null }),
  );
}

/**
 * Marque une conversation comme lue jusqu'à maintenant.
 *
 * `last_read_at` est une donnée que **le lecteur** produit, et non que
 * la base déduit : la RLS l'autorise donc sur sa propre ligne
 * (`auth.uid() = user_id`), et rien d'autre sur cette ligne.
 *
 * On ne recule jamais : un `last_read_at` dans le passé signifierait
 * qu'un message est « non lu » alors qu'on vient de le lire, ce qui se
 * voit immédiatement et se corrige mal.
 */
export async function markConversationRead(
  conversationId: string,
  me: string,
  at: string = new Date().toISOString(),
): Promise<{ error: string | null }> {
  if (!conversationId || !me) return { error: null };

  const { error } = await api
    .from("conversation_members")
    .update({ last_read_at: at })
    .eq("conversation_id", conversationId)
    .eq("user_id", me);

  return { error: error?.message ?? null };
}

/** Même chose pour un canal : c'est l'appartenance qui porte la ligne. */
export async function markChannelRead(
  channelId: string,
  me: string,
  at: string = new Date().toISOString(),
): Promise<{ error: string | null }> {
  if (!channelId || !me) return { error: null };

  const { error } = await api
    .from("channel_members")
    .update({ last_read_at: at })
    .eq("channel_id", channelId)
    .eq("user_id", me);

  return { error: error?.message ?? null };
}

/**
 * Les members d'un canal avec leur état de lecture.
 *
 * Sert au « lu par n sur m » : sans le nombre de membres, on ne peut pas
 * afficher de fraction.
 */
export async function fetchChannelReaders(channelId: string): Promise<string[]> {
  if (!channelId) return [];

  const { data, error } = await api
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId);

  if (error) return [];
  return ((data as { user_id: string }[]) ?? []).map((r) => r.user_id);
}