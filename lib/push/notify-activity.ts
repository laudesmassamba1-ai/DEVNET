/**
 * Prévenir les appareils d'une activité sur une publication, un statut
 * ou un groupe.
 *
 * Trois gestes, une seule règle : la personne qui reçoit la bannière est
 * celle que le geste concerne, et jamais celle qui l'a fait. Un like sur
 * son propre post, une réponse à son propre commentaire, un message dans
 * son propre canal ne réveillent donc personne.
 *
 * Le déclenchement se fait après l'écriture réussie, jamais avant : une
 * bannière annonçant un like qui n'existe pas serait pire que pas de
 * bannière. Aucune erreur ne remonte non plus — un service de push lent
 * ou absent ne doit pas faire échouer le geste lui-même.
 */
import { getPostgresPool, hasDatabaseUrl } from "@/platform/infrastructure/postgres/pool";
import { sendPushToUsers } from "./web-push";

const BODY_MAX = 120;

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const uuid = (value: unknown): string => (typeof value === "string" ? value : "");

function excerpt(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > BODY_MAX ? `${clean.slice(0, BODY_MAX - 1)}…` : clean;
}

/** Le prénom sert de titre ; le pseudo prend le relais s'il manque. */
async function actorName(actorId: string): Promise<string> {
  const result = await getPostgresPool().query<{ prenom: string | null; pseudo: string | null }>(
    `select prenom, pseudo from public.users where id = $1`,
    [actorId],
  );
  const row = result.rows[0];
  return row?.prenom || row?.pseudo || "Quelqu'un";
}

/**
 * Envoie la bannière, avec la même borne de temps que les messages : le
 * geste (aimer, commenter, répondre) est déjà enregistré, il n'a pas à
 * attendre un service tiers.
 */
async function deliver(
  recipients: string[],
  payload: { title: string; body: string; url: string; tag: string },
): Promise<void> {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_500));
  await Promise.race([sendPushToUsers(recipients, payload), timeout]);
}

/** Cœur commun : résoudre le destinataire, son nom, puis pousser. */
async function pushOne(options: {
  actorId: string;
  recipientId: string;
  title: (name: string) => string;
  body: string;
  url: string;
  tag: string;
}): Promise<void> {
  if (!options.recipientId || options.recipientId === options.actorId) return;
  const name = await actorName(options.actorId);
  await deliver([options.recipientId], {
    title: options.title(name),
    body: excerpt(options.body),
    url: options.url,
    tag: options.tag,
  });
}

/**
 * `post_likes` — « X a aimé ta publication ».
 *
 * L'auteur du post est lu en base plutôt que reçu du client : la ligne
 * insérée ne le contient pas, et le croire sur parole permettrait
 * d'envoyer une bannière à n'importe qui.
 */
async function pushLike(actorId: string, row: Row): Promise<void> {
  const postId = uuid(row.post_id);
  if (!postId) return;

  const result = await getPostgresPool().query<{ author_id: string; text: string | null }>(
    `select author_id::text as author_id, text from public.posts where id = $1`,
    [postId],
  );
  const post = result.rows[0];
  if (!post) return;

  await pushOne({
    actorId,
    recipientId: post.author_id,
    title: (name) => name,
    body: "a aimé ta publication.",
    url: `/post/${postId}`,
    // Un même post ne remplace qu'une bannière de like : dix likes ne
    // doivent pas faire vibrer dix fois le même téléphone.
    tag: `like-${postId}`,
  });
}

/**
 * `comments` — un commentaire sur une publication, ou une réponse à un
 * commentaire.
 *
 * Répondre à un commentaire prévient son auteur, pas celui du post :
 * c'est la personne à qui l'on parle. Le reste du temps, c'est l'auteur
 * de la publication.
 */
async function pushComment(actorId: string, row: Row): Promise<void> {
  const postId = uuid(row.post_id);
  if (!postId) return;

  const parentId = uuid(row.parent_id);
  let recipientId = "";

  if (parentId) {
    const parent = await getPostgresPool().query<{ author_id: string | null }>(
      `select author_id::text as author_id from public.comments where id = $1`,
      [parentId],
    );
    recipientId = parent.rows[0]?.author_id ?? "";
  }

  if (!recipientId) {
    const post = await getPostgresPool().query<{ author_id: string }>(
      `select author_id::text as author_id from public.posts where id = $1`,
      [postId],
    );
    recipientId = post.rows[0]?.author_id ?? "";
  }
  if (!recipientId) return;

  const words = text(row.text);
  const hasGif = Boolean(text(row.gif_url));
  const hasSticker = Boolean(text(row.sticker_id));
  const body = words
    ? `« ${words} »`
    : hasGif
      ? "a envoyé un GIF en commentaire."
      : hasSticker
        ? "a répondu avec un sticker."
        : "a commenté ta publication.";

  await pushOne({
    actorId,
    recipientId,
    title: (name) => (parentId ? `${name} t'a répondu` : `${name} a commenté`),
    body,
    url: `/post/${postId}`,
    tag: `comment-${postId}`,
  });
}

