/**
 * L'**alerte des défis du jour** — la seule entrée du centre de
 * notifications qui n'a pas de ligne en base.
 *
 * Tout le reste du centre lit la table `notifications`, remplie par les
 * quatre déclencheurs de la migration 010. Cette alerte-ci ne le peut pas,
 * et ce n'est pas un raccourci : les défis du jour ne sont adressés par
 * personne. Ils sont **dérivés de la date** (`lib/challenges.ts`), et
 * identiques pour tout le monde — un « destinataire » et un « auteur »
 * n'auraient aucun sens, et la contrainte `notifications_shape` refuserait
 * la ligne (ni publication, ni conversation).
 *
 * On la calcule donc, et on garde son état « lu » **dans le navigateur**,
 * à côté de l'objectif de la semaine (`devnet:weekly-goal`) : c'est un
 * état de lecture personnel, pas une donnée communautaire, et aucun écran
 * n'a besoin de le partager.
 *
 * ## Pourquoi on stocke le jour, et pas un booléen
 *
 * La valeur enregistrée est **le jour acquitté**, pas `true`. Le
 * lendemain, la valeur d'hier ne vaut plus rien, donc l'alerte reparaît
 * seule — sans minuterie de remise à zéro, sans écran qui se souvienne
 * qu'il doit la remettre. Un booléen aurait demandé de le nettoyer à
 * minuit, et personne ne l'aurait fait.
 *
 * ## Pourquoi un module à part, et pas `lib/notify.ts`
 *
 * `lib/notify.ts` est **pur** — ni base, ni réseau, ni stockage — parce
 * que le moteur de démonstration s'en sert pour fabriquer exactement les
 * mêmes lignes que la base. Y lire `localStorage` casserait cette
 * propriété. Ici, l'état local est le sujet même du fichier.
 */

import type { DisplayNotification, NotificationGroup } from "./notify";
import { todayKey } from "./gamification";

/** Préfixe de la clé de stockage ; l'identifiant du compte la complète. */
const STORE_PREFIX = "devnet:challenge-alert";

/**
 * Une clé **par compte**.
 *
 * Deux personnes qui partagent un navigateur ont chacune leurs alertes :
 * sans l'identifiant, celle qui acquitte l'alerte la ferait disparaître
 * pour l'autre, et la cloche mentirait à l'une des deux.
 */
function storeKey(me: string): string {
  return `${STORE_PREFIX}:${me}`;
}

/** Le jour de l'alerte affichée — celui du calendrier du lecteur. */
export function challengeAlertDay(): string {
  return todayKey();
}

/**
 * L'alerte du jour a-t-elle déjà été acquittée ?
 *
 * En cas de stockage refusé (navigation privée, quota), on considère
 * l'alerte comme vue : une entrée non lue qu'on ne peut **pas** acquitter
 * resterait éternellement dans la cloche, et il vaut mieux la taire que
 * promettre un clic sans effet.
 */
export function isChallengeAlertSeen(me: string): boolean {
  if (!me) return true;
  try {
    return localStorage.getItem(storeKey(me)) === todayKey();
  } catch {
    return true;
  }
}

/**
 * Acquitte l'alerte du jour.
 *
 * C'est l'équivalent d'un `read_at` : on l'appelle quand la personne a vu
 * les défis — en ouvrant la ligne du centre, en la retirant, ou en
 * cliquant « Voir mes défis » sur la notification horaire.
 */
export function markChallengeAlertSeen(me: string): void {
  if (!me) return;
  try {
    localStorage.setItem(storeKey(me), todayKey());
  } catch {
    /* stockage refusé : l'alerte restera non lue, ce qui est visible */
  }
}

/** Le début du jour local, en ISO — l'horodatage de l'alerte. */
function startOfDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * L'alerte du jour, prête pour le centre — ou `null` si elle est vue.
 *
 * Elle est rendue **seulement tant qu'elle est non lue**, contrairement
 * aux notifications persistées qui restent affichées après lecture. La
 * différence est voulue : une notification raconte un fait qui a eu lieu
 * et qu'on peut vouloir relire ; l'alerte, elle, désigne les défis **du
 * jour**, qui changent à minuit. La garder après lecture donnerait une
 * ligne par jour passé dans la liste, toutes identiques et toutes
 * périmées.
 *
 * `actor` est nul : sans auteur, l'écran dessine l'icône du défi à la
 * place de l'avatar.
 */
export function challengeAlertGroup(me: string): NotificationGroup | null {
  if (!me || isChallengeAlertSeen(me)) return null;

  const day = todayKey();
  const latest: DisplayNotification = {
    id: `challenge-${day}`,
    recipient_id: me,
    actor_id: null,
    kind: "challenge",
    post_id: null,
    comment_id: null,
    conversation_id: null,
    created_at: startOfDay(),
    read_at: null,
    actor: null,
  };

  return {
    key: `challenge|${day}`,
    kind: "challenge",
    latest,
    members: [latest],
    count: 1,
    unread: 1,
  };
}
