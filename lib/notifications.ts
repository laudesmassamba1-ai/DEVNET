import { api } from "@/lib/api/client";
import { loadAuthorXp } from "@/lib/author-xp";
import { challengeAlertGroup } from "@/lib/challengeAlert";
import {
  foldNotifications,
  type NotificationGroup,
  type NotificationKindKey,
} from "@/lib/notify";
import type { NotificationWithActor } from "@/lib/types";

/**
 * Le centre de notifications, côté données.
 *
 * Comme partout ailleurs dans le projet, une seule fonction doit
 * répondre la même chose en mode démonstration et sur le vrai
 * backend. Deux points méritent d'être dits ici.
 *
 * **La table n'est presque jamais écrite par ce module.** Elle est
 * remplie par quatre déclencheurs (migration 010), et l'insertion est
 * fermée au client : écrire ici une notification serait un mensonge.
 * Ce module ne fait donc que lire, marquer comme lu, et supprimer.
 *
 * **Le compteur et la liste sont produits par la même fonction.** Le
 * repli (`foldNotifications`) est appliqué aux deux, donc la cloche ne
 * peut pas annoncer « 7 » au-dessus d'une liste de trois lignes : ce
 * désaccord est le défaut classique d'un compteur affiché à part, et il
 * est impossible ici parce qu'il n'y a qu'un seul calcul.
 *
 * **Une entrée ne vient pas de la table.** L'alerte des défis du jour est
 * dérivée de la date (`lib/challengeAlert.ts`) : elle n'a pas de ligne, sa
 * cible ni son auteur, et son état « lu » vit dans le navigateur. Elle est
 * ajoutée ici **aux deux fonctions**, pour la même raison que ci-dessus —
 * un compteur qui l'inclurait sans que la liste la montre, ou l'inverse,
 * ferait exactement le désaccord qu'on vient d'écarter.
 */

/** Colonnes d'auteur reprises par jointure. */
const ACTOR_COLUMNS =
  "id, prenom, pseudo, avatar_color, account_type, verified, is_admin";

/** Notifications par page dans le centre. */
export const PAGE_SIZE = 30;

/**
 * Au-delà, le compteur de la cloche sature.
 *
 * Le compte exact demanderait de lire **toutes** les lignes non lues à
 * chaque ouverture d'écran, ce qui n'a pas de borne : une liste de
 * non-lus est par définition la partie qui grossit sans que personne
 * ne la vide. On lit donc les plus récentes et on sature à 500, ce qui
 * reste très au-dessus du nombre qu'un lecteur laisse s'accumuler —
 * et l'interface affiche « 500+ » plutôt qu'un chiffre faux.
 */
export const UNREAD_CAP = 500;

export interface NotificationPage {
  /** Les groupes, du plus récent au plus ancien. */
  groups: NotificationGroup[];
  /** Reste-t-il des notifications plus anciennes ? */
  more: boolean;
  /** `created_at` du dernier événement lu — le curseur de la page suivante. */
  cursor: string | null;
  /**
   * Début des publications citées, pour que chaque ligne dise **de
   * quoi** elle parle. Sans cet extrait, douze likes se ressemblent
   * douze fois et la liste devient illisible.
   */
  excerpts: Map<string, string>;
}

/**
 * Une page du centre.
 *
 * Pagination par curseur sur `created_at`, comme le fil : un décalage
 * ferait sauter une ligne si quelqu'un aimait une publication pendant
 * que la liste se parcourait.
 *
 * On demande une ligne de plus que la page, et c'est sa présence qui
 * dit s'il reste des notifications — pas une requête de comptage.
 */
export async function fetchNotificationPage(
  me: string,
  options: { kind?: NotificationKindKey | null; before?: string | null } = {},
): Promise<NotificationPage> {
  if (!me) return { groups: [], more: false, cursor: null, excerpts: new Map() };

  // L'alerte des défis du jour est dérivée : elle n'appartient à aucune
  // page. On la pose sur la **première** seulement, sinon elle se
  // répéterait à chaque « charger plus ». Et seulement là où elle a sa
  // place : sous le filtre « Likes », une entrée de défi serait une
  // ligne hors sujet — c'est le même piège que de la compter dans le
  // mauvais onglet.
  const asked = !options.kind || options.kind === "challenge";
  const alert = !options.before && asked ? challengeAlertGroup(me) : null;

  // Filtre « Défis » : rien à demander à la base, l'alerte est tout ce
  // qu'il y a — et il n'y a donc pas de page suivante.
  if (options.kind === "challenge") {
    return {
      groups: alert ? [alert] : [],
      more: false,
      cursor: null,
      excerpts: new Map(),
    };
  }

  let query = api
    .from("notifications")
    // `notifications` porte `recipient_id` **et** `actor_id` : la
    // contrainte doit être nommée, sans quoi PostgREST refuse la jointure
    // (300) et le centre de notifications reste vide.
    .select(`*, actor:users!notifications_actor_id_fkey(${ACTOR_COLUMNS})`)
    .eq("recipient_id", me)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (options.before) query = query.lt("created_at", options.before);
  if (options.kind) query = query.eq("kind", options.kind);

  const { data } = await query;
  const rows = ((data as NotificationWithActor[]) ?? []).filter(Boolean);

  const page = rows.slice(0, PAGE_SIZE);
  let groups = foldNotifications(page);

  // L'alerte est datée du début du jour : on la replace dans l'ordre
  // plutôt que de la pousser en tête, sinon elle passerait devant des
  // notifications de la matinée.
  if (alert) groups = [...groups, alert].sort(byRecency);

  const actorXp = await loadAuthorXp(groups.map((g) => g.latest.actor_id));
  if (actorXp.size > 0) {
    groups = groups.map((g) => {
      const xp = g.latest.actor_id ? actorXp.get(g.latest.actor_id) : undefined;
      if (!g.latest.actor || xp === undefined) return g;
      return { ...g, latest: { ...g.latest, actor: { ...g.latest.actor, xp } } };
    });
  }

  return {
    groups,
    more: rows.length > PAGE_SIZE,
    cursor: page.length ? page[page.length - 1].created_at : null,
    excerpts: await fetchPostExcerpts(page.map((n) => n.post_id)),
  };
}

/** Du plus récent au plus ancien, sur la date de l'événement de tête. */
function byRecency(a: NotificationGroup, b: NotificationGroup): number {
  return a.latest.created_at < b.latest.created_at
    ? 1
    : a.latest.created_at > b.latest.created_at
      ? -1
      : 0;
}

export interface UnreadSummary {
  /** Groupes non lus, tous types confondus — le chiffre de la cloche. */
  total: number;
  /** Groupes non lus par type — les compteurs des onglets. */
  byKind: Record<NotificationKindKey, number>;
  /** La requête a-t-elle été tronquée ? Alors le total est un plancher. */
  saturated: boolean;
}

/**
 * Le décompte des non-lus, en une seule requête.
 *
 * Le total **et** les compteurs par type sortent du même calcul : on lit
 * les lignes non lues, on les replie, puis on compte. Les trois chiffres
 * viennent donc de la même liste — impossible d'avoir « 7 » sur la
 * cloche et « 2 + 1 + 0 + 3 » sur les onglets, qui ne font pas 7.
 *
 * La limite `UNREAD_CAP` borne la requête ; quand elle est atteinte,
 * `saturated` dit de rendre « 500+ » plutôt qu'un chiffre faux.
 */
export async function fetchUnreadSummary(me: string): Promise<UnreadSummary> {
  const byKind: Record<NotificationKindKey, number> = {
    challenge: 0,
    like: 0,
    follow: 0,
    mention: 0,
    message: 0,
  };

  if (!me) return { total: 0, byKind, saturated: false };

  const { data } = await api
    .from("notifications")
    .select(
      "id, recipient_id, actor_id, kind, post_id, comment_id, conversation_id, created_at, read_at",
    )
    .eq("recipient_id", me)
    .is("read_at", null)
    .limit(UNREAD_CAP);

  const groups = foldNotifications((data as NotificationWithActor[]) ?? []);

  for (const g of groups) byKind[g.kind] += 1;

  // L'alerte des défis du jour est non lue tant qu'elle n'a pas été
  // acquittée. Elle compte **une fois**, comme un groupe : la cloche et
  // l'onglet « Défis » lisent donc le même chiffre que ce que la liste
  // affiche.
  const alert = challengeAlertGroup(me);
  if (alert) byKind.challenge = 1;

  return {
    total: groups.length + (alert ? 1 : 0),
    byKind,
    // La saturation se lit sur la **page lue**, pas sur les groupes
    // dédoublonnés : dès que la lecture a coupé des lignes, il peut en
    // rester plus en dessous — même si les plis les ramenaient à peu de
    // groupes. Un total « plein » affiche alors son « + » honnête.
    saturated: (data as NotificationWithActor[]).length >= UNREAD_CAP,
  };
}

/**
 * Marque comme lues les notifications données.
 *
 * `read_at` est la seule colonne que le client peut écrire ; la RLS
 * refuse toute autre, et le moteur de démonstration reproduit ce refus
 * (voir `UPDATE_FORBIDDEN_COLUMNS` dans `lib/demo/query.ts`). C'est ce
 * qui empêche de réécrire le `kind` d'une notification pour la faire
 * ressembler à autre chose.
 */
export async function markRead(ids: string[]): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null };

  const { error } = await api
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);

  return { error: error?.message ?? null };
}

/** Marque tout comme lu — la notification **et** son groupe entier. */
export async function markAllRead(me: string): Promise<{ error: string | null }> {
  if (!me) return { error: null };

  const { error } = await api
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", me)
    .is("read_at", null);

  return { error: error?.message ?? null };
}

/**
 * Marque comme lues les notifications d'une conversation.
 *
 * C'est ce qu'on appelle à l'ouverture d'une conversation : sans cela,
 * un message resterait « non lu » après avoir été lu, et la cloche
 * compterait des messages que la personne a déjà vus.
 *
 * La conversation n'a pas sa propre table de lecture : la source de
 * vérité reste `notifications.read_at`. Une deuxième table
 * (`conversation_reads`) finirait par diverger de la première, et il y
 * aurait deux façons de dire si un message a été lu.
 */
export async function markConversationRead(
  me: string,
  conversationId: string,
): Promise<{ error: string | null }> {
  if (!me || !conversationId) return { error: null };

  const { error } = await api
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", me)
    .eq("conversation_id", conversationId)
    .is("read_at", null);

  return { error: error?.message ?? null };
}

/** Supprime les notifications données — le « × » d'une ligne. */
export async function dismissNotifications(ids: string[]): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null };

  const { error } = await api.from("notifications").delete().in("id", ids);
  return { error: error?.message ?? null };
}

/**
 * Vide le centre.
 *
 * Irréversible, et c'est pourquoi l'écran demande confirmation. Mais
 * rien n'est perdu ailleurs : le like reste dans `post_likes`, le
 * message dans `direct_messages`. Effacer la liste n'efface aucun
 * fait — c'est l'inverse de supprimer un message.
 */
export async function clearNotifications(me: string): Promise<{ error: string | null }> {
  if (!me) return { error: null };

  const { error } = await api
    .from("notifications")
    .delete()
    .eq("recipient_id", me);

  return { error: error?.message ?? null };
}

/**
 * Le nombre de messages non lus d'une conversation.
 *
 * Lu dans la table des notifications, pas dans une table de lecture
 * séparée — même source de vérité que le compteur de la cloche, donc
 * les deux ne peuvent pas se contredire. Une conversation sans
 * notification non lue vaut zéro, ce qui est aussi le cas d'une
 * conversation dont on a tout lu.
 *
 * On ne renvoie qu'un ensemble : la liste des conversations suffit à
 * afficher « non lu », et un décompte ajouterait une information que
 * l'écran ne montre pas.
 */
export async function fetchUnreadConversations(
  me: string,
): Promise<Record<string, number>> {
  if (!me) return {};

  const { data } = await api
    .from("notifications")
    .select("conversation_id")
    .eq("recipient_id", me)
    .eq("kind", "message")
    .is("read_at", null);

  // Un compteur par conversation, comme la pastille d'un tchat. Sans
  // lui, « y a-t-il du nouveau » perd la quantité — et la quantité est
  // précisément ce qui décide de remonter ou non dans la liste.
  const counts: Record<string, number> = {};
  for (const row of (data as { conversation_id: string | null }[]) ?? []) {
    if (row.conversation_id) {
      counts[row.conversation_id] = (counts[row.conversation_id] ?? 0) + 1;
    }
  }
  return counts;
}

/* ── Rendu ──────────────────────────────────────────────────────── */

/**
 * Où mène une notification.
 *
 * Chaque type mène à **l'objet concerné**, jamais à l'écran où il
 * se trouve par hasard : un like mène à la publication, pas au fil où
 * elle défile peut-être trois pages plus bas. Une notification qui
 * mène à un endroit sans l'objet est un notification qui oblige à
 * chercher.
 *
 * Le suivi mène au profil de la personne suivie : c'est la seule
 * réponse utile à « qui vient de me suivre ».
 *
 * Le défi du jour mène à l'onglet Progrès : c'est là que les trois défis
 * et leur avancement sont, et c'est la seule réponse utile à « qu'est-ce
 * que je dois faire aujourd'hui ».
 */
export function notificationHref(group: NotificationGroup): string {
  const n = group.latest;

  switch (group.kind) {
    case "like":
    case "mention":
      return n.post_id ? `/post/${n.post_id}` : "/feed";
    case "message":
      return "/messages";
    case "follow":
      return n.actor?.pseudo ? `/u/${n.actor.pseudo}` : "/search";
    case "challenge":
      return "/profile?tab=progress";
  }
}

/**
 * L'extrait d'une publication, pour situer la notification.
 *
 * Une seule ligne, coupée sur un mot entier : couper au milieu d'un
 * mot fait « J'ai réécr… » et donne l'impression que le texte est plus
 * court qu'il ne l'est.
 */
export function postExcerpt(text: string | null | undefined, max = 88): string {
  if (!text) return "";

  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;

  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Les extraits des publications citées par une page de notifications. */
async function fetchPostExcerpts(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const out = new Map<string, string>();

  if (wanted.length === 0) return out;

  const { data } = await api
    .from("posts")
    .select("id, text")
    .in("id", wanted);

  for (const p of (data as { id: string; text: string }[]) ?? []) {
    out.set(p.id, postExcerpt(p.text));
  }

  return out;
}