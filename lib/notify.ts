/**
 * Règles du centre de notifications — module **pur**.
 *
 * Ni base, ni réseau, ni localStorage. Le moteur de démonstration
 * s'en sert pour fabriquer exactement les mêmes lignes que les
 * déclencheurs de la migration 010, et l'écran pour plier la liste
 * avant de l'afficher. C'est la même séparation que `lib/tags.ts` :
 * une règle qui existe à un seul endroit ne peut pas diverger.
 */

import type {
  NotificationKind,
  NotificationWithActor,
} from "@/lib/types";

/**
 * Le vocabulaire **affiché** par le centre : les quatre types persistés,
 * plus le défi du jour.
 *
 * `NotificationKind` (dans `lib/types.ts`) est le vocabulaire de la
 * **base** : une contrainte `check` le fige à quatre valeurs, et
 * `notifications_shape` impose à chacune la cible qu'elle doit porter. Le
 * défi du jour n'a **pas de ligne** : il est dérivé de la date, le même
 * pour tout le monde, et il n'appartient à personne. Lui donner un `kind`
 * persisté demanderait une migration, une exception à
 * `notifications_shape` (ni publication, ni conversation) et un acteur —
 * pour un événement qui ne se stocke pas.
 *
 * Le centre affiche donc `NotificationKind | "challenge"`, et ce dernier
 * est le seul à n'avoir jamais de ligne en base. C'est un type **à part**,
 * pas une cinquième valeur du type de la base : la distinction dit la
 * vérité sur ce qui se stocke et ce qui se calcule.
 */
export type NotificationKindKey = NotificationKind | "challenge";

/**
 * Une ligne **affichée** dans le centre.
 *
 * Même forme qu'une notification jointe à son auteur, sauf que `kind`
 * accepte la valeur dérivée. Une alerte de défi a `actor: null` : elle ne
 * vient de personne, elle vient de la date.
 */
export type DisplayNotification = Omit<NotificationWithActor, "kind"> & {
  kind: NotificationKindKey;
};

/**
 * Les types affichés, dans l'ordre du filtre.
 *
 * « Défis » ouvre la marche parce que c'est la seule liste qui décrit ce
 * qui **reste à faire** : les trois autres racontent ce qui est arrivé.
 */
export const NOTIFICATION_KINDS: NotificationKindKey[] = [
  "challenge",
  "like",
  "follow",
  "mention",
  "message",
];

/** Libellé du filtre correspondant, dans la casse du terminal. */
export const KIND_LABEL: Record<NotificationKindKey, string> = {
  challenge: "Défis",
  like: "Likes",
  follow: "Abonnements",
  mention: "Mentions",
  message: "Messages",
};

/**
 * L'identité d'un événement — celle que la base refuse de dupliquer.
 *
 * Elle reprend exactement les colonnes de l'index unique
 * `notifications_event_uidx`, coalescées. Les coalesces ne sont pas un
 * détail : en JavaScript comme en SQL, l'absence de valeur n'est égale
 * à aucune autre absence de valeur, donc deux lignes « identiques » avec
 * une colonne `null` passeraient l'une et l'autre dans une comparaison
 * naïve. Le mode démo attaque la ligne entière ; sans cette
 * normalisation, un like sans cible comme un like avec cible
 * pourraient se confondre.
 */
export function notificationKey(n: {
  recipient_id: string;
  kind: string;
  actor_id?: string | null;
  post_id?: string | null;
  comment_id?: string | null;
  conversation_id?: string | null;
}): string {
  return [
    n.recipient_id,
    n.kind,
    n.actor_id ?? "",
    n.post_id ?? "",
    n.comment_id ?? "",
    n.conversation_id ?? "",
  ].join("|");
}

/**
 * Le groupe d'affichage : un acteur, un type, une cible.
 *
 * Cinq messages de la même personne dans la même conversation sont un
 * groupe. Cinq likes de la même personne sur cinq publications
 * différentes aussi — parce que le groupe est « le même acteur sur le
 * même objet », et non « le même acteur tout court » : ce qui suit, ce
 * qui arrive, et ce qu'on veut voir d'un coup.
 */
export function groupKey(n: DisplayNotification): string {
  const target =
    n.kind === "message"
      ? (n.conversation_id ?? "")
      : n.kind === "follow"
        ? ""
        : (n.post_id ?? "");
  return `${n.kind}|${n.actor_id ?? ""}|${target}`;
}