/**
 * `group_messages` — un message dans un canal de groupe.
 *
 * Tous les membres du groupe reçoivent la bannière, sauf l'auteur. La
 * liste vient de `group_members`, pas du client : une personne absente du
 * groupe ne doit pas pouvoir être notifiée en forgeant une requête.
 */
async function pushGroupMessage(actorId: string, row: Row): Promise<void> {
  const groupId = uuid(row.group_id);
  if (!groupId) return;

  const pool = getPostgresPool();
  const [members, group, actor] = await Promise.all([
    pool.query<{ user_id: string }>(
      `select user_id::text as user_id from public.group_members where group_id = $1`,
      [groupId],
    ),
    pool.query<{ name: string }>(`select name from public.groups where id = $1`, [groupId]),
    pool.query<{ prenom: string | null; pseudo: string | null }>(
      `select prenom, pseudo from public.users where id = $1`,
      [actorId],
    ),
  ]);

  const recipients = members.rows.map((r) => r.user_id).filter((id) => id && id !== actorId);
  if (recipients.length === 0) return;

  const groupName = text(group.rows[0]?.name) || "Groupe";
  const name = actor.rows[0]?.prenom || actor.rows[0]?.pseudo || "Quelqu'un";
  const words = text(row.text);
  const hasGif = Boolean(text(row.gif_url));
  const hasSticker = Boolean(text(row.sticker_id));
  const hasMedia = Boolean(text(row.media_url));
  const detail = words
    ? words
    : hasGif
      ? "a envoyé un GIF."
      : hasSticker
        ? "a envoyé un sticker."
        : hasMedia
          ? "a envoyé un média."
          : "a envoyé un message.";

  const channelId = uuid(row.channel_id) || groupId;
  await deliver(recipients, {
    title: groupName,
    body: excerpt(`${name} : ${detail}`),
    url: `/groups/${groupId}`,
    tag: `group-${groupId}-${channelId}`,
  });
}

/**
 * Réponse à un statut.
 *
 * Le dépôt des statuts écrit la réponse *et* le message privé dans le
 * même geste, sans passer par la passerelle REST — d'où cette entrée
 * dédiée, appelée par la route. La bannière ouvre la conversation : la
 * réponse est un message, et c'est là qu'on peut y répondre à son tour.
 */
export async function dispatchStoryReplyPush(options: {
  actorId: string;
  conversationId: string;
  body: string;
}): Promise<void> {
  if (!hasDatabaseUrl() || !options.conversationId) return;
  try {
    const conversation = await getPostgresPool().query<{ participants: string[] }>(
      `select participants from public.conversations where id = $1`,
      [options.conversationId],
    );
    const recipients = (conversation.rows[0]?.participants ?? []).filter(
      (id) => id && id !== options.actorId,
    );
    if (recipients.length === 0) return;

    const name = await actorName(options.actorId);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_500));
    await Promise.race([
      sendPushToUsers(recipients, {
        title: name,
        body: excerpt(`a répondu à ton statut : ${options.body}`),
        url: `/messages?c=${encodeURIComponent(options.conversationId)}`,
        tag: `story-${options.conversationId}`,
      }),
      timeout,
    ]);
  } catch (error) {
    console.error(
      "[push] réponse au statut non poussée",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Point d'entrée de la passerelle REST : la table dit quel geste a eu
 * lieu. Les tables non concernées ne coûtent rien — pas de requête.
 */
export async function dispatchActivityPush(
  actorId: string,
  table: string,
  rows: Row[] | null,
  body: unknown,
): Promise<void> {
  if (!hasDatabaseUrl()) return;

  // Selon `Prefer: return=representation`, la ligne vient de la réponse
  // ou du corps envoyé. Le client des commentaires n'en demande pas —
  // sans ce repli, son push ne partirait jamais.
  const source = rows?.[0] ?? (Array.isArray(body) ? body[0] : body);
  if (!source || typeof source !== "object") return;
  const row = source as Row;

  try {
    if (table === "post_likes") await pushLike(actorId, row);
    else if (table === "comments") await pushComment(actorId, row);
    else if (table === "group_messages") await pushGroupMessage(actorId, row);
  } catch (error) {
    console.error(
      "[push] activité non poussée",
      error instanceof Error ? error.message : String(error),
    );
  }
}
