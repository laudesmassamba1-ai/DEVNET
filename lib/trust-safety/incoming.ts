/**
 * Filtres d'entrée choisis par le destinataire.
 *
 * Ils ne remplacent pas la modération : ils expriment une préférence
 * personnelle. Un compte qui refuse les messages de personnes qu'il ne
 * suit pas ne subit aucune sanction, et l'expéditeur reçoit un refus
 * générique qui ne révèle pas la préférence exacte.
 *
 * Le filtre ne s'applique qu'aux **nouveaux** messages et commentaires.
 * Réécrire l'historique serait une censure rétroactive.
 */
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { evaluateText } from "@/lib/moderation/service";

type Audience = "everyone" | "followers" | "nobody";

type Settings = {
  user_id: string;
  who_can_message: Audience;
  who_can_comment: Audience;
  who_can_mention: Audience;
  filter_offensive: boolean;
  blocked_words: string[];
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function settingsFor(userId: string): Promise<Settings> {
  const fallback: Settings = {
    user_id: userId,
    who_can_message: "everyone",
    who_can_comment: "everyone",
    who_can_mention: "everyone",
    filter_offensive: true,
    blocked_words: [],
  };
  try {
    const result = await getPostgresPool().query<Settings>(
      `select user_id, who_can_message, who_can_comment, who_can_mention,
              filter_offensive, blocked_words
         from public.user_safety_settings
        where user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? fallback;
  } catch {
    return fallback;
  }
}

async function follows(followerId: string, followeeId: string): Promise<boolean> {
  try {
    const result = await getPostgresPool().query(
      "select 1 from public.follows where follower_id = $1 and followee_id = $2 limit 1",
      [followerId, followeeId],
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

async function audienceAllows(
  audience: Audience,
  senderId: string,
  recipientId: string,
): Promise<boolean> {
  if (audience === "everyone") return true;
  if (audience === "nobody") return false;
  return follows(recipientId, senderId);
}

async function contentAllows(settings: Settings, text: string): Promise<boolean> {
  const normalized = normalize(text);
  if (settings.blocked_words.some((word) => {
    const needle = normalize(word).trim();
    return needle.length > 1 && normalized.includes(needle);
  })) {
    return false;
  }

  if (!settings.filter_offensive) return true;
  try {
    const result = await evaluateText(text);
    // `flag` et `block` sont tous deux offensants pour un destinataire qui
    // a demandé le filtre. La différence de gravité regarde la modération,
    // pas la boîte de réception.
    return result.verdict === "allow";
  } catch {
    return true;
  }
}

export type IncomingDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

async function checkRecipient(
  recipientId: string,
  senderId: string,
  text: string,
  kind: "message" | "comment",
): Promise<IncomingDecision> {
  const blocked = await getPostgresPool().query(
    `select 1 from public.user_blocks
      where (blocker_id = $1 and blocked_id = $2)
         or (blocker_id = $2 and blocked_id = $1)
      limit 1`,
    [recipientId, senderId],
  ).catch(() => null);
  if (blocked && blocked.rows.length > 0) {
    return { allowed: false, reason: "une des personnes a bloqué cette interaction" };
  }

  const settings = await settingsFor(recipientId);
  const chosen = kind === "message" ? settings.who_can_message : settings.who_can_comment;
  if (!(await audienceAllows(chosen, senderId, recipientId))) {
    return { allowed: false, reason: "ce compte n'accepte pas ce type de message" };
  }
  if (!(await contentAllows(settings, text))) {
    return { allowed: false, reason: "ce compte filtre ce type de contenu" };
  }
  return { allowed: true };
}

/** Vérifie un message privé avant son écriture. */
export async function checkDirectMessage(input: {
  senderId: string;
  conversationId: string;
  text: string;
}): Promise<IncomingDecision> {
  const recipients = await getPostgresPool().query<{ user_id: string }>(
    `select user_id from public.conversation_members
      where conversation_id = $1 and user_id <> $2`,
    [input.conversationId, input.senderId],
  );
  for (const recipient of recipients.rows) {
    const decision = await checkRecipient(
      recipient.user_id,
      input.senderId,
      input.text,
      "message",
    );
    if (!decision.allowed) return decision;
  }
  return { allowed: true };
}

/** Vérifie un commentaire avant son écriture. */
export async function checkComment(input: {
  senderId: string;
  postId: string;
  text: string;
}): Promise<IncomingDecision> {
  const author = await getPostgresPool().query<{ author_id: string | null }>(
    "select author_id from public.posts where id = $1::uuid limit 1",
    [input.postId],
  );
  const authorId = author.rows[0]?.author_id;
  if (!authorId || authorId === input.senderId) return { allowed: true };
  return checkRecipient(authorId, input.senderId, input.text, "comment");
}

/**
 * Mentions : le compte cité peut refuser d'être mentionné.
 *
 * Le contrôle se fait sur le pseudo, jamais sur un identifiant fourni par
 * le client. Un pseudo inconnu est simplement ignoré : ce n'est pas une
 * erreur de publication.
 */
export async function checkMentions(input: {
  senderId: string;
  text: string;
}): Promise<IncomingDecision> {
  const handles = [...input.text.matchAll(/@([a-zA-Z0-9_]{3,30})/g)]
    .map((match) => match[1].toLowerCase());
  const unique = [...new Set(handles)].slice(0, 20);
  if (unique.length === 0) return { allowed: true };

  const mentioned = await getPostgresPool().query<{ id: string }>(
    `select id from public.users
      where lower(pseudo) = any($1::text[])
      limit 20`,
    [unique],
  );
  for (const user of mentioned.rows) {
    if (user.id === input.senderId) continue;
    const settings = await settingsFor(user.id);
    if (!(await audienceAllows(settings.who_can_mention, input.senderId, user.id))) {
      return { allowed: false, reason: "ce compte n'accepte pas les mentions" };
    }
  }
  return { allowed: true };
}