export interface NotificationGroup {
  key: string;
  /**
   * Le type affiché — « challenge » compris, donc pas `NotificationKind`.
   * Les écrans qui veulent une phrase d'acteur narrowent d'abord : le
   * défi du jour n'en a pas, puisque personne ne le lui adresse.
   */
  kind: NotificationKindKey;
  /**
   * Le membre le plus récent : c'est lui qui date et qui s'ouvre.
   *
   * Typé avec son auteur résolu, parce que le repli ne sert qu'à
   * l'affichage : toutes les lectures du centre font la jointure. Un
   * `Notification` nu ici obligerait l'écran à vérifier lui-même que
   * `actor` existe — et c'est exactement le genre de vérification qu'on
   * oublie à la moitié des endroits.
   */
  latest: DisplayNotification;
  /** Tous les membres, du plus récent au plus ancien. */
  members: DisplayNotification[];
  /** Nombre d'événements dans le groupe — c'est le `×5` affiché. */
  count: number;
  /** Combien ne sont pas encore lus. */
  unread: number;
}

/**
 * Replie une liste de notifications en groupes, du plus récent au plus
 * ancien.
 *
 * Le pliage se fait **après** la mise en ordre, jamais pendant : un
 * groupe est donc complet quand il entre dans le groupe suivant, et
 * l'ordre des groupes suit celui de leur événement le plus récent. Une
 * liste repliée à l'aveugle produirait des groupes dans l'ordre du
 * premier élément rencontré — donc dans un ordre qui n'est pas le
 * temps.
 *
 * Les lignes doivent être triées par `created_at` décroissant. La
 * fonction le fait elle-même plutôt que de le supposer : une liste mal
 * triée donnerait un centre qui ment sur ses dates, et le défaut
 * serait difficile à retrouver.
 */
export function foldNotifications(
  rows: DisplayNotification[],
): NotificationGroup[] {
  const sorted = [...rows].sort((a, b) =>
    compareDesc(String(a.created_at), String(b.created_at)),
  );

  const groups = new Map<string, NotificationGroup>();

  for (const row of sorted) {
    const key = groupKey(row);
    const found = groups.get(key);

    if (!found) {
      groups.set(key, {
        key,
        kind: row.kind,
        latest: row,
        members: [row],
        count: 1,
        unread: row.read_at ? 0 : 1,
      });
      continue;
    }

    found.members.push(row);
    found.count += 1;
    if (!row.read_at) found.unread += 1;
  }

  return [...groups.values()];
}

/**
 * Le texte d'un groupe, sans le nom de l'acteur.
 *
 * **Présent de l'indicatif, à dessein.** « il aime / elle aime »,
 * « il écrit / elle écrit », « il s'abonne / elle s'abonne » : la forme
 * est identique dans les deux genres. Au passé, il aurait fallu écrire
 * « aimé » ou « écrit » au féminin, et la ligne aurait changé selon
 * l'auteur de l'événement — une information que la base n'a pas
 * besoin de porter, et qui serait fausse pour la moitié du réseau.
 *
 * Le présent est aussi le bon temps : une notification décrit ce qui
 * est en train d'arriver, pas ce qui est arrivé.
 */
export function notificationPhrase(kind: NotificationKind, count: number): string {
  const many = count > 1;

  switch (kind) {
    case "like":
      return many ? `aime ${count} de tes publications` : "aime ta publication";
    case "follow":
      return "s'abonne à ton compte";
    case "mention":
      return many ? `te mentionne ${count} fois` : "te mentionne";
    case "message":
      return many ? `t'écrit ${count} messages` : "t'écrit";
  }
}

/** Le groupe est-il lu ? Un seul de ses membres non lu suffit. */
export function isGroupUnread(g: NotificationGroup): boolean {
  return g.unread > 0;
}

/** Identifiants des membres non lus d'un groupe. */
export function unreadIds(g: NotificationGroup): string[] {
  return g.members.filter((m) => !m.read_at).map((m) => m.id);
}

/**
 * Compare deux horodatages ISO, du plus récent au plus ancien.
 *
 * Comparaison de chaînes, comme partout ailleurs dans le projet : le
 * format produit par Postgres et par le store démo est le même, donc
 * l'ordre lexicographique est l'ordre chronologique. Une valeur
 * illisible ne doit pas non plus renverser la liste — d'où le repli sur
 * la chaîne vide, qui la place en dernier.
 */
function compareDesc(a: string, b: string): number {
  return b < a ? -1 : b > a ? 1 : 0;
}