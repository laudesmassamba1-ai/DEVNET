/**
 * Les notifications de démonstration.
 *
 * Il n'y a **pas** de jeu de données ici, et c'est volontaire : les
 * notifications sont **dérivées** des tables d'origine, exactement
 * comme les compteurs de likes le sont de `post_likes`.
 *
 * Un jeu de données écrit à la main finirait par mentir. On ajouterait
 * un like dans `DEMO_POST_LIKES` en oubliant la notification
 * correspondante, et le centre afficherait un compte faux — le même
 * défaut que `likes: 34` sur un post qui n'a que deux lignes dans
 * `post_likes`, que la migration 005 supprime côté Postgres.
 *
 * Donc on **rejoue les quatre déclencheurs** de la migration 010 à
 * chaque sauvegarde, comme `syncCounters` rejoue les compteurs. Le
 * résultat est la seule garantie possible : la démo produit la même
 * ligne que la base, parce qu'elle applique la même règle.
 *
 * Trois propriétés du rejeu :
 *
 * - **idempotent** : il n'ajoute que les événements qui n'ont pas
 *   encore de ligne, trouvé par la clé de déduplication. Un rejeu ne
 *   double rien.
 * - **non destructif** : il ne touche pas aux lignes existantes, donc
 *   un `read_at` posé par le lecteur survit au rechargement.
 * - **sans effet de bord** : il écrit dans le tableau qu'on lui donne,
 *   et ne sauvegarde pas. L'appelant (`store.ts`) gère la
 *   persistance, une seule fois, au même endroit que le reste.
 */

import { extractMentions } from "../mentions";
import { notificationKey } from "../notify";
import type { Row } from "./store";

/** Ce dont le rejeu a besoin — et rien de plus. */
export interface NotificationSources {
  users: Row[];
  posts: Row[];
  post_likes: Row[];
  follows: Row[];
  comments: Row[];
  direct_messages: Row[];
  conversations: Row[];
  /** Le résultat : où poser les lignes manquantes. */
  notifications: Row[];
}

/**
 * Le plus grand identifiant déjà attribué à une notification.
 *
 * Relu à chaque rejeu plutôt que gardé dans une variable de module :
 * celle-ci repartrait à zéro au rechargement de la page, et la
 * notification suivante reprendrait un identifiant déjà pris. Le
 * symptôme serait discret — deux lignes, deux `id` identiques, et la
 * liste en affiche une seule parce que React les rapproche par clé —
 * mais le compteur de non-lus, lui, compterait les deux.
 */
