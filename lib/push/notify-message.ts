/**
 * Prévenir les appareils d'un message direct qui vient d'être écrit.
 *
 * Appelé par la passerelle REST **après** l'insertion réussie d'un
 * message, jamais avant : pousser puis échouer à écrire annoncerait un
 * message qui n'existe pas.
 *
 * Les destinataires sont les autres participants de la conversation.
 * Ils sont lus par la connexion serveur, pas au nom de l'expéditeur :
 * celui-ci n'a pas le droit de lire la liste des appareils d'autrui (et
 * ne doit pas l'avoir).
 *
 * Aucune erreur ne remonte : un push manqué ne doit pas faire échouer
 * l'envoi du message. La bannière et le badge restent alors pour la
 * prochaine ouverture — le contraire, rendre l'écriture dépendante d'un
 * service de notification, serait pire.
 */
import { getPostgresPool, hasDatabaseUrl } from "@/platform/infrastructure/postgres/pool";
import { sendPushToUsers } from "./web-push";

const BODY_MAX = 120;

type InsertedMessage = {
  conversation_id?: unknown;
  text?: unknown;
  author_id?: unknown;
};

export async function dispatchDirectMessagePush(
  authorId: string,
  rows: Record<string, unknown>[] | null,
): Promise<void> {
  /**
   * Deux secondes et demie, pas plus.
   *
   * L'envoi du message attend ce travail : un service de push lent ne
   * doit pas retarder la confirmation à l'auteur. Au-delà, on abandonne
   * la bannière — le message est écrit, c'est ce qui compte.
   */
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_500));
  await Promise.race([push(authorId, rows), timeout]);
}

async function push(
  authorId: string,
  rows: Record<string, unknown>[] | null,
): Promise<void> {
  if (!rows || rows.length === 0 || !hasDatabaseUrl()) return;

  // Un envoi groupé (plusieurs lignes) ne mérite qu'une bannière : le
  // téléphone n'a pas à vibrer trois fois pour un seul geste.
  const message = rows[rows.length - 1] as InsertedMessage;
  const conversationId =
    typeof message.conversation_id === "string" ? message.conversation_id : "";
  const text = typeof message.text === "string" ? message.text.trim() : "";
  if (!conversationId) return;

  const pool = getPostgresPool();
  try {
    const conversation = await pool.query<{ participants: string[] }>(
      `select participants from public.conversations where id = $1`,
      [conversationId],
    );
    const recipients = (conversation.rows[0]?.participants ?? []).filter(
      (id) => id && id !== authorId,
    );
    if (recipients.length === 0) return;

    const author = await pool.query<{ prenom: string; pseudo: string }>(
      `select prenom, pseudo from public.users where id = $1`,
      [authorId],
    );
    const name = author.rows[0]?.prenom || author.rows[0]?.pseudo || "Nouveau message";

    await sendPushToUsers(recipients, {
      title: name,
      body: text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1)}…` : text,
      url: "/messages",
      tag: `dm-${conversationId}`,
    });
  } catch (error) {
    console.error(
      "[push] message non poussé",
      error instanceof Error ? error.message : String(error),
    );
  }
}
