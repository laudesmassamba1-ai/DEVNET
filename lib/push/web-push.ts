/**
 * Envoi Web Push — serveur uniquement.
 *
 * Trois faits décident de la forme de ce fichier :
 *
 * 1. **Le contenu est chiffré pour l'appareil**, pas pour nous. Les clés
 *    `p256dh` et `auth` enregistrées à l'abonnement sont les seules à
 *    pouvoir ouvrir le message (RFC 8291). Les perdre, c'est devoir
 *    réabonner ; les exposer, c'est laisser lire les notifications.
 * 2. **Un abonnement mort n'est pas une erreur applicative.** Un
 *    navigateur désinstallé répond 404 ou 410 : la ligne est retirée et
 *    l'envoi continue pour les autres appareils. Traiter cela comme une
 *    panne ferait échouer la route d'envoi pour un fantôme.
 * 3. **Sans clés VAPID, rien ne part.** L'application le dit
 *    (`pushConfigured`) au lieu d'échouer silencieusement, comme pour
 *    les GIF et les emails.
 *
 * Ce module n'est importé que par des routes serveur : `web-push` et le
 * pool PostgreSQL n'ont rien à faire dans un bundle client.
 */
import * as webpush from "web-push";
import { getPostgresPool, hasDatabaseUrl } from "@/platform/infrastructure/postgres/pool";

export type PushPayload = {
  title: string;
  body: string;
  /** Adresse ouverte au clic — toujours une route interne. */
  url?: string;
  /** Remplace une notification du même sujet au lieu de l'empiler. */
  tag?: string;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

const publicKey = () => process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
const privateKey = () => process.env.VAPID_PRIVATE_KEY?.trim() ?? "";

/** Les trois valeurs VAPID sont-elles là ? */
export function pushConfigured(): boolean {
  return Boolean(publicKey() && privateKey() && process.env.VAPID_SUBJECT?.trim());
}

export function vapidPublicKey(): string | null {
  return pushConfigured() ? publicKey() : null;
}

let ready = false;

function configure(): boolean {
  if (!pushConfigured()) return false;
  if (!ready) {
    // `VAPID_SUBJECT` est une adresse de contact : les services de push
    // s'en servent pour prévenir en cas d'envois abusifs. `mailto:` ou
    // `https:` sont acceptés, une adresse nue est refusée.
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!.trim(),
      publicKey(),
      privateKey(),
    );
    ready = true;
  }
  return true;
}

/**
 * Pousse un message à tous les appareils des destinataires.
 *
 * Ne lève jamais : une notification manquée ne doit pas faire échouer
 * l'écriture du message qui l'a déclenchée. Les abonnements expirés sont
 * supprimés au passage.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0 || !hasDatabaseUrl() || !configure()) return;

  let rows: SubscriptionRow[];
  try {
    const result = await getPostgresPool().query<SubscriptionRow>(
      `select id, endpoint, p256dh, auth
         from public.push_subscriptions
        where user_id = any($1::uuid[])`,
      [userIds],
    );
    rows = result.rows;
  } catch (error) {
    console.error(
      "[push] lecture des abonnements impossible",
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  if (rows.length === 0) return;

  // Une minute de validité : au-delà, un message est périmé et le
  // téléphone le recevrait au milieu d'une autre conversation.
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/messages",
    tag: payload.tag,
  });

  const expired: string[] = [];
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60, urgency: "high" },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          expired.push(row.id);
          return;
        }
        console.warn(
          "[push] envoi refusé",
          status ?? (error instanceof Error ? error.message : String(error)),
        );
      }
    }),
  );

  if (expired.length > 0) {
    await getPostgresPool()
      .query(`delete from public.push_subscriptions where id = any($1::uuid[])`, [expired])
      .catch(() => undefined);
  }
}