function nextSerial(notifications: Row[]): () => number {
  let max = 0;
  for (const n of notifications) {
    const m = /^notif-(\d+)$/.exec(String(n.id ?? ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  let serial = max;
  return () => ++serial;
}

/**
 * La clé de déduplication, telle que l'index unique la calcule.
 *
 * Même formule que `notifications_event_uidx` : une colonne nulle est
 * rendue par la chaîne vide, sinon deux événements différents
 * pourraient se confondre dans le vide.
 */
function dedupeKey(row: Row): string {
  return notificationKey({
    recipient_id: String(row.recipient_id),
    kind: String(row.kind),
    actor_id: (row.actor_id ?? null) as string | null,
    post_id: (row.post_id ?? null) as string | null,
    comment_id: (row.comment_id ?? null) as string | null,
    conversation_id: (row.conversation_id ?? null) as string | null,
  });
}

/**
 * La règle unique, en un seul endroit.
 *
 * Reprise de `raise_notification()` : pas de notification à soi-même,
 * pas de doublon, et rien du tout si le destinataire ou l'acteur
 * manque. C'est la seule condition qu'il ne faut pas oublier en
 * écrivant un cinquième déclencheur.
 *
 * `notifications` reçoit la ligne ; `existing` sert à la fois de
 * garde de doublon et de mémoire du `read_at` déjà posé.
 */
function raise(
  sources: NotificationSources,
  existing: Set<string>,
  nextId: () => number,
  event: {
    recipient_id: unknown;
    actor_id: unknown;
    kind: string;
    post_id?: unknown;
    comment_id?: unknown;
    conversation_id?: unknown;
    created_at?: unknown;
  },
): void {
  const recipient = event.recipient_id as string | undefined;
  const actor = event.actor_id as string | undefined;

  if (!recipient || !actor || recipient === actor) return;

  const row: Row = {
    id: `notif-${nextId()}`,
    recipient_id: recipient,
    actor_id: actor,
    kind: event.kind,
    post_id: (event.post_id ?? null) as string | null,
    comment_id: (event.comment_id ?? null) as string | null,
    conversation_id: (event.conversation_id ?? null) as string | null,
    created_at:
      (event.created_at as string | undefined) ?? new Date().toISOString(),
    read_at: null,
  };

  const key = dedupeKey(row);
  if (existing.has(key)) return;

  existing.add(key);
  sources.notifications.push(row);
}

/**
 * Les destinataires d'une mention.
 *
 * Le pseudo doit exister : c'est la jointure `join users on pseudo =
 * lower(...)` de la migration 010. Sans elle, `@fantome` dans un
 * commentaire produirait une notification adressée à personne — et
 * l'écran afficherait « un compte supprimé » pour quelqu'un qui n'a
 * jamais existé.
 */
function mentionTargets(
  sources: NotificationSources,
  text: unknown,
): string[] {
  const pseudos = extractMentions(typeof text === "string" ? text : null);
  if (pseudos.length === 0) return [];

  const known = new Set(
    sources.users.map((u) => String(u.pseudo ?? "").toLowerCase()),
  );

  return pseudos
    .filter((p) => known.has(p))
    .map((p) => sources.users.find((u) => String(u.pseudo).toLowerCase() === p)?.id)
    .filter((id): id is string => Boolean(id));
}

/**
 * Rejoue les quatre déclencheurs de la migration 010.
 *
 * L'ordre suit celui du SQL (like, follow, mention, message) sans
 * qu'il ait d'importance : aucune de ces règles ne dépend d'une autre.
 * La table est supposed vide au premier chargement, comme
 * `conversation_members` — c'est ce même principe : une table
 * alimentée par un déclencheur ne se remplit pas à la main.
 */
export function replayNotifications(sources: NotificationSources): void {
  const existing = new Set(sources.notifications.map(dedupeKey));
  const nextId = nextSerial(sources.notifications);

  // 4.1 — un like vise l'auteur du post.
  const authorOfPost = new Map(sources.posts.map((p) => [String(p.id), String(p.author_id)]));
  for (const like of sources.post_likes) {
    raise(sources, existing, nextId, {
      recipient_id: authorOfPost.get(String(like.post_id)),
      actor_id: like.user_id,
      kind: "like",
      post_id: like.post_id,
      created_at: like.created_at,
    });
  }

  // 4.2 — un abonnement vise la personne suivie, pas celle qui suit.
  for (const follow of sources.follows) {
    raise(sources, existing, nextId, {
      recipient_id: follow.followee_id,
      actor_id: follow.follower_id,
      kind: "follow",
      created_at: follow.created_at,
    });
  }

  // 4.3 — les mentions, publications et commentaires.
  //
  // Le code d'une publication est ignoré, comme en SQL : il contient
  // des `@` décoratifs, et mentionner quelqu'un depuis un bout de
  // code n'a jamais voulu dire grand-chose.
  for (const post of sources.posts) {
    for (const recipient_id of mentionTargets(sources, post.text)) {
      raise(sources, existing, nextId, {
        recipient_id,
        actor_id: post.author_id,
        kind: "mention",
        post_id: post.id,
        created_at: post.created_at,
      });
    }
  }

  for (const comment of sources.comments) {
    for (const recipient_id of mentionTargets(sources, comment.text)) {
      raise(sources, existing, nextId, {
        recipient_id,
        actor_id: comment.author_id,
        kind: "mention",
        post_id: comment.post_id,
        comment_id: comment.id,
        created_at: comment.created_at,
      });
    }
  }

  // 4.4 — un message vise tous les participants sauf son auteur.
  //
  // « Tous », et non « le premier différent de l'auteur » : une
  // conversation a deux participants, et « le premier trouvé »
  // dépendrait de l'ordre du tableau.
  const participantsOf = new Map(
    sources.conversations.map((c) => [
      String(c.id),
      (c.participants as string[] | undefined) ?? [],
    ]),
  );

  for (const dm of sources.direct_messages) {
    for (const recipient_id of participantsOf.get(String(dm.conversation_id)) ?? []) {
      raise(sources, existing, nextId, {
        recipient_id,
        actor_id: dm.author_id,
        kind: "message",
        conversation_id: dm.conversation_id,
        created_at: dm.created_at,
      });
    }
  }
}