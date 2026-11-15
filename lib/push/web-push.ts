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
 * ## Pourquoi `@block65/webcrypto-web-push` et pas `web-push`
 *
 * `web-push@4` est publié sous **MPL-2.0**, hors de la liste de licences
 * autorisées par la CADEV 2026 (article 6). `@block65/webcrypto-web-push`
 * implémente les mêmes RFC (8291 pour le chiffrement `aes128gcm`, 8292 pour
 * VAPID) avec WebCrypto, sous licence MIT, et **accepte exactement les mêmes
 * clés** : la clé publique VAPID en point P-256 non compressé encodé
 * base64url (65 octets), la clé privée en scalaire `d` base64url. Aucune
 * migration de clé, donc aucun réabonnement des appareils.
 *
 * Le message est complété à 4 096 octets par la bibliothèque : la longueur du
 * chiffré ne révèle plus celle du texte, et le corps tient dans ce qu'un
 * service de push doit accepter.
 *
 * Ce module n'est importé que par des routes serveur : la bibliothèque de
 * push et le pool PostgreSQL n'ont rien à faire dans un bundle client.
 */
import { buildPushPayload } from "@block65/webcrypto-web-push";
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
const subject = () => process.env.VAPID_SUBJECT?.trim() ?? "";

/**
 * Le sujet VAPID est une adresse de contact : les services de push s'en
 * servent pour prévenir en cas d'envois abusifs. `mailto:` ou `https:` sont
 * acceptés, une adresse nue est refusée — la RFC 8292 ne connaît que ces deux
 * schémas.
 */
function validSubject(value: string): boolean {
  return /^(mailto:|https:\/\/)\S+$/i.test(value);
}

/** Les trois valeurs VAPID sont-elles là et exploitables ? */
export function pushConfigured(): boolean {
  return Boolean(publicKey() && privateKey() && validSubject(subject()));
}

export function vapidPublicKey(): string | null {
  return pushConfigured() ? publicKey() : null;
}

export type PushTransport = {
  send: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    body: string,
    options: { TTL: number; urgency: "high" | "normal" | "low" },
  ) => Promise<{ statusCode: number }>;
};

/**
 * Point de passage unique vers le réseau.
 *
 * Le test intégré remplace `send` pour observer ce qui partirait, sans
 * contacter un service de push. L'objet est exporté pour cela : les modules
 * de dispatch ne connaissent que `sendPushToUsers`.
 *
 * Un refus du service de push devient une erreur portant `statusCode` : c'est
 * ce que lit `sendPushToUsers` pour distinguer un abonnement expiré (404,
 * 410) d'une panne passagère (429, 5xx). Le contrat est celui de `web-push`,
 * donc les appelants n'ont pas changé.
 */
export const pushTransport: PushTransport = {
  async send(subscription, body, options) {
    const payload = await buildPushPayload(
      { data: body, options: { ttl: options.TTL, urgency: options.urgency } },
      {
        endpoint: subscription.endpoint,
        expirationTime: null,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      },
      { subject: subject(), publicKey: publicKey(), privateKey: privateKey() },
    );

    // `content-length` est posé par `fetch` d'après le corps réel : le
    // recopier à la main risquerait une incohérence si la bibliothèque
    // changeait son enveloppe.
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(payload.headers)) {
      if (name === "content-length") continue;
      headers[name] = value;
    }

    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers,
      body: payload.body,
      // Un service de push qui ne répond pas ne doit pas immobiliser la
      // fonction serverless : au-delà de dix secondes, l'envoi est perdu et
      // l'appareil retrouvera l'état réel à la prochaine ouverture.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw Object.assign(new Error(`push service ${response.status}`), {
        statusCode: response.status,
      });
    }
    return { statusCode: response.status };
  },
};

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
  if (userIds.length === 0 || !hasDatabaseUrl() || !pushConfigured()) {
    if (userIds.length > 0 && !pushConfigured()) {
      console.warn("[push] VAPID incomplet : envoi ignoré");
    }
    return;
  }

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

  // Une journée de validité, pas une minute.
  //
  // Un iPhone verrouillé en mauvaise couverture est hors ligne : le
  // service de push garde le message jusqu'à ce qu'il revienne. Avec
  // une TTL courte, il le jetait avant — d'où des messages jamais
  // annoncés alors qu'ils étaient bien écrits. Une bannière ancienne
  // reste utile : elle ouvre la conversation, et l'écran montre l'état
  // réel des messages lus.
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
        await pushTransport.send(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 86_400, urgency: "high" },
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
