import {
  getStore, isTable, newId, save, type DemoStore, type Row,
} from "./store";
import { loadSessionId } from "./session";
import { makeProof } from "@/lib/proofs";

/**
 * Implémentation locale du sous-ensemble de PostgREST qu'utilise DevNet.
 *
 * Ce n'est pas une simulation « grossière » : les mêmes méthodes, les mêmes
 * sémantiques de retour (`{ data, error }`), les mêmes cas d'erreur. Le code
 * applicatif ne doit pas pouvoir distinguer le vrai backend du faux.
 */

/**
 * Le résultat d'une requête — la forme de PostgREST.
 *
 * `count` n'est présent que si la requête l'a demandé par
 * `select(…, { count: "exact" })`. Il est donc optionnel : un résultat
 * sans compte n'est pas un résultat incomplet, c'est un résultat qui ne
 * portait pas la question.
 */
export type Result<T = Row[]> = {
  data: T | null;
  error: { message: string } | null;
  count?: number;
};

type Filter = (row: Row) => boolean;

/**
 * Sépare un `select` du type `"*, author:users(a, b)"`.
 *
 * La partie `!contrainte` est **tolérée puis ignorée** : c'est
 * l'échappatoire de PostgREST quand plusieurs clés étrangères relient les
 * deux tables (`author:users!posts_author_id_fkey(...)`). Le moteur local
 * n'a pas besoin d'elle — il résout la personne par les colonnes de
 * liaison usuelles, un peu plus bas dans `shape()` — mais la chaîne de
 * `select` vient du code appelant, qui est le même dans les deux modes.
 * Ne pas l'accepter ferait diverger la démo du vrai backend sur des
 * requêtes pourtant identiques.
 */
const EMBED_RE =
  /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)(?:![A-Za-z_][A-Za-z0-9_]*)?\s*\(([^)]*)\)/g;

/** Convertit `"id, prenom"` en `["id", "prenom"]`. `null` = toutes les colonnes. */
function parseColumns(select: string): { plain: string[] | null; embeds: { alias: string; table: string; cols: string[] }[] } {
  const plain: string[] = [];
  const embeds: { alias: string; table: string; cols: string[] }[] = [];

  const rest = select.replace(EMBED_RE, (_m, alias: string, table: string, cols: string) => {
    embeds.push({
      alias,
      table,
      cols: cols.split(",").map((c) => c.trim()).filter(Boolean),
    });
    return "";
  });

  for (const part of rest.split(",")) {
    const c = part.trim();
    if (c && c !== "*") plain.push(c);
  }

  return { plain: plain.length ? plain : null, embeds };
}

/** Projette une ligne sur les colonnes demandées. */
function project(row: Row, cols: string[] | null): Row {
  if (!cols) return { ...row };
  const out: Row = {};
  for (const c of cols) if (c in row) out[c] = row[c];
  return out;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

/**
 * Égalité à la PostgREST : l'opérateur `eq` de l'API compare les valeurs
 * **en les coercant au type de la colonne**, pas en `===` JavaScript.
 * Le client passe parfois des chaînes là où la base stocke des nombres
 * (un `limit(20)` filtre sur un entier, une recherche URL porte une
 * chaîne) ; une comparaison stricte écarterait alors à tort des lignes
 * qui correspondent en réalité. On appelle donc l'égalité sur la valeur
 * normalisée en chaîne, sauf quand les deux sont déjà du même type.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

/**
 * Clés primaires composites des tables de jonction.
 *
 * Le moteur démo n'a pas d'index : sans cette liste, réinsérer un like
 * déjà poserait créait une seconde ligne identique, et le compteur
 * compterait deux fois le même « j'aime ». Postgres, lui, refuse
 * l'écriture avec une erreur `duplicate key`. On reproduit cette
 * contrainte **et** cette erreur, parce que le code applicatif doit
 * pouvoir se comporter pareil dans les deux modes : c'est lui qui
 * décide, sur l'erreur, qu'il faut retirer le like au lieu de l'ajouter.
 */
const COMPOSITE_KEYS: Record<string, string[]> = {
  post_likes: ["post_id", "user_id"],
  reactions: ["post_id", "user_id"],
  reposts: ["post_id", "user_id"],
  bookmarks: ["post_id", "user_id"],
  follows: ["follower_id", "followee_id"],
  group_members: ["group_id", "user_id"],
  community_members: ["community_id", "user_id"],
  conversation_members: ["conversation_id", "user_id"],
  // Depuis la migration 019, la clé de `project_sessions` est la paire
  // (projet, personne) : une session est une personne dans un projet, pas
  // un fichier. Sans cette ligne, le moteur fabriquerait un `id` que le
  // vrai schéma n'a plus, et deux sessions pour la même personne
  // coexisteraient — soit deux présences pour un seul curseur.
  project_sessions: ["project_id", "user_id"],
  // Migration 025 : un projet ne reçoit qu'une étoile par votant. Sans
  // cette contrainte, le même votant aurait pu voter dix fois — et la
  // note bayésienne du moteur de notation aurait été gonflée d'une voix
  // qui n'existe pas en base.
  project_ratings: ["project_id", "voter_id"],
};

/**
 * Tables dont le client n'a pas le droit d'écrire.
 *
 * La RLS décide, et elle peut décider « personne ». `conversation_members`
 * est de ce cas : la politique `cm_insert` est `with check (false)`,
 * parce que l'adhésion se déduit de `conversations.participants` via un
 * déclencheur (`conversations_sync_members`). Autoriser l'écriture ici
 * rendrait possible de s'inscrire de force dans une conversation — et
 * donc d'en lire le contenu, puisque `dm_read` passe par cette table.
 *
 * On refuse l'écriture entière plutôt que de la filtrer ligne par ligne :
 * il n'existe aucun cas légitime où le client écrit cette table, donc
 * la fidélité consiste à le dire.
 */
const CLIENT_CANT_WRITE = new Set<string>([]);

/**
 * Colonnes que le client peut écrire, et **uniquement** celles-là, sur une
 * table dont la RLS n'ouvre qu'une mise à jour étroite.
 *
 * `conversation_members` illustre pourquoi cette liste existe : sa
 * politique est `using (auth.uid() = user_id)` — donc la RLS protège la
 * *ligne* — mais rien n'empêcherait le client de réécrire
 * `conversation_id` ou `user_id` sur cette ligne et de s'y faire
 * inviter dans une conversation dont il n'est pas membre. La RLS
 * raisonne en lignes, jamais en colonnes : c'est le `revoke update` de
 * la migration 017 qui ferme le reste, et cette liste en est le reflet
 * local.
 */
const UPDATE_ALLOWED_COLUMNS: Record<string, string[]> = {
  conversation_members: ["last_read_at"],
  channel_members: ["last_read_at"],
  // 041 : un message privé se corrige, il ne se déplace pas. Le `revoke
  // update (…)` de la migration ferme `conversation_id`, `author_id` et
  // `created_at` ; cette liste est le même contrat côté démo. Sans elle,
  // un message qu'on édite pourrait changer de fil — et l'écran
  // afficherait dans un privé un contenu qui appartient à un autre.
  direct_messages: ["text", "is_code", "edited_at"],
};

/**
 * Tables dont le client n'a pas le droit de **modifier**.
 *
 * La RLS peut refuser une opération sans interdire les autres : c'est
 * exactement le cas de `comments`, où la migration 05 n'ouvre aucune
 * politique `update`. Un commentaire publié se supprime et se reposte,
 * il ne se réécrit pas — même principe que pour un message, l'historique
 * ne se réécrit pas.
 *
 * Sans cette règle, le mode démo laisserait corriger un propos publié
 * alors que la base le refuse : l'écran validerait quelque chose que le
 * produit ne valide pas.
 */
const CLIENT_CANT_UPDATE = new Set(["comments"]);

/**
 * Tables dont la politique d'**insertion** est fermée.
 *
 * La RLS décide opération par opération : `conversation_members` est
 * fermée en écriture, `notifications` ne l'est qu'en insertion — le
 * client y écrit `read_at` et supprime ses lignes. Confondre les deux
 * serait aussi faux dans un sens que dans l'autre : interdire
 * l'insertion empêche le rejeu de fabrique des événements, l'autoriser
 * permettrait de se congratulate soi-même.
 *
 * `upsert` est refusé avec l'insertion, parce qu'un `upsert` exige
 * l'insertion **et** la mise à jour : sans politique d'insertion,
 * Postgres le refuse, donc le démo aussi.
 */
const CLIENT_CANT_INSERT = new Set(["notifications", "conversation_members"]);

/**
 * Colonnes hors du droit de mise à jour, par table.
 *
 * La RLS dit *quelles lignes* on peut toucher, jamais *quelles
 * colonnes*. Sur `notifications`, la ligne est protégée par
 * `recipient_id`, mais rien n'empêcherait d'écrire `kind = 'follow'`
 * ou `actor_id = soi` sur sa propre notification — donc de réécrire un
 * fait. C'est le `revoke update (...)` de la migration 010, et le
 * principe du `revoke update (likes, liked_by, comments)` de la
 * migration 005.
 */
const UPDATE_FORBIDDEN_COLUMNS: Record<string, string[]> = {
  // 037 : ni l'identité du compte ni sa date de naissance sur DevNet ne
  // se réécrivent. En revanche `verified` et `is_admin` **s'ouvrent** —
  // mais uniquement à l'administration, et c'est la règle de ligne plus
  // bas qui le dit, pas cette liste.
  users: ["id", "created_at"],
  // Sur `reports`, **seul `status` est modifiable**. La politique RLS ne
  // dit rien des colonnes — et ça serait une faute : elle raisonne en
  // lignes. Sans cette liste, un utilisateur pourrait réécrire
  // `reporter_id` sur son propre signalement et le rendre invisible à
  // celui qui l'a fait, ou viser autre chose que le contenu qu'il a
  // signalé. Un signalement est un **fait**, comme une notification :
  // on le classe, on ne le réécrit pas.
  reports: [
    "id",
    "reporter_id",
    "post_id",
    "comment_id",
    "message_id",
    "reported_user",
    "target_type",
    "reason",
    "details",
    "created_at",
    "resolved_at",
  ],
  notifications: [
    "id",
    "recipient_id",
    "actor_id",
    "kind",
    "post_id",
    "comment_id",
    "conversation_id",
    "created_at",
  ],
  // 028 : ni l'identité d'une communauté ni son compteur ne se réécrivent.
  // Le `slug` est l'adresse publique du fil — le changer casserait tous les
  // liens, comme le ferait un `created_by` réécrit pour s'attribuer une
  // communauté. Ces colonnes ne sont pas dans la politique de mise à jour.
  communities: ["id", "slug", "created_by", "created_at", "member_count"],
  // 028 : une adhésion se règle en `role`, pas en réécrivant sa clé.
  community_members: ["community_id", "user_id", "joined_at"],
  // 030 : une connexion garde son **identité**. On peut constater son
  // usage (`used_at`), pas la réattribuer à quelqu'un d'autre, ni la faire
  // pointer vers une autre destination sans repasser par une connexion
  // explicite. `token_ref` est un pointeur de coffre : le réécrire
  // détournerait un jeton sans jamais le voir.
  github_connections: [
    "id",
    "user_id",
    "provider",
    "token_ref",
    "connected_at",
    "endpoint",
  ],
};

/**
 * Tables dont le client ne voit et ne touche que **ses** lignes.
 *
 * Le nom de la colonne qui porte le propriétaire suffit : c'est
 * toujours la même forme de politique (`auth.uid() = recipient_id`).
 *
 * On l'applique aussi à la **lecture**, comme Postgres le ferait. Une
 * lecture non filtrée qui réussit en démo et échoue en production est
 * le pire des écarts : l'écran affiche la liste vide, et rien n'explique
 * pourquoi.
 *
 * `bookmarks` et `message_pins` y figurent pour une raison de
 * **confidentialité**, pas de technique : un signet est la liste de
 * lecture de quelqu'un, la publier reviendrait à afficher son
 * historique de lecture à tout le monde. Elles sont donc privées même
 * en lecture — contrairement à `reactions` et `message_reactions`, qui
 * sont publiques parce qu'elles s'affichent sur la bulle et constituent
 * une information du message, pas de son lecteur.
 */
const OWNED_BY: Record<string, string> = {
  notifications: "recipient_id",
  bookmarks: "user_id",
  message_pins: "user_id",
  // La connexion GitHub est strictement personnelle (migration 004,
  // `gh_self_read`) : ni lisible ni modifiable par un autre, même membre
  // du même projet. Sans cette entrée, le mode démo laisserait lire la
  // connexion de quelqu'un d'autre — l'écart de confidentialité le plus
  // coûteux de la table.
  github_connections: "user_id",
};

/**
 * Politiques de lecture qui ne sont pas une simple appartenance.
 *
 * `OWNED_BY` couvre le cas « la ligne est à moi, un seul nom de colonne
 * suffit ». `reports` est plus subtil : on voit ses propres signalements,
 * ceux visant son contenu, et — pour un message de groupe — ceux d'un
 * groupe dont on est le créateur. Une seule égalité ne suffit pas, donc
 * on donne ici une fonction complète.
 *
 * Elle reçoit l'identifiant de la personne **connectée** et non celui
 * passé en paramètre : c'est ce que fait `auth.uid()` dans la politique,
 * et une RLS qui se fierait à une colonne de la requête serait
 * contournable.
 */
const READ_RULES: Record<string, (row: Row, me: string, store: DemoStore) => boolean> = {
  // La politique de lecture de `stories` porte un filtre temporel :
  // `expires_at > now()`. Il faut le reproduire, sinon une story
  // périmée resterait visible en démo et disparaîtrait en production —
  // un écart qui ne se voit que le lendemain. `expires_at` peut être
  // absent (story sans fin) : `Date.parse` d'un vide donne `NaN`, et
  // `NaN > Date.now()` est faux — la story disparaîtrait à tort.
  stories: (row: Row): boolean =>
    Date.parse(String(row.expires_at ?? "")) > Date.now(),
  reports: (row: Row, me: string, store: DemoStore): boolean => {
    // Mon propre signalement.
    if (row.reporter_id === me) return true;
    // Mon compte signalé.
    if (row.reported_user === me) return true;

    if (row.post_id) {
      const post = store.posts.find((p) => p.id === row.post_id);
      if (post && post.author_id === me) return true;
    }

    if (row.comment_id) {
      const comment = store.comments.find((c) => c.id === row.comment_id);
      if (comment && comment.author_id === me) return true;
    }

    if (row.message_id) {
      const message = store.group_messages.find((m) => m.id === row.message_id);
      if (!message) return false;
      if (message.author_id === me) return true;

      // Créateur du groupe : il a déjà le droit de supprimer ce message.
      const group = store.groups.find((g) => g.id === message.group_id);
      if (group !== undefined && group.created_by === me) return true;

      // Migration 020 : l'équipe (owner | moderator) a désormais le même
      // pouvoir de suppression, donc la même lecture. La raison de la 011
      // ("il a déjà le droit de supprimer ce message") s'applique au
      // modérateur aussi — c'est exactement pourquoi la lecture suit.
      const role = roleInGroup(store, message.group_id, me);
      return role === "owner" || role === "moderator";
    }

    return false;
  },

  // La lecture d'une communauté suit sa visibilité : publique ou
  // restreinte pour tout le monde, `private` pour ses seuls membres. La
  // ligne affichée est la communauté elle-même, on regarde donc son
  // propre `visibility`.
  communities: (row: Row, me: string, store: DemoStore): boolean =>
    canReadCommunity(store, row.id, me),

  // On ne lit l'adhésion que d'une communauté qu'on peut lire : même
  // portée que le fil qu'elle sert à modérer.
  community_members: (row: Row, me: string, store: DemoStore): boolean =>
    canReadCommunity(store, row.community_id, me),
};

/**
 * Le rôle de l'appelant dans un groupe — le rejeu de `group_role()`
 * (migration 020).
 *
 * `security definer` côté base, lecture directe ici : dans les deux cas
 * le rôle se lit **sans** passer par les politiques de `group_members`.
 * Côté démo, ce serait une récursion de règles qu'aucun moteur ne
 * sait arbitrer ; côté base, une récursion tout court.
 */
function roleInGroup(store: DemoStore, gid: unknown, me: string | null): string | null {
  if (!me) return null;
  const row = store.group_members.find(
    (m) => m.group_id === gid && m.user_id === me,
  );
  return row ? String(row.role ?? "member") : null;
}

/** Le personnel d'un groupe — les deux rôles qui modèrent. */
function isStaff(store: DemoStore, gid: unknown, me: string | null): boolean {
  const role = roleInGroup(store, gid, me);
  return role === "owner" || role === "moderator";
}

/**
 * Le compte d'administration **du site** (migration 037).
 *
 * À ne pas confondre avec `isStaff` : le personnel modère un conteneur
 * qu'il a créé, l'administrateur traite les demandes de vérification.
 * Le rôle vit sur la ligne `users`, pas dans une adhésion — donc même
 * lecture directe que `group_role()`, sans passer par la RLS.
 */
function isAdmin(store: DemoStore, me: string | null): boolean {
  if (!me) return false;
  return store.users.find((u) => u.id === me)?.is_admin === true;
}

/**
 * Le rôle de l'appelant dans un projet — le rejeu de `project_role()`
 * (migration 027). Même raison que `roleInGroup` : une politique qui se
 * lirait elle-même produirait une récursion, en base comme ici.
 */
function roleInProject(store: DemoStore, pid: unknown, me: string | null): string | null {
  if (!me) return null;
  const row = store.project_members.find(
    (m) => m.project_id === pid && m.user_id === me,
  );
  return row ? String(row.role ?? "editor") : null;
}

/** Administre-t-on ce projet ? Propriétaire et mainteneurs, pas les éditeurs. */
function administersProject(store: DemoStore, pid: unknown, me: string | null): boolean {
  const role = roleInProject(store, pid, me);
  return role === "owner" || role === "maintainer";
}

/**
 * Le rôle de l'appelant dans une communauté — le rejeu de
 * `community_role()` (migration 028). Même raison que les deux
 * précédents : une politique qui se lirait elle-même se récurserait.
 */
function roleInCommunity(store: DemoStore, cid: unknown, me: string | null): string | null {
  if (!me) return null;
  const row = store.community_members.find(
    (m) => m.community_id === cid && m.user_id === me,
  );
  return row ? String(row.role ?? "member") : null;
}

/** L'équipe d'une communauté — les deux rôles qui modèrent. */
function isCommunityStaff(store: DemoStore, cid: unknown, me: string | null): boolean {
  const role = roleInCommunity(store, cid, me);
  return role === "owner" || role === "moderator";
}

/**
 * Une communauté est-elle lisible ? Le rejeu de `can_read_community()`
 * (028) : publique ou restreinte pour tous, `private` pour ses membres.
 */
function canReadCommunity(store: DemoStore, cid: unknown, me: string | null): boolean {
  const community = store.communities.find((c) => c.id === cid);
  if (!community) return false;
  const visibility = String(community.visibility ?? "public");
  if (visibility === "public" || visibility === "restricted") return true;
  return roleInCommunity(store, cid, me) !== null;
}

/**
 * Politiques de **suppression** qui ne sont pas une simple appartenance.
 *
 * `matches()` est partagé par la lecture et la suppression : y glisser
 * ces règles rendrait illisible un message qu'on peut lire. Une politique
 * de suppression vit donc à part, et ne s'applique qu'au `delete`.
 *
 * Postgres supprime **silencieusement** les lignes que la RLS cache —
 * il ne lève pas d'erreur. On refuse donc la ligne, pas l'opération :
 * c'est le sémantique exacte.
 */
const DELETE_ROW_RULES: Record<string, (row: Row, me: string, store: DemoStore) => boolean> = {
  // `gm_delete` (005, étendue en 020) : l'auteur, le créateur du groupe,
  // ou — depuis 020 — l'équipe (owner | moderator) du groupe.
  group_messages: (row: Row, me: string, store: DemoStore): boolean =>
    row.author_id === me ||
    store.groups.find((g) => g.id === row.group_id)?.created_by === me ||
    isStaff(store, row.group_id, me),

  // `dm_delete` (005) : l'auteur, et personne d'autre. Un privé ne se
  // modère pas — il n'y a pas de « groupe » pour porter un rôle, donc pas
  // de dérogation possible. Sans cette règle, le moteur de démo laissait
  // supprimer les messages d'autrui (aucune règle = tout permis), ce que
  // la base n'autorise jamais.
  direct_messages: (row: Row, me: string): boolean => row.author_id === me,

  // `pm_delete` (027) : quitter soi-même, ou administrer le projet.
  project_members: (row: Row, me: string, store: DemoStore): boolean =>
    row.user_id === me || administersProject(store, row.project_id, me),

  // `group_members_delete` (005, étendue en 020) : partir soi-même, être
  // créateur, ou être l'équipe visant un **membre simple**. La clause
  // `role = 'member'` de la politique porte sur la ligne visée : un
  // modérateur ne purge ni un autre modérateur, ni le propriétaire.
  group_members: (row: Row, me: string, store: DemoStore): boolean =>
    row.user_id === me ||
    store.groups.find((g) => g.id === row.group_id)?.created_by === me ||
    (row.role === "member" && isStaff(store, row.group_id, me)),

  // `community_members_delete` (028) : partir soi-même, ou être retiré par
  // l'équipe. Comme pour les groupes, un modérateur ne peut pas retirer un
  // autre modérateur ni le propriétaire — l'équipe ne se purge pas.
  community_members: (row: Row, me: string, store: DemoStore): boolean =>
    row.user_id === me || isCommunityStaff(store, row.community_id, me),

  // `communities_delete` (028) : le créateur, et lui seul. Supprimer une
  // communauté n'emporte pas ses posts (`on delete set null`) : seul le
  // rayon ferme, les textes restent.
  communities: (row: Row, me: string): boolean => row.created_by === me,

  // `extensions_delete` (029) : l'auteur, et lui seul. Retirer une extension
  // emporte ses installations (`on delete cascade`) : les lignes
  // d'installation deviennent des références à rien.
  extensions: (row: Row, me: string): boolean => row.owner_id === me,

  // `reports` n'a **aucune** politique de suppression (011, §5) — et
  // c'est délibéré : un signalement est la trace d'un fait, il se
  // classe, il ne disparaît pas. Sans politique, Postgres rend la
  // table invisible au `delete` : l'opération réussit et ne touche
  // rien. Le démo reproduit ce silence — un refus bruyant serait un
  // écart de forme, mais un delete qui réussirait serait un écart de
  // fond : la trace aurait disparu.
  reports: (): boolean => false,
};

/**
 * Politiques de **mise à jour** par ligne.
 *
 * La RLS de `group_members` (005, réécrite en 020) donne la mise à jour
 * au seul créateur du groupe : c'est lui qui nomme et retire les
 * modérateurs. Un `update` hors de sa portée est **silencieusement**
 * ignoré, comme en base — et l'écran doit lire l'état réel pour
 * l'annoncer, pas deviner.
 */
const UPDATE_ROW_RULES: Record<string, (row: Row, me: string, store: DemoStore) => boolean> = {
  // 037 : `users_update` (001) n'autorisait que la ligne de soi, et laissait
  // donc `verified` écrivable par son propre titulaire. On ajoute la branche
  // administrateur — elle porte les décisions de vérification. La règle dit
  // la **ligne** ; dire que `verified` ne s'écrit que par un administrateur
  // est le travail du garde-fou de colonnes, plus haut.
  users: (row: Row, me: string, store: DemoStore): boolean =>
    row.id === me || isAdmin(store, me),

  group_members: (row: Row, me: string, store: DemoStore): boolean =>
    store.groups.find((g) => g.id === row.group_id)?.created_by === me,

  // `extensions_update` (029) : l'auteur, et lui seul. Personne d'autre
  // n'édite le manifeste d'une extension — on ne réécrit pas le travail d'un
  // autre sur la place de marché.
  extensions: (row: Row, me: string): boolean => row.owner_id === me,

  // `dm_update` (005) : l'auteur corrige son propre message. La politique
  // existe depuis la 005 ; c'est la borne de colonnes de la 041 qui empêche
  // d'en faire autre chose qu'une correction.
  direct_messages: (row: Row, me: string): boolean => row.author_id === me,

  // `pm_update` réécrite en 027 : seuls propriétaire et mainteneurs
  // règlent les rôles. Un editor écrit du code, il n'administre pas.
  project_members: (row: Row, me: string, store: DemoStore): boolean =>
    administersProject(store, row.project_id, me),

  // `projects_update` (004) : le créateur, ou un membre qui écrit —
  // editor et au-dessus. On ne rejoue pas la branche « visibilité / groupe
  // » de `can_write_project` : le démo ne modélise pas encore le
  // rattachement d'un projet à un groupe pour l'écriture.
  projects: (row: Row, me: string, store: DemoStore): boolean => {
    if (row.created_by === me) return true;
    const role = roleInProject(store, row.id, me);
    return role === "owner" || role === "maintainer" || role === "editor";
  },

  // `community_members_update` (028) : l'équipe règle les rôles. Même
  // frontière que les groupes — un membre s'en va, il ne se promeut pas.
  community_members: (row: Row, me: string, store: DemoStore): boolean =>
    isCommunityStaff(store, row.community_id, me),

  // `communities_update` (028) : l'équipe. Un membre lit le fil, il n'en
  // réécrit ni le règlement ni la visibilité.
  communities: (row: Row, me: string, store: DemoStore): boolean =>
    isCommunityStaff(store, row.id, me),
};

/**
 * Politiques d'**insertion** par ligne.
 *
 * `group_members_insert` (005) : on ne rejoint un groupe qu'en tant que
 * `member`, et c'est la ligne **de soi** (`auth.uid() = user_id`). Seul
 * le créateur du groupe écrit une adhésion d'un autre rôle — et il ne
 * le fait qu'en réglant le rôle de quelqu'un d'autre, jamais en
 * s'auto-promuant : sa ligne existe déjà, le moteur refuserait la clé.
 */
const INSERT_ROW_RULES: Record<string, (candidate: Row, me: string, store: DemoStore) => boolean> = {
  group_members: (candidate: Row, me: string, store: DemoStore): boolean =>
    candidate.user_id === me &&
    (candidate.role === "member" ||
      store.groups.find((g) => g.id === candidate.group_id)?.created_by === me),

  // `projects_insert` (004) : le créateur du projet est l'appelant.
  projects: (candidate: Row, me: string): boolean =>
    candidate.created_by === me,

  // `pm_self` (004) permet d'ajouter sa propre ligne ; `pm_manage_insert`
  // (027) y ajoute l'invitation par un administrateur. Les deux politiques
  // de la base sont permissives et donc cumulées — on fait pareil ici.
  project_members: (candidate: Row, me: string, store: DemoStore): boolean =>
    candidate.user_id === me || administersProject(store, candidate.project_id, me),

  // `community_members_insert` (028) : on rejoint **soi-même** en tant que
  // `member`, ou l'équipe ajoute quelqu'un. On ne s'auto-promeut jamais :
  // la ligne de soi n'existe pas encore, le premier `join` pose `member`.
  community_members: (candidate: Row, me: string, store: DemoStore): boolean =>
    (candidate.user_id === me && candidate.role === "member") ||
    isCommunityStaff(store, candidate.community_id, me),

  // `extensions_insert` (029) : on ne publie un manifeste que sous son propre
  // nom — `auth.uid() = owner_id`.
  extensions: (candidate: Row, me: string): boolean => candidate.owner_id === me,

  // `extension_installs_insert` (029) : on n'installe que **pour soi**. La
  // ligne est la sienne, comme un signet ou une adhésion.
  extension_installs: (candidate: Row, me: string): boolean =>
    candidate.user_id === me,
};

/**
 * Découpe une chaîne `or` de PostgREST en clauses.
 *
 * On ne coupe que sur les virgules **de premier niveau** : une liste
 * `in.(a,b,c)` contient ses propres virgules, et un découpage naïf
 * produirait trois clauses dont deux sont du bruit. Le parenthésage est
 * donc compté, comme le fait PostgREST.
 */
function splitClauses(syntax: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of syntax) {
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") depth--;

    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());

  return out.filter(Boolean);
}

/** Traduit une clause `col.op.valeur` en filtre de ligne. */
function parseClause(clause: string): (r: Row) => boolean {
  const cut1 = clause.indexOf(".");
  if (cut1 < 0) {
    throw new Error(`clause "or" invalide : "${clause}" (colonne.op.valeur attendu)`);
  }
  const col = clause.slice(0, cut1);

  const cut2 = clause.indexOf(".", cut1 + 1);
  // Pas de troisième point : c'est `col.op` avec une valeur vide, ce qui
  // est légitime pour `is.null` et pour rien d'autre.
  const op = cut2 < 0 ? clause.slice(cut1 + 1) : clause.slice(cut1 + 1, cut2);
  const raw = cut2 < 0 ? "" : clause.slice(cut2 + 1);

  switch (op) {
    case "eq":
      return (r) => sameValue(r[col], raw);
    case "neq":
      return (r) => !sameValue(r[col], raw);
    case "is":
      return (r) => (r[col] ?? null) === (raw === "null" ? null : raw);
    case "ilike":
      return (r) => ilikeToRegExp(raw).test(String(r[col] ?? ""));
    case "like":
      return (r) => new RegExp(ilikeToRegExp(raw).source).test(String(r[col] ?? ""));
    case "gt":
      return (r) => compare(r[col], raw) > 0;
    case "gte":
      return (r) => compare(r[col], raw) >= 0;
    case "lt":
      return (r) => compare(r[col], raw) < 0;
    case "lte":
      return (r) => compare(r[col], raw) <= 0;
    case "in": {
      // `in.(a,b,c)` — la liste est entre parenthèses.
      const list = raw.replace(/^\(|\)$/g, "").split(",").map((v) => v.trim());
      return (r) => list.some((v) => sameValue(r[col], v));
    }
    case "contains": {
      const list = raw.replace(/^\{|\}$/g, "").split(",").map((v) => v.trim());
      const arr = (r: Row) => (Array.isArray(r[col]) ? (r[col] as unknown[]) : []);
      return (r) => list.every((v) => arr(r).some((item) => sameValue(item, v)));
    }
    case "overlaps": {
      const list = raw.replace(/^\{|\}$/g, "").split(",").map((v) => v.trim());
      const arr = (r: Row) => (Array.isArray(r[col]) ? (r[col] as unknown[]) : []);
      return (r) => list.some((v) => arr(r).some((item) => sameValue(item, v)));
    }
    default:
      throw new Error(`opérateur inconnu dans "or" : "${op}"`);
  }
}

/**
 * Contraintes `check … in (…)`, par table et par colonne.
 *
 * Ce ne sont pas des énumérations de confort : elles **définissent** ce
 * que la base accepte. Sans elles, le mode démo accepterait un motif
 * `harassment2` que Postgres refuserait, et l'écran afficherait un
 * signalement que la production ne pourra jamais enregistrer — l'écart
 * n'apparaîtrait qu'au moment de basculer.
 *
 * `kind` de `notifications` et `role` de `group_members` en dépendent
 * aussi, mais ces deux tables ont déjà leur propre chemin d'écriture
 * (`CLIENT_CANT_INSERT` pour l'une, la politique du groupe pour
 * l'autre), donc on ne les liste pas ici : on ne simulerait deux fois
 * la même règle, et deux copies divergent.
 */
const ENUM_CHECKS: Record<string, Record<string, string[]>> = {
  reports: {
    reason: ["harassment", "spam", "hate", "scam", "other"],
    status: ["open", "resolved", "dismissed"],
  },
  // Mêmes listes que la migration 018 : sans elles, la démo accepterait
  // une réaction au message « heart » que l'écran ne sait pas afficher,
  // ou un `target_type` qui ne désigne aucune table.
  message_reactions: {
    target_type: ["direct_message", "group_message"],
    emoji: ["\u2705", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F525}"],
  },
  message_pins: {
    target_type: ["direct_message", "group_message"],
  },
  // Mêmes listes que la migration 028. Sans ces contrôles, la démo
  // accepterait une visibilité que l'écran ne sait pas rendre, ou un rôle
  // que `community_role()` ne compare jamais.
  communities: {
    visibility: ["public", "restricted", "private"],
  },
  community_members: {
    role: ["owner", "moderator", "member"],
  },
  // Même liste que le `check` de la 029. Sans elle, la démo accepterait une
  // catégorie que l'écran ne sait pas ranger ni rendre (un onglet fantôme),
  // et que Postgres refuserait à la bascule.
  extensions: {
    category: ["theme", "snippets", "language", "tool", "other"],
  },
  // Même liste que le `check` de la 030. Un état libre serait un état que
  // l'écran ne sait pas rendre — donc « active » ou « en erreur » selon la
  // façon dont le composant tombe, jamais ce que la donnée dit.
  github_connections: {
    status: ["active", "pending", "error"],
  },
};

/**
 * Colonnes que le moteur remplit seul, après insertion.
 *
 * Postgres les remplit aussi — soit par une **valeur par défaut**, soit
 * par une colonne **générée**. Sans cela, le démo renvoie une ligne à
 * laquelle il manque la moitié de son information : `status` vaudrait
 * `undefined` au lieu de `open`, et `target_type` n'existerait pas du
 * tout. L'écran afficherait alors « undefined », ce qui n'est pas un
 * défaut d'affichage mais une divergence entre les deux modes.
 *
 * `target_type` va plus loin qu'une valeur par défaut : en base c'est une
 * colonne **générée**, donc le client ne peut pas l'écrire. On l'écrase
 * donc ici sans condition, et le calcul ne lit que les quatre clés
 * étrangères — la même déduction que le `case` de la migration.
 */
const DERIVED_AFTER_INSERT: Record<string, (row: Row) => void> = {
  /**
   * Les valeurs par défaut de la migration 013.
   *
   * Postgres les applique au client qu'elles soient nommées ou non. Sans
   * ce rejeu, une issue insérée sans `status` naissait avec `undefined` :
   * elle n'était ni ouverte ni fermée, n'apparaissait dans aucun compteur,
   * et l'écran la montrait sans aucune marque d'état. Aucun message
   * d'erreur — la ligne était simplement fausse.
   *
   * `??=` et non `=`: une valeur explicitement envoyée par le client
   * gagne toujours, comme en base.
   */
  issues: (row) => {
    row.status ??= "open";
    row.body ??= "";
    row.number ??= null;
    row.closed_at ??= null;
    row.closed_by ??= null;
    row.updated_at ??= row.created_at;
  },
  issue_comments: (row) => {
    row.updated_at ??= row.created_at;
  },
  /**
   * Les valeurs par défaut de la migration 014.
   *
   * Mêmes raisons que pour `issues` : sans ce rejeu, une demande insérée
   * sans `status` naissait avec `undefined` — ni ouverte, ni fusionnée,
   * absente de tout compteur, et affichée sans marque d'état. Aucune
   * erreur, une ligne fausse.
   */
  pull_requests: (row) => {
    row.status ??= "ouverte";
    row.body ??= "";
    row.number ??= null;
    row.merged_at ??= null;
    row.merged_by ??= null;
    row.closed_at ??= null;
    row.updated_at ??= row.created_at;
  },
  /**
   * Les valeurs par défaut de la migration 015.
   *
   * Mêmes raisons que pour `issues` : une page insérée sans `position`
   * naîtrait avec `undefined`, donc hors de tout tri — et le sommaire
   * s'arrêterait de bouger. `updated_at` suit `created_at` à la
   * naissance, comme le ferait la colonne par défaut.
   */
  project_pages: (row) => {
    row.body ??= "";
    row.position ??= 0;
    row.updated_at ??= row.created_at;
  },
  /**
   * Les valeurs par défaut de la migration 018 (`stories`).
   *
   * `expires_at` vaut `now() + 24 h` en base. Sans ce rejeu, une story
   * insérée en démo naissait avec `expires_at` `undefined`, donc
   * immédiatement retirée par `READ_RULES.stories` — elle disparaissait à
   * la seconde où on la publiait, sans aucune erreur. C'est la divergence
   * la plus trompeuse du lot : « publier une story ne fait rien ».
   */
  stories: (row) => {
    row.caption ??= "";
    row.media_url ??= "";
    row.expires_at ??= new Date(Date.now() + 24 * 3_600_000).toISOString();
  },
  /**
   * Les valeurs par défaut de la migration 019 (`project_sessions`).
   *
   * `seen_at` vaut `now()` en base. Sans ce rejeu, une session inscrite
   * sans horodatage naîtrait avec `seen_at` `undefined`, donc **périmée à
   * la seconde** : la présence qu'on vient d'annoncer ne s'afficherait
   * nulle part. C'est le même piège que `stories.expires_at`, et le même
   * symptôme — « je suis là » qui ne fait rien.
   */
  project_sessions: (row) => {
    row.seen_at ??= new Date().toISOString();
    row.file_path ??= "";
    row.cursor ??= {};
    row.color ??= "";
  },
  reports: (row) => {
    row.target_type =
      row.post_id != null ? "post"
      : row.comment_id != null ? "comment"
      : row.message_id != null ? "group_message"
      : "user";
    row.status ??= "open";
    row.resolved_at ??= null;
    row.details ??= "";
  },
  /**
   * Les valeurs par défaut de la migration 025.
   *
   * `root_project_id` vaut la source si la source n'est pas elle-même un
   * fork — le parent et la racine coïncident. Comme en base, la racine
   * est un fait de l'arbre, pas une donnée que l'écran fournit.
   */
  project_forks: (row) => {
    row.source_branch ??= "main";
    row.source_sha ??= "";
    row.root_project_id ??= row.source_id;
    row.forked_at ??= row.created_at ?? new Date().toISOString();
  },
  project_ratings: (row) => {
    row.created_at ??= new Date().toISOString();
  },
  /**
   * Les valeurs par défaut de la migration 041 (`direct_messages`).
   *
   * Sans ce rejeu, un message envoyé sans `is_code` naîtrait avec la
   * colonne absente : l'écran le lirait comme faux (donc juste), mais la
   * ligne ne serait pas identique à celle que Postgres renvoie. La
   * différence deviendrait visible le jour où un tri ou un filtre
   * porterait sur la colonne.
   */
  direct_messages: (row) => {
    row.is_code ??= false;
    row.edited_at ??= null;
  },
  /**
   * Les valeurs par défaut de la migration 028 (`communities`).
   *
   * Sans ce rejeu, une communauté insérée sans `rules` ou `visibility`
   * naîtrait avec `undefined` : le règlement s'afficherait « undefined » et
   * `canReadCommunity` lirait une visibilité qui n'en est pas une.
   */
  communities: (row) => {
    row.description ??= "";
    row.rules ??= "";
    row.icon ??= "globe";
    row.visibility ??= "public";
    row.member_count ??= 0;
  },
  /**
   * Les valeurs par défaut de la migration 030 (`github_connections`).
   *
   * `connectGithub` (004) n'envoyait que `login` et `token_ref` : sans ce
   * rejeu, une connexion insérée ainsi naissait avec `scopes` `undefined`,
   * et l'écran plantait sur `scopes.join` — ou, avec les colonnes de la
   * 030, affichait un état et un `metadata` qui n'en sont pas. On rejoue
   * donc ici ce que Postgres pose seul : `provider`, les tableaux vides et
   * l'état `active`.
   */
  github_connections: (row) => {
    row.provider ??= "github";
    row.external_id ??= "";
    row.avatar_url ??= "";
    row.scopes ??= [];
    row.token_ref ??= "";
    row.endpoint ??= "";
    row.status ??= "active";
    row.used_at ??= null;
    row.metadata ??= {};
  },

  /**
   * Les valeurs par défaut de la migration 004 (`projects`).
   *
   * Un projet créé sans ces champs aurait `undefined` affiché dans la liste.
   * `visibility` vaut `group` par défaut, `default_branch` vaut `main`,
   * `stage` vaut `idea`, `emoji` vaut `package`.
   */
  projects: (row) => {
    row.visibility ??= "group";
    row.default_branch ??= "main";
    row.stage ??= "idea";
    row.emoji ??= "package";
    row.description ??= "";
    row.language ??= "";
    row.seeking ??= false;
    row.demand_languages ??= [];
    row.demand_roles ??= [];
    row.slug ??= (row.name as string | undefined)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    row.created_at ??= new Date().toISOString();
  },
};

/**
 * Les cascades de suppression, telles que les déclare le schéma.
 *
 * `{ table } : [ { table: enfant, fk: colonne qui pointe } ]`.
 */
const CASCADE: Record<string, { table: string; fk: string }[]> = {
  issues: [{ table: "issue_comments", fk: "issue_id" }],
  // Migration 025 : supprimer un projet emporte ses forks déclarés et
  // ses notations — `on delete cascade` des deux tables. Sans ce rejeu,
  // un projet supprimé laisserait des forks orphelins que les écrans
  // reliraient comme des enfants vivants.
  projects: [
    { table: "project_forks", fk: "source_id" },
    { table: "project_ratings", fk: "project_id" },
  ],
  project_forks: [{ table: "project_forks", fk: "fork_id" }],
  // Migration 028 : supprimer une communauté emporte ses adhésions
  // (`on delete cascade`). Ses posts, eux, survivent — voir `SET_NULL`.
  communities: [{ table: "community_members", fk: "community_id" }],
  // Migration 029 : retirer une extension emporte ses installations. Sans ce
  // rejeu, les lignes d'installation resteraient, pointant vers une extension
  // qui n'existe plus — et le compteur de la personne compterait une
  // extension fantôme.
  extensions: [{ table: "extension_installs", fk: "extension_id" }],
};

/**
 * Les `on delete set null` du schéma.
 *
 * Une cascade **supprime** l'enfant ; un `set null` le **détache**. La
 * nuance porte tout le sens de `posts.community_id` (028) : fermer un
 * rayon ne détruit pas ce qu'on y avait publié, cela le rend orphelin de
 * rayon. Sans ce rejeu, supprimer une communauté en démo laisserait des
 * posts pointant vers un identifiant disparu — un fil qui afficherait une
 * communauté absente.
 *
 * `{ table } : [ { table: enfant, fk: colonne à vider } ]`.
 */
const SET_NULL: Record<string, { table: string; fk: string }[]> = {
  communities: [{ table: "posts", fk: "community_id" }],
};

/**
 * Les index uniques **partiels**, tels que le schéma les déclare.
 *
 * `{ colonnes, ou }` : l'unicité ne porte que sur les lignes qui
 * satisfont `ou`. Sans ce rejeu, la démo autorisait deux demandes
 * ouvertes pour la même branche vers la même destination — exactement ce
 * que `pull_requests_one_open_per_branch_idx` interdit en base. La
 * démo aurait alors montré une liste que le vrai produit ne peut pas
 * produire, et l'écart serait apparu le jour de la bascule.
 */
const UNIQUE_PARTIEL: Record<string, { colonnes: string[]; ou: (row: Row) => boolean }> = {
  pull_requests: {
    colonnes: ["project_id", "source_branch", "target_branch"],
    ou: (row) => row.status === "ouverte",
  },
};

/**
 * Les tables dont le numéro est calculé par un déclencheur.
 *
 * `assign_issue_number` et `assign_pull_request_number` font la même
 * chose : `max + 1` dans le projet concerné, **uniquement** si la
 * colonne est vide. Le rejeu est ici plutôt que dans les valeurs par
 * défaut, parce qu'un numéro se calcule sur les lignes déjà présentes —
 * ce qu'une valeur par défaut, appliquée ligne à ligne, ne peut pas
 * faire.
 */
const NUMEROTEES: Record<string, { par: string }> = {
  issues: { par: "project_id" },
  pull_requests: { par: "project_id" },
};

/** Le prochain numéro d'un groupe, d'après les lignes déjà enregistrées. */
function prochainNumero(rows: Row[], par: string, groupe: string): number {
  return (
    rows.reduce((max, r) => {
      if (String(r[par]) !== groupe) return max;
      const n = Number(r.number ?? 0);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0) + 1
  );
}

/** Vrai si une ligne viole la clé primaire déclarée de sa table. */
function violatesKey(table: string, rows: Row[], candidate: Row): boolean {
  const cols = COMPOSITE_KEYS[table];
  if (!cols) {
    // Table à `id` simple : c'est le comportement par défaut du store.
    return candidate.id !== undefined && rows.some((r) => r.id === candidate.id);
  }
  return rows.some((r) => cols.every((c) => r[c] === candidate[c]));
}

/** Message d'erreur aligné sur ce que renvoie Postgres. */
function duplicateKeyError(table: string): { message: string } {
  const cols = COMPOSITE_KEYS[table];
  return {
    message: cols
      ? `duplicate key value violates unique constraint "${table}_pkey"`
      : `duplicate key value violates unique constraint "${table}_pkey"`,
  };
}

/** Convertit `%abc%` en motif regex insensible à la casse (sémantique `ilike`). */
function ilikeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
}

/**
 * Constructeur de requête chaînable, aligné sur l'API `supabase-js`.
 *
 * Chaque méthode renvoie `this` pour permettre le chaînage ; la requête
 * n'est exécutée qu'au `then()` (ou via `.single()` / `.maybeSingle()`).
 *
 * Le paramètre `S` décrit ce que `await` résout : `Row[]` par défaut, `Row`
 * après un `.single()`. Sans cela, le code applicatif devrait multiplier les
 * `as unknown as`, exactement comme il le fait avec le vrai client.
 */
class Query<S = Row[]> {
  private table: string;
  private op: "select" | "insert" | "update" | "upsert" | "delete";
  private payload: Row | Row[] | null = null;
  private selectSpec: string | null = null;

  /**
   * `count` a-t-il été demandé, et à quelle justesse ?
   *
   * Seul `"exact"` est implémenté. `"planned"` et `"estimated"` sont des
   * estimations, et une estimation affichée comme un compte est un
   * mensonge plus difficile à diagnostiquer qu'une absence : le nombre
   * semble juste, il est seulement faux.
   */
  private countMode?: "exact" | "planned" | "estimated";

  /** `head: true` — ne renvoyer que le compte, aucune ligne. */
  private headOnly = false;
  private filters: Filter[] = [];
  /**
   * Groupes `or`. Ils sont **distincts** de `filters`, et c'est
   * volontaire : dans PostgREST, `.eq(a).or(b,c)` vaut
   * `a AND (b OR c)`, pas `a AND b OR c`. Mélanger les deux dans une
   * seule liste aplatirait la precedence et élargirait le résultat — on
   * verrait des lignes qu'aucun des modes ne devrait produire.
   */
  private orGroups: Filter[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private max: number | null = null;
  private wantSingle: "single" | "maybeSingle" | null = null;
  private returning = false;
  private conflictCol = "id";

  constructor(table: string, op: "select" | "insert" | "update" | "upsert" | "delete") {
    this.table = table;
    this.op = op;
  }

  select(spec = "*", options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): this {
    this.selectSpec = spec;
    // `count` et `head` sont deux demandes **différentes** :
    //
    //  · `head: true` renvoie **aucune** ligne, seulement le compte ;
    //  · `count: "exact"` renvoie les lignes **et** le compte.
    //
    // Le compte est pris sur toutes les lignes qui correspondent aux
    // filtres, **avant** le `limit` — c'est ce qui permet à un bouton
    // « charger plus » de savoir qu'il reste des lignes.
    //
    // Sans cela, un compteur renvoyait zéro en démonstration et la vraie
    // valeur en production : l'écran affiche « 0 » et l'on en conclut
    // qu'il n'y a rien, alors que la base en compte.
    if (options?.count) this.countMode = options.count;
    if (options?.head) this.headOnly = true;
    this.returning = true;
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.op = "insert";
    this.payload = payload;
    this.returning = true;
    return this;
  }

  /**
 * `upsert(payload, { onConflict })`.
 *
 * `onConflict` nomme la colonne de unicité (toujours `id` chez nous) :
 * la ligne qui la porte est mise à jour, sinon elle est insérée.
 */
  upsert(payload: Row | Row[], options?: { onConflict?: string }): this {
    this.op = "upsert";
    this.conflictCol = options?.onConflict ?? "id";
    this.payload = payload;
    this.returning = true;
    return this;
  }

  update(payload: Row): this {
    this.op = "update";
    this.payload = payload;
    this.returning = true;
    return this;
  }

  delete(): this {
    this.op = "delete";
    this.returning = true;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push((r) => sameValue(r[col], val));
    return this;
  }

  neq(col: string, val: unknown): this {
    this.filters.push((r) => !sameValue(r[col], val));
    return this;
  }

  /**
   * Comparaisons de bornes. Postgres compare selon le type de la colonne ;
   * on fait de même en distinguant les nombres du reste.
   */
  gte(col: string, val: unknown): this {
    this.filters.push((r) => compare(r[col], val) >= 0);
    return this;
  }

  lte(col: string, val: unknown): this {
    this.filters.push((r) => compare(r[col], val) <= 0);
    return this;
  }

  /** Strictement supérieur — la borne de la pagination par curseur. */
  gt(col: string, val: unknown): this {
    this.filters.push((r) => compare(r[col], val) > 0);
    return this;
  }

  /**
   * Strictement inférieur — l'autre borne de la pagination par curseur.
   *
   * C'est ce couple `lt`/`gt` qui remplace les `offset`/`limit` en dur :
   * un curseur sur `created_at` reste correct quand un post est publié
   * pendant qu'on parcourt la liste, là où un décalage fait sauter une
   * ligne ou en répéter une.
   */
  lt(col: string, val: unknown): this {
    this.filters.push((r) => compare(r[col], val) < 0);
    return this;
  }

  /** `in` : la colonne est égale à l'une des valeurs listées. */
  in(col: string, vals: unknown[]): this {
    this.filters.push((r) => vals.some((v) => sameValue(r[col], v)));
    return this;
  }

  /** `ilike` avec jokers SQL `%` et `_`, insensible à la casse. */
  ilike(col: string, pattern: string): this {
    const re = ilikeToRegExp(pattern);
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }

  /**
   * `like` avec jokers SQL `%` et `_`, **sensible** à la casse.
   *
   * Distinction nécessaire : le moteur démo sert aussi de référence pour ce
   * que fait Postgres, et un `like` qui se comporterait comme un `ilike`
   * ferait diverger les deux modes sur des requêtes de tri, de recherche ou
   * de suppression ciblée.
   */
  like(col: string, pattern: string): this {
    const re = ilikeToRegExp(pattern);
    const cased = new RegExp(re.source, "");
    this.filters.push((r) => cased.test(String(r[col] ?? "")));
    return this;
  }

  /** `contains` : toutes les valeurs doivent être présentes dans le tableau stocké. */
  contains(col: string, vals: unknown[]): this {
    this.filters.push((r) => {
      const arr = Array.isArray(r[col]) ? (r[col] as unknown[]) : [];
      return vals.every((v) => arr.some((item) => sameValue(item, v)));
    });
    return this;
  }

  /**
   * `overlaps` : les deux ensembles ont au moins un élément commun.
   *
   * C'est le pendant de `contains` pour une recherche par hashtag : on ne
   * veut pas un post dont la liste de tags contient *tous* les tags
   * cherchés, mais un post qui en partage **au moins un**. Confondre les
   * deux fait qu'une recherche à deux hashtags ne rend rien.
   */
  overlaps(col: string, vals: unknown[]): this {
    this.filters.push((r) => {
      const arr = Array.isArray(r[col]) ? (r[col] as unknown[]) : [];
      return vals.some((v) => arr.some((item) => sameValue(item, v)));
    });
    return this;
  }

  /**
   * `is` : comparaison avec `null`, que `eq` ne sait pas faire.
   *
   * `eq(col, null)` se lirait comme `col === null` en JavaScript, alors
   * que PostgREST l'interprète comme `col IS NULL`. Les deux ne
   * coïncident pas : `undefined !== null` en JavaScript, donc une
   * recherche sur une colonne absente ne passerait pas. D'où une méthode
   * dédiée plutôt qu'un `eq` piegeux.
   */
  is(col: string, val: null): this {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }

  /**
   * `not` : négation d'un filtre.
   *
   * Deux formes, parce que les deux existent côté `supabase-js` :
   *  - `.not()` sans argument nie le **dernier** filtre — la forme que
   *    l'application utilise après un `or` ;
   *  - `.not(col, op, val)` nie une clause **à trois termes**, comme
   *    `.not("community_id", "is", null)` (migration 028 : le fil ne
   *    montre que les publications rattachées à une communauté). Sans
   *    cette seconde forme, la démo ignorerait le filtre et afficherait
   *    des publications sans communauté — un écart que la production
   *    n'aurait pas.
   */
  not(column?: string, operator?: string, value?: unknown): this {
    if (column !== undefined && operator !== undefined) {
      const raw = value === null ? "null" : String(value ?? "");
      this.filters.push((r) => !parseClause(`${column}.${operator}.${raw}`)(r));
      return this;
    }

    const last = this.filters[this.filters.length - 1];
    if (last) {
      this.filters[this.filters.length - 1] = (r) => !last(r);
    }
    return this;
  }

  /**
   * `or` : alternative entre plusieurs filtres, avec la syntaxe PostgREST.
   *
   *   .or("pseudo.ilike.%koffi%,prenom.ilike.%koffi%")
   *
   * On respecte la syntaxe du vrai client plutôt que d'inventer une
   * signature plus jolie : l'application écrit la même chaîne dans les
   * deux modes, donc il n'y a qu'une forme à maintenir. Et surtout, une
   * recherche qui diverge entre démo et production est le pire des deux
   * mondes — elle semble marcher, puis échoue le jour J.
   *
   * On ne couvre que les opérateurs utilisés ici (`eq`, `neq`, `ilike`,
   * `like`, `gt`, `gte`, `lt`, `lte`, `is`, `in`, `overlaps`,
   * `contains`). Un opérateur inconnu lève une erreur plutôt que de
   * Ignorer silencieusement la clause : un filtre qu'on croit poser et
   * qui ne l'est pas élargirait le résultat au lieu de le restreindre.
   */
  or(syntax: string): this {
    const clauses = splitClauses(syntax).map(parseClause);
    this.orGroups.push((r) => clauses.some((f) => f(r)));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  limit(n: number): this {
    this.max = n;
    return this;
  }

  single(): Query<Row> {
    this.wantSingle = "single";
    return this as unknown as Query<Row>;
  }

  maybeSingle(): Query<Row | null> {
    this.wantSingle = "maybeSingle";
    return this as unknown as Query<Row | null>;
  }

  /**
   * Exécute la requête au `await` (ou via `.then()`).
   *
   * Le type résolu est `Result<S>` : `S` vaut `Row[]` normalement et `Row`
   * après un `.single()`, ce qui reproduit le comportement du vrai client.
   */
  then(
    onFulfilled?: ((value: Result<S>) => unknown) | null,
    onRejected?: ((reason: unknown) => never) | null,
  ): PromiseLike<Result<S>> {
    return Promise.resolve()
      .then(() => this.run() as Result<S>)
      .then(onFulfilled, onRejected) as PromiseLike<Result<S>>;
  }

  /** Exécute la requête. `then()` est le point d'entrée de `await`. */
  private run(): Result<Row | Row[] | null> {
    if (!isTable(this.table)) {
      return { data: null, error: { message: `relation "public.${this.table}" does not exist` } };
    }

    // La RLS peut refuser une opération entière, ou une seule. On tranche
    // ici, avant tout accès au store : une écriture refusée ne doit pas
    // non plus laisser croire qu'elle a fonctionné.
    if (this.op !== "select" && CLIENT_CANT_WRITE.has(this.table)) {
      return {
        data: null,
        error: {
          message:
            `write on table "${this.table}" violates row-level security ` +
            "(42501) — l'adhésion est déduite des participants, le client n'écrit pas ici",
        },
      };
    }

    if (this.op === "update" && CLIENT_CANT_UPDATE.has(this.table)) {
      return {
        data: null,
        error: {
          message:
            `update on table "${this.table}" violates row-level security ` +
            "(42501) — un commentaire se supprime et se reposte, il ne se réécrit pas",
        },
      };
    }

    if (
      (this.op === "insert" || this.op === "upsert") &&
      CLIENT_CANT_INSERT.has(this.table)
    ) {
      return {
        data: null,
        error: {
          message:
            `insert on table "${this.table}" violates row-level security ` +
            "(42501) — l'appartenance et la notification sont des faits que le client ne déclare pas",
        },
      };
    }

    // Le droit de mise à jour porte sur les **colonnes**, pas seulement
    // sur la ligne : sans ce refus, un client pourrait réécrire le
    // `kind` ou l'`actor_id` de sa propre notification, et afficher
    // ensuite un fait qu'il s'est attribué.
    if (this.op === "update") {
      // Cas symétrique : une table qui n'ouvre sa mise à jour que sur
      // quelques colonnes refuse **toute** autre colonne, même sur sa
      // propre ligne. C'est la contrepartie du `revoke update (…)`.
      const allowed = UPDATE_ALLOWED_COLUMNS[this.table];
      if (allowed) {
        const patch = (this.payload ?? {}) as Row;
        const hit = Object.keys(patch).filter((c) => !allowed.includes(c));
        if (hit.length > 0) {
          return {
            data: null,
            error: {
              message:
                `permission denied for table "${this.table}" (42501) — ` +
                `colonne${hit.length > 1 ? "s" : ""} non modifiable${hit.length > 1 ? "s" : ""} : ` +
                hit.join(", "),
            },
          };
        }
      }

      const forbidden = UPDATE_FORBIDDEN_COLUMNS[this.table];
      const patch = (this.payload ?? {}) as Row;
      const hit = forbidden?.filter((c) => c in patch);
      if (hit && hit.length > 0) {
        return {
          data: null,
          error: {
            message:
              `permission denied for table "${this.table}" (42501) — ` +
              `colonne${hit.length > 1 ? "s" : ""} non modifiable${hit.length > 1 ? "s" : ""} : ` +
              hit.join(", "),
          },
        };
      }

      // 037 : `verified` et `is_admin` ne sont **jamais** écrits par le
      // compte qu'ils concernent. Sans ce garde-fou, la politique de ligne
      // (« la sienne ou celle d'un administrateur ») suffirait à laisser
      // chacun s'auto-vérifier — et la file d'attente n'aurait aucun sens.
      const denied = this.guardAccountRoles(patch, getStore());
      if (denied) return denied;
    }

    const store = getStore();
    const rows = store[this.table];

    switch (this.op) {
      case "insert":
        return this.runInsert(rows, store);
      case "upsert":
        return this.runUpsert(rows, store);
      case "update":
        return this.runUpdate(rows, store);
      case "delete": {
        // La règle par ligne de la table, si elle existe. Hors session,
        // une table réglée ne supprime rien : `auth.uid()` est `null` et
        // ne vaut aucun auteur ni aucun rôle.
        const deleteRule = DELETE_ROW_RULES[this.table];
        const deleter = loadSessionId();
        const removable = (r: Row): boolean => {
          if (!this.matches(r)) return false;
          if (deleteRule) return deleter !== null && deleteRule(r, deleter, store);
          return true;
        };

        const kept = rows.filter((r) => !removable(r));
        const removed = rows.filter(removable);
        store[this.table] = kept;

        // `on delete cascade`.
        //
        // Postgres emporte les lignes qui pointent vers la ligne
        // supprimée. Sans ce rejeu, les commentaires d'une issue
        // supprimée restaient dans le store : invisibles, donc on ne les
        // voyait pas, mais ils revenaient si l'identifiant d'issue était
        // réutilisé — et ils gonflaient la table à chaque suppression.
        //
        // On ne le fait que pour les relations **déclarées** ici. Une
        // cascade générique déduite des noms serait devinée, donc fausse
        // au moins une fois.
        for (const child of CASCADE[this.table] ?? []) {
          const parentIds = new Set(removed.map((r) => r.id));
          const key = child.table as keyof DemoStore;
          const childRows = store[key] as Row[];
          store[key] = childRows.filter((r) => !parentIds.has(r[child.fk]));
        }

        // `on delete set null` : l'enfant survit, détaché. Voir `SET_NULL`.
        for (const child of SET_NULL[this.table] ?? []) {
          const parentIds = new Set(removed.map((r) => r.id));
          const key = child.table as keyof DemoStore;
          for (const r of store[key] as Row[]) {
            if (parentIds.has(r[child.fk])) r[child.fk] = null;
          }
        }

        // Déclencheur `guard_pull_request_branches` (migration 014).
        //
        // Supprimer une branche ferme ses demandes ouvertes. Sans ce
        // rejeu, la demande restait ouverte et proposait une fusion vers
        // un nom de branche qui n'existe plus : l'écran affichait un
        // bouton « Fusionner » qui échouait, et l'échec disait « rien à
        // fusionner » — un mensonge correct dans la forme, faux dans le
        // fond.
        if (this.table === "git_refs") {
          const noms = new Set(
            removed.filter((r) => r.kind === "branch").map((r) => String(r.name)),
          );

          if (noms.size > 0) {
            const maintenant = new Date().toISOString();

            for (const demande of store.pull_requests) {
              if (
                demande.status !== "ouverte" ||
                !noms.has(String(demande.source_branch))
              ) {
                continue;
              }

              demande.status = "fermee";
              demande.closed_at = demande.closed_at ?? maintenant;
              demande.updated_at = maintenant;
            }
          }
        }

        save(store);
        return { data: this.returning ? removed : null, error: null };
      }
      default:
        return this.runSelect(rows);
    }
  }

  private matches(row: Row): boolean {
    // La RLS d'appartenance s'applique **avant** les filtres de la
    // requête : une ligne qui n'est pas à toi ne t'appartient pas,
    // quel que soit le `eq` qu'on ajoute ensuite. C'est ce qui rend
    // l'ordre des prédicats indifférent.
    const owner = OWNED_BY[this.table];
    if (owner) {
      const me = loadSessionId();
      // Hors session, la lecture est vide — comme en production, où
      // `auth.uid()` est `null` et ne vaut aucun `recipient_id`.
      if (!me || String(row[owner]) !== me) return false;
    }

    // Politique de lecture à prédicat composé.
    const rule = READ_RULES[this.table];
    if (rule) {
      const me = loadSessionId();
      if (!me || !rule(row, me, getStore())) return false;
    }

    // Chaque groupe `or` doit être satisfait **en entier**, comme un
    // filtre à lui seul : c'est lui qui porte les parenthèses.
    return (
      this.filters.every((f) => f(row)) &&
      this.orGroups.every((g) => g(row))
    );
  }

  /** Applique `select` (colonnes + jointures) à un ensemble de lignes. */
  private shape(rows: Row[]): Row[] {
    const spec = this.selectSpec;
    if (!spec) return rows.map((r) => ({ ...r }));

    const { plain, embeds } = parseColumns(spec);
    let out = rows.map((r) => project(r, plain));

    for (const e of embeds) {
      if (!isTable(e.table)) continue;
      const related = getStore()[e.table];
      out = out.map((row) => {
        // Pas de clé étrangère déclarée dans nos jointures : on teste les
        // colonnes de liaison usuelles, dans l'ordre de spécificité.
        // `actor_id` vient en dernier parce qu'une notification porte
        // les trois : c'est l'acteur qu'on veut, jamais le
        // destinataire — une ligne qui afficherait le destinataire
        // mettrait le nom du lecteur partout au lieu de celui qui a
        // écrit.
        const found =
          related.find((u) => u.id === row.user_id) ??
          related.find((u) => u.id === row.author_id) ??
          related.find((u) => u.id === row.actor_id) ??
          // `reporter_id` : un signalement ne porte ni `user_id`, ni
          // `author_id`, ni `actor_id` — sa seule personne est celle
          // qui signale. Sans cette ligne, la jointure ne trouverait
          // rien et l'écran afficherait « un compte supprimé » à côté
          // d'un signalement que quelqu'un a pourtant fait.
          related.find((u) => u.id === row.reporter_id) ??
          // `community_id` : le fil d'une publication joint sa communauté
          // (migration 028). On le teste en dernier : une publication porte
          // à la fois `author_id` et `community_id`, et l'auteur doit
          // gagner — un fil ne s'affiche pas sous le nom de son rayon.
          related.find((u) => u.id === row.community_id) ??
          // `owner_id` : une extension joint son auteur (migration 029). Une
          // extension n'a ni `author_id` ni `user_id`, donc cette ligne ne
          // peut pas voler la place d'un autre rattachement.
          related.find((u) => u.id === row.owner_id) ??
          null;
        return { ...row, [e.alias]: found ? project(found, e.cols.length ? e.cols : null) : null };
      });
    }

    return out;
  }

  private runSelect(rows: Row[]): Result<Row | Row[]> {
    let out = rows.filter((r) => this.matches(r));

    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      out = [...out].sort((a, b) => (asc ? compare(a[col], b[col]) : compare(b[col], a[col])));
    }

    // Le compte est pris **avant** la troncature : c'est le nombre de
    // lignes qui correspondent, pas le nombre de lignes renvoyées. Un
    // `limit(20)` sur dix lignes en donne vingt ; inversé, un compteur
    // plafonnerait à la taille de la page et afficherait « 20 » sur un
    // million de résultats.
    const total = out.length;

    if (this.max !== null) out = out.slice(0, this.max);

    const withCount = <T>(result: { data: T; error: { message: string } | null }) =>
      this.countMode ? { ...result, count: total } : result;

    if (this.headOnly) {
      return withCount({ data: null, error: null });
    }

    const shaped = this.shape(out);

    if (this.wantSingle === "single") {
      if (shaped.length !== 1) {
        return withCount({
          data: null,
          error: { message: "JSON object requested, multiple (or no) rows returned" },
        });
      }
      return withCount({ data: shaped[0], error: null });
    }

    if (this.wantSingle === "maybeSingle") {
      return withCount({ data: shaped[0] ?? null, error: null });
    }

    return withCount({ data: shaped, error: null });
  }

  private runInsert(rows: Row[], store: ReturnType<typeof getStore>): Result<Row[]> {
    const input = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];

    // Déclencheur `assign_issue_number` (migration 013).
    //
    // Le numéro d'une issue est calculé par la base et **jamais** écrit
    // par le client. Sans ce rejeu, le mode démo produirait des issues
    // numérotées « null » : l'écran afficherait « #null » et l'on
    // conclurait que la numérotation est cassée.
    //
    // On respecte aussi la condition du déclencheur SQL — « si la
    // valeur est absente » — parce qu'un numéro fourni est conservé. Ce
    // n'est pas un détail : la base ne recalcule pas un numéro existant,
    // et un rejeu qui l'écraserait renuméroterait tout à l'ouverture.
    if (this.table === "issues") {
      for (const candidate of input) {
        if (candidate.number !== undefined && candidate.number !== null) continue;
        const max = rows
          .filter((r) => r.project_id === candidate.project_id)
          .reduce((n, r) => Math.max(n, Number(r.number ?? 0)), 0);
        candidate.number = max + 1;
      }
    }

    // Contraintes `check` de la migration 005.
    //
    // Seule `follows_no_self` est simulée : on ne se suit pas soi-même.
    // Postgres refuse avec `check_violation` (23514), donc le démo doit
    // refuser aussi — sinon l'écran afficherait un compteur d'abonnés
    // que la base réelle ne produirait jamais, et l'écart se verrait
    // seulement le jour de la bascule.
    // Contrainte `comments_parent_not_self` (migration 018).
    //
    // Un commentaire ne peut pas être sa propre réponse. Le client ne
    // fournit pas d'`id`, donc le cas est rare — mais un `id` explicite
    // le rendrait possible, et la base le refuserait. On refuse ici aussi
    // plutôt que de laisser passer une boucle que le fil ne saurait pas
    // dessiner.
    if (this.table === "comments") {
      for (const candidate of input) {
        if (candidate.parent_id && candidate.parent_id === candidate.id) {
          return {
            data: null,
            error: {
              message:
                'new row for relation "comments" violates check constraint ' +
                '"comments_parent_not_self" (23514)',
            },
          };
        }
      }
    }

    if (this.table === "follows") {
      for (const candidate of input) {
        if (candidate.follower_id === candidate.followee_id) {
          return {
            data: null,
            error: {
              message:
                'new row for relation "follows" violates check constraint "follows_no_self" (23514)',
            },
          };
        }
      }
    }

    // Contraintes de la migration 011 (`reports`).
    //
    // Une ligne de signalement porte **exactement une** cible, et ne
    // peut pas viser son propre auteur. Les deux sont refusées ici avec
    // le message que Postgres renverrait : le mode démo doit refuser ce
    // que la base refuse, sinon la démonstration autorise un envoi que la
    // production refusera — et l'écart ne se verrait qu'au moment de
    // basculer, le plus mauvais moment.
    if (this.table === "reports") {
      const me = loadSessionId();
      const TARGET_COLUMNS = ["post_id", "comment_id", "message_id", "reported_user"];

      // La politique exige `auth.role() = 'authenticated'` **et**
      // `reporter_id = auth.uid()`. Sans session, il n'y a pas d'appelant :
      // une ligne insérée hors session aurait `reporter_id = null`, qu'aucune
      // clé n'accepterait, et le démo laisserait passer une ligne que la
      // base refuse d'abord sur le rôle.
      if (!me) {
        return {
          data: null,
          error: {
            message:
              `insert on table "reports" violates row-level security ` +
              "(42501) — un signalement se porte, on ne le déclare pas",
          },
        };
      }

      for (const candidate of input) {
        const set = TARGET_COLUMNS.filter((c) => candidate[c] !== null && candidate[c] !== undefined);
        if (set.length !== 1) {
          return {
            data: null,
            error: {
              message:
                'new row for relation "reports" violates check constraint ' +
                `"reports_one_target" (23514) — ${set.length} cible(s) sur une ligne`,
            },
          };
        }

        // Se signaler soi-même : la ligne serait lisible par son auteur
        // et immédiatement inoffensive, donc inutile.
        const self =
          (candidate.post_id !== undefined &&
            store.posts.find((p) => p.id === candidate.post_id)?.author_id === me) ||
          (candidate.comment_id !== undefined &&
            store.comments.find((c) => c.id === candidate.comment_id)?.author_id === me) ||
          (candidate.message_id !== undefined &&
            store.group_messages.find((m) => m.id === candidate.message_id)?.author_id === me) ||
          candidate.reported_user === me;

        if (self) {
          return {
            data: null,
            error: {
              message:
                `new row for relation "reports" violates row-level security ` +
                "(42501) — on ne signale pas son propre contenu",
            },
          };
        }

        // Index partiels uniques : un signalement par personne et par
        // cible. Sans ce refus, dix envois du même bouton créeraient dix
        // lignes et le compteur de la file de modération afficherait dix
        // pour un seul contenu signalé.
        //
        // On compare **la seule colonne de cible qui est renseignée**.
        // Comparer les quatre colonnes ferait compter `null === null` comme un
        // doublon — et toute ligne dont la cible n'était pas un post
        // serait refusée dès la deuxième. C'est le genre de faute qui
        // fait qu'une fonctionnalité marche sur un jeu de données et
        // pas sur un autre.
        const target = set[0];
        const already = rows.find(
          (r) =>
            r.reporter_id === candidate.reporter_id &&
            r[target] === candidate[target],
        );
        if (already) {
          return {
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint "reports_unique" (23505)',
            },
          };
        }
      }
    }

    // Énumérations fermées.
    for (const candidate of input) {
      const columns = ENUM_CHECKS[this.table];
      if (!columns) continue;

      for (const [col, allowed] of Object.entries(columns)) {
        const value = candidate[col];
        if (value === undefined || allowed.includes(String(value))) continue;

        return {
          data: null,
          error: {
            message:
              `new row for relation "${this.table}" violates check constraint ` +
              `("${this.table}_${col}_check") (23514) — « ${String(value)} » ` +
              `n'est pas dans (${allowed.join(", ")})`,
          },
        };
      }
    }

    // Politique d'insertion par ligne (migration 020 pour
    // `group_members`). Contrairement à la suppression, l'insertion
    // refusée par la RLS **échoue** — Postgres renvoie l'erreur 42501 —
    // donc le démo échoue aussi, avec le même code.
    // Contrainte d'unicité `unique (user_id, provider)` de la 004, élargie
    // par la 030 : une connexion par fournisseur et par personne. La table
    // a un `id` simple, donc elle n'est pas dans `COMPOSITE_KEYS` (qui
    // remplacerait la clé primaire) — on pose donc la collision ici, avec
    // le nom réel de la contrainte, pour que la couche données la
    // reconnaisse comme elle reconnaît celle de `extension_installs`.
    if (this.table === "github_connections") {
      for (const candidate of input) {
        const fournisseur = candidate.provider ?? "github";
        if (
          rows.some(
            (r) => r.user_id === candidate.user_id && r.provider === fournisseur,
          )
        ) {
          return {
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint ' +
                '"github_connections_user_id_provider_key" (23505)',
            },
          };
        }
      }
    }

    const insertRule = INSERT_ROW_RULES[this.table];
    if (insertRule) {
      const inserter = loadSessionId();
      if (
        inserter === null ||
        !input.every((candidate) => insertRule(candidate, inserter, store))
      ) {
        return {
          data: null,
          error: {
            message:
              `new row for relation "${this.table}" violates row-level security (42501)`,
          },
        };
      }
    }

    // Contrainte de clé primaire : une violation avorte **toute** l'insertion,
    // comme en Postgres. On ne l'écrit donc pas partiellement — un lot
    // partiellement inséré serait un état que le vrai backend ne produit
    // jamais, et l'appelant ne saurait pas le rattraper.
    for (const candidate of input) {
      if (violatesKey(this.table, rows, candidate)) {
        return { data: null, error: duplicateKeyError(this.table) };
      }
    }

    const created: Row[] = input.map((r) => {
      const row: Row = { ...r };
      // Une table de jonction n'a pas d'`id` : lui en fabriquer un
      // produirait une colonne que le vrai schéma ne connaît pas, et le
      // code qui lit la ligne verrait un champ que Postgres ne renvoie
      // jamais. On ne fabrique donc que ce qui existe réellement.
      if (!COMPOSITE_KEYS[this.table]) {
        row.id = r.id ?? newId(this.table.slice(0, 2));
      }
      // `group_members` date l'adhésion par `joined_at`, pas `created_at`.
      const stampCol =
        this.table === "group_members" || this.table === "community_members"
          ? "joined_at"
          : "created_at";
      if (row[stampCol] === undefined) row[stampCol] = new Date().toISOString();

      // Colonnes générées et valeurs par défaut : ce que Postgres ajoute
      // à la ligne sans que le client les dise.
      DERIVED_AFTER_INSERT[this.table]?.(row);
      return row;
    });

    // Déclencheur `assign_issue_number` / `assign_pull_request_number`.
    //
    // Le numéro est attribué **après** la création des lignes du lot et
    // **avant** leur enregistrement, en tenant compte de ce qu'il y a
    // déjà : c'est le seul ordre qui donne « max + 1 » juste. Deux lignes
    // insérées d'un coup reçoivent donc deux numéros distincts.
    const numerotation = NUMEROTEES[this.table];
    if (numerotation) {
      for (const row of created) {
        if (row.number !== null && row.number !== undefined) continue;
        row.number = prochainNumero(rows, numerotation.par, String(row[numerotation.par]));
      }
    }

    rows.push(...created);

    // Index unique partiel : refusé comme Postgres le ferait, avec le
    // nom de l'index — c'est ce nom que la couche données reconnaît pour
    // traduire l'erreur en phrase lisible.
    const partiel = UNIQUE_PARTIEL[this.table];
    if (partiel) {
      for (const row of created) {
        if (!partiel.ou(row)) continue;

        const collision = rows.some(
          (r) =>
            r !== row &&
            partiel.ou(r) &&
            partiel.colonnes.every((c) => r[c] === row[c]),
        );

        if (collision) {
          return {
            data: null,
            error: {
              message: `duplicate key value violates unique constraint "${this.table}_one_open_per_branch_idx"`,
            },
          } as unknown as Result<Row[]>;
        }
      }
    }
    save(store);
    for (const r of created) notify(this.table, "INSERT", r);

    if (!this.returning) return { data: null, error: null };
    const shaped = this.shape(created);
    // `.single()` doit s'appliquer APRÈS une insertion aussi, comme le vrai
    // client : sinon `data` reste un tableau, et l'appelant qui lit
    // `data.id` lit `undefined` — en silence.
    if (this.wantSingle === "single") {
      if (shaped.length !== 1) {
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } } as unknown as Result<Row[]>;
      }
      return { data: shaped[0], error: null } as unknown as Result<Row[]>;
    }
    return { data: shaped, error: null };
  }

  /**
   * Le verrou de colonnes sur `users` (migration 037).
   *
   * `verified` et `is_admin` ne s'écrivent que par un administrateur —
   * jamais par le compte qu'ils concernent, même sur sa propre ligne.
   * La RLS ne peut pas le dire : elle raisonne en **lignes**, et « la
   * mienne » contient `verified`.
   *
   * `verification_status` suit la même règle pour les valeurs qui **décident**
   * (`acceptee`, `refusee`) : l'État se donne un cachet en écrivant `verified`,
   * mais il se donne aussi un statut en écrivant « acceptée » — et l'écran
   * croit le statut. Seules `none` et `attente` restent à portée du compte,
   * parce qu'elles ne sont que des états de demande.
   *
   * Un `upsert` emprunte ce verrou aussi : Postgres exécute bien la
   * branche `update` d'un `on conflict do update`, et le déclencheur
   * 037 s'y applique — rejouer ici, c'est rejouer le même déclencheur.
   *
   * @returns un résultat d'erreur si l'écriture est refusée, sinon `null`.
   */
  private guardAccountRoles(patch: Row, store: DemoStore): Result<Row[]> | null {
    if (this.table !== "users") return null;

    const guarded = ["verified", "is_admin"].filter((c) => c in patch);
    const status = patch.verification_status;
    const decides =
      typeof status === "string" && status !== "none" && status !== "attente";

    if (guarded.length === 0 && !decides) return null;
    if (isAdmin(store, loadSessionId())) return null;

    // Le message suit le déclencheur 037 colonne par colonne : c'est la
    // même phrase que celle que Postgres lèverait en production, donc un
    // rejeu en démo ne raconte pas une autre histoire.
    const reason = guarded.includes("is_admin")
      ? `permission denied for column "is_admin" (42501) — ` +
        "seule l'administration nomme un administrateur"
      : guarded.includes("verified")
        ? `permission denied for column "verified" (42501) — ` +
          "seule l'administration vérifie un compte"
        : `permission denied for column "verification_status" (42501) — ` +
          "la décision revient à l'administration";

    return { data: null, error: { message: reason } };
  }

  private runUpsert(rows: Row[], store: ReturnType<typeof getStore>): Result<Row[]> {
    const input = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    const out: Row[] = [];

    // `onConflict` peut nommer **plusieurs** colonnes : `project_id,path`.
    //
    // Ignorer ce cas n'est pas anodin. `row["project_id,path"]` et
    // `incoming["project_id,path"]` valent tous deux `undefined`, donc la
    // comparaison `===` réussit sur la *première* ligne du tableau : un
    // upsert écrasait silencieusement une autre ligne au lieu de viser la
    // bonne. Concrètement, écrire un fichier dans le dépôt remplaçait un
    // fichier voisin, et l'arborescence perdait un fichier sans erreur.
    const cols = this.conflictCol.split(",").map((c) => c.trim()).filter(Boolean);

    for (const incoming of input) {
      const matches = (row: Row) => cols.every((c) => row[c] === incoming[c]);
      const i = rows.findIndex(matches);

      if (i >= 0) {
        const denied = this.guardAccountRoles(incoming, store);
        if (denied) return denied;
        rows[i] = { ...rows[i], ...incoming };
        out.push(rows[i]);
      } else {
        const created = {
          ...incoming,
          id: incoming.id ?? newId(this.table.slice(0, 2)),
          created_at: incoming.created_at ?? new Date().toISOString(),
        };
        // Même application des valeurs par défaut qu'à l'insertion : un
        // `upsert` est une insertion pour la ligne qui n'existe pas encore.
        DERIVED_AFTER_INSERT[this.table]?.(created);
        rows.push(created);
        out.push(created);
        notify(this.table, "INSERT", created);
      }
    }

    save(store);
    for (const r of out) notify(this.table, "UPDATE", r);

    if (!this.returning) return { data: null, error: null };
    const shaped = this.shape(out);
    if (this.wantSingle === "single") {
      if (shaped.length !== 1) {
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } } as unknown as Result<Row[]>;
      }
      return { data: shaped[0], error: null } as unknown as Result<Row[]>;
    }
    return { data: shaped, error: null };
  }

  /**
   * `Row | Row[]` et non `Row[]` : PostgREST rend un **objet** quand la
   * requête demande `single()` ou `maybeSingle()`, y compris après une
   * mise à jour. Verrouiller le type sur un tableau aurait oblige à
   * mentir sur ce que la requête renvoie réellement.
   */
  private runUpdate(rows: Row[], store: ReturnType<typeof getStore>): Result<Row | Row[]> {
    const patch = (this.payload ?? {}) as Row;
    const touched: Row[] = [];

    // Déclencheur `sync_issue_closure` (migration 013) : la date de
    // fermeture est **dérivée** du statut. Même raison que
    // `reports.resolved_at` : une date écrite par le client est une date
    // que la RLS ne peut pas protéger, et l'écran verrait ensuite une
    // issue « fermée » sans date — un état que la contrainte SQL rend
    // impossible en base.
    if (this.table === "issues") {
      // `closed_at` est traversé plus bas, dans la boucle sur les lignes :
      // il dépend de la ligne **avant** mise à jour, qu'on n'a ici que
      // dans `rows`. La simulation est donc faite au bon endroit.
    }

    // La politique `reports_update` refuse qu'on classe son propre
    // signalement. La lecture, elle, l'autorise : on voit ce qu'on a
    // signalé. C'est donc une règle distincte, appliquée ici — sinon la
    // démo permettrait d'effacer la trace d'un signalement sans qu'elle
    // existe ailleurs.
    if (this.table === "reports" && loadSessionId()) {
      const mine = rows.find(
        (r) => this.matches(r) && r.reporter_id === loadSessionId(),
      );
      if (mine && Object.keys(patch).length > 0) {
        return {
          data: null,
          error: {
            message:
              `update on table "reports" violates row-level security (42501) — ` +
              "on ne classe pas son propre signalement",
          },
        };
      }
    }

    // La règle par ligne de la table, si elle existe. Postgres ignore
    // **silencieusement** les lignes que la politique d'`update` cache —
    // comme pour la suppression, on refuse la ligne, pas l'opération.
    // La règle par ligne de la table, si elle existe. Postgres ignore
    // **silencieusement** les lignes que la politique d'`update` cache —
    // comme pour la suppression, on refuse la ligne, pas l'opération.
    // Énumérations fermées, **à la mise à jour aussi**. Postgres refuse une
    // valeur hors liste quelle que soit l'écriture ; le rejeu d'insertion ne
    // suffisait donc pas — un état absent de la liste entrait par un
    // `update`, et l'écran rendait alors un état qu'aucune valeur connue ne
    // décrit. On ne valide que les colonnes réellement présentes dans le
    // patch : un `update` qui ne touche pas l'état reste permis.
    const enumCols = ENUM_CHECKS[this.table];
    if (enumCols) {
      for (const [col, allowed] of Object.entries(enumCols)) {
        const value = patch[col];
        if (value === undefined || allowed.includes(String(value))) continue;
        return {
          data: null,
          error: {
            message:
              `new row for relation "${this.table}" violates check constraint ` +
              `("${this.table}_${col}_check") (23514) — « ${String(value)} » ` +
              `n'est pas dans (${allowed.join(", ")})`,
          },
        };
      }
    }

    const rowRule = UPDATE_ROW_RULES[this.table];
    const updater = loadSessionId();

    /**
     * Les candidatures qui viennent d'être **acceptées**.
     *
     * Postgres ne fait pas qu'écrire le statut : `applications_accept()`
     * (migration 023) ajoute la personne aux membres **et** pose une
     * preuve. On ne peut le rejouer qu'ici, où l'on voit le statut
     * d'avant et celui d'après ; on le fait donc après la boucle, sur les
     * lignes concernées.
     */
    const accepted: Row[] = [];

    // La mise à jour construit une **nouvelle** ligne au lieu de muter la
    // ligne stockée : `{ ...row, ...patch }`. Un objet déjà prêté à un
    // lecteur (chargé, inséré, notifié) ne doit jamais changer sous lui,
    // à moitié appliqué — l'alias silencieux est le genre de bug qui ne
    // se voit que par un effet de bord, et qui devient invisible en
    // production.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!this.matches(row)) continue;
      if (rowRule && (updater === null || !rowRule(row, updater, store))) continue;
      const next = { ...row, ...patch };

      // Déclencheur `sync_report_resolution` : `resolved_at` est **dérivé**
      // de `status`, jamais écrit par le client. On conserve la date
      // initiale pour qu'un reclassement ne date pas le traitement
      // d'aujourd'hui — c'est ce que fait la fonction SQL.
      if (this.table === "reports" && patch.status !== undefined) {
        next.resolved_at =
          patch.status === "open"
            ? null
            : (row.resolved_at ?? new Date().toISOString());
      }

      // Déclencheur `sync_issue_closure` (migration 013).
      //
      // Contrairement au signalement, une **réouverture puis fermeture**
      // redate : le problème est réapparu, puis traité de nouveau. On ne
      // conserve donc pas la date initiale ici — c'est la seule
      // différence entre les deux déclencheurs, et elle est volontaire.
      if (this.table === "issues" && patch.status !== undefined) {
        if (patch.status === "open") {
          next.closed_at = null;
          next.closed_by = null;
        } else if (!row.closed_at) {
          next.closed_at = new Date().toISOString();
          next.closed_by = loadSessionId();
        }
      }

      // Déclencheur `sync_pull_request_merge` (migration 014).
      //
      // Comme pour les issues, la date et l'auteur de la fusion sont
      // **dérivés** du statut, jamais envoyés par le client : la
      // contrainte `pull_requests_merge_dated` les rendrait obligatoires
      // en base, et une demande « fusionnée » sans date n'aurait pas pu
      // exister.
      if (this.table === "pull_requests" && patch.status !== undefined) {
        const maintenant = new Date().toISOString();

        if (patch.status === "ouverte") {
          next.merged_at = null;
          next.merged_by = null;
          next.closed_at = null;
        } else if (patch.status === "fusionnee") {
          if (!row.merged_at) {
            next.merged_at = maintenant;
            next.merged_by = loadSessionId();
          }
          next.closed_at = null;
        } else if (patch.status === "fermee") {
          next.merged_at = null;
          next.merged_by = null;
          next.closed_at = row.closed_at ?? maintenant;
        }
      }

      // Déclencheur `touch_project_page` (migration 015) : la date de
      // dernière écriture est **écrasée** à chaque mise à jour, même si
      // le client en envoie une. Une page « modifiée il y a un instant »
      // qui ne bouge plus trompe précisément la personne à qui la date
      // sert — celle qui cherche ce qui a changé.
      if (this.table === "project_pages") {
        next.updated_at = new Date().toISOString();
      }

      rows[i] = next;
      touched.push(next);

      if (
        this.table === "project_applications" &&
        next.status === "acceptee" &&
        row.status !== "acceptee"
      ) {
        accepted.push(next);
      }
    }

    // Déclencheur `applications_accept` (migration 023) : l'acceptation
    // vaut adhésion **et** preuve. `replayProofs` le redérive au prochain
    // chargement, donc la preuve survit à un rechargement ; ici, on la
    // pose tout de suite pour que l'écran qui vient d'accepter la voie.
    if (accepted.length > 0) {
      for (const a of accepted) {
        const already = store.project_members.some(
          (m) => m.project_id === a.project_id && m.user_id === a.user_id,
        );
        if (!already) {
          store.project_members.push({
            project_id: a.project_id,
            user_id: a.user_id,
            role: "editor",
            added_at: new Date().toISOString(),
          });
        }

        const language =
          store.projects.find((p) => p.id === a.project_id)?.language ?? "";
        const subject = `projet:${String(a.project_id)}`;
        const hasProof = store.proofs.some(
          (p) =>
            p.user_id === a.user_id &&
            p.kind === "project" &&
            p.subject === subject,
        );
        if (!hasProof) {
          store.proofs.push(
            makeProof({
              id: `proof-project-${subject}`,
              user_id: String(a.user_id),
              kind: "project",
              language: String(language),
              project_id: (a.project_id as string) ?? null,
              subject,
              summary: `candidature:${String(a.id)}`,
              created_at: String(a.decided_at ?? new Date().toISOString()),
            }) as unknown as Row,
          );
        }
      }
    }

    save(store);
    for (const r of touched) notify(this.table, "UPDATE", r);

    if (!this.returning) return { data: null, error: null };

    // `update … select(…).maybeSingle()` rend **un objet** dans
    // PostgREST, pas un tableau d'un élément. Sans ce traitement, la
    // ligne qu'on vient d'écrire arrive dans l'écran sous forme de
    // liste, et le code doit alors deviner s'il a bien obtenu la ligne
    // qu'il demandait — un `data[0]` qui ne distingue pas « pas de
    // résultat » de « une ligne ».
    const shaped = this.shape(touched);

    // Pas de `withCount` ici : `count` est une notion du `select`, et
    // cette méthode met à jour. Le compter reviendrait à annoncer le
    // nombre de lignes touchées par un `update` comme un total — ce que
    // PostgREST ne fait pas.
    if (this.wantSingle === "single") {
      if (shaped.length !== 1) {
        return {
          data: null,
          error: { message: "JSON object requested, multiple (or no) rows returned" },
        };
      }
      return { data: shaped[0], error: null };
    }

    if (this.wantSingle === "maybeSingle") {
      return { data: shaped[0] ?? null, error: null };
    }

    return { data: shaped, error: null };
  }
}

/* ------------------------------------------------------------------ */
/* Realtime : bus local qui imite les canaux `postgres_changes`.       */
/* ------------------------------------------------------------------ */

type Listener = (payload: { new: Row; old: Row }) => void;

/** Abonné à un message diffusé : il ne reçoit pas de ligne, mais un corps. */
type BroadcastListener = (payload: Record<string, unknown>) => void;

/**
 * Le canal de démonstration.
 *
 * `on` est volontairement surchargé : voir la définition plus bas.
 */
export interface DemoChannel {
  on(type: "broadcast", opts: { event: string }, fn: BroadcastListener): DemoChannel;
  on(
    type: string,
    opts: { event: string; schema?: string; table: string; filter?: string },
    fn: Listener,
  ): DemoChannel;
  subscribe(cb?: (status: string) => void): DemoChannel;
  send(payload: { type: string; event: string; payload?: unknown }): Promise<{
    type: string;
    event: string;
  }>;
  unsubscribe(): DemoChannel;
  readonly name: string;
}

const listeners = new Map<string, Listener[]>();

/**
 * Les abonnés aux messages diffusés, par `canal|événement`.
 *
 * Volontairement **global** au module, comme `listeners` : deux
 * ouvertures de la même conversation doivent voir le même signal, et un
 * tableau par instance de canal les isolerait — on verrait sa propre
 * frappe mais pas celle de l'autre onglet du même écran.
 */
const broadcasts = new Map<string, (payload: Record<string, unknown>) => void>();

/** Notifie les abonnés d'un changement local (équivalent realtime). */
function notify(table: string, event: "INSERT" | "UPDATE" | "DELETE", row: Row): void {
  for (const [key, fns] of listeners) {
    const [evt, tbl, filter] = key.split("|");
    if (evt !== event || tbl !== table) continue;

    // Filtre de la forme `col=eq.valeur` (syntaxe realtime Supabase).
    if (filter) {
      const eq = filter.indexOf("=");
      const col = filter.slice(0, eq);
      const rest = filter.slice(eq + 1);
      if (rest.startsWith("eq.")) {
        if (String(row[col]) !== rest.slice(3)) continue;
      }
    }
    for (const fn of fns) fn({ new: row, old: row });
  }
}

/** Surface `from()` du client de démonstration. */
export const demoFrom = (table: string) => new Query(table, "select");

/**
 * Surface `channel().on().subscribe()` du client de démonstration.
 *
 * Le temps réel local se fait par un bus en mémoire : les écritures de
 * l'écran courant notifient les canaux ouverts. Le multi-onglets, lui, exige
 * un vrai backend — le mode démo assume cette limite.
 */
export function demoChannel(name: string) {
  const subs: { event: "INSERT" | "UPDATE"; table: string; filter?: string; fn: Listener }[] = [];

  /**
   * Les abonnés aux messages diffusés (`broadcast`).
   *
   * Le broadcast est le seul canal qui ne transite **pas** par une
   * table : il porte un signal éphémère — « je tape » — qui n'a aucune
   * raison d'être stocké, écrit, ou jamais rejoué à la connexion. C'est
   * pourquoi c'est le bon véhicule pour l'indicateur de frappe, et
   * pourquoi il n'a pas de équivalent dans `postgres_changes`.
   */
  const casts: { event: string; fn: BroadcastListener }[] = [];

  /**
   * Le canal lui-même, déclaré **avant** `on` pour que les surcharges
   * aient un type de retour nommé.
   */
  const api: DemoChannel = {
    on: undefined as unknown as DemoChannel["on"],
    subscribe(cb?: (s: string) => void) {
      for (const s of subs) {
        const key = `${s.event}|${s.table}|${s.filter ?? ""}`;
        const arr = listeners.get(key) ?? [];
        arr.push(s.fn);
        listeners.set(key, arr);
      }
      for (const c of casts) broadcasts.set(`${name}|${c.event}`, c.fn);
      cb?.("SUBSCRIBED");
      return api;
    },
    /**
     * Diffuse un message sur le canal.
     *
     * Le client réel renvoie une promesse qu'il faut ignorer ou await ;
     * on renvoie donc une promesse déjà résolue, pour que le même
     * `await channel.send(...)` compile et se comporte des deux côtés.
     */
    async send(payload: { type: string; event: string; payload?: unknown }) {
      const key = `${name}|${payload.event}`;
      const fn = broadcasts.get(key);
      if (fn) fn((payload.payload ?? {}) as Record<string, unknown>);
      return { type: "broadcast", event: payload.event };
    },
    unsubscribe() {
      for (const s of subs) {
        const key = `${s.event}|${s.table}|${s.filter ?? ""}`;
        const arr = listeners.get(key) ?? [];
        listeners.set(key, arr.filter((f) => f !== s.fn));
      }
      for (const c of casts) broadcasts.delete(`${name}|${c.event}`);
      return api;
    },
    name,
  };

  /**
   * `on()` est surchargé : la forme `postgres_changes` et la forme
   * `broadcast` ne reçoivent pas la même charge utile, donc les fusionner
   * en une seule signature obligerait l'appelant à un `if` de plus — un
   * `if` de plus dans chaque écran, pour une distinction que le type
   * sait déjà faire.
   */
  function on(
    type: "broadcast",
    opts: { event: string },
    fn: BroadcastListener,
  ): DemoChannel;
  function on(
    type: string,
    opts: { event: string; schema?: string; table: string; filter?: string },
    fn: Listener,
  ): DemoChannel;
  function on(type: string, opts: Record<string, unknown>, fn: unknown): DemoChannel {
    if (type === "broadcast") {
      casts.push({ event: String(opts.event), fn: fn as BroadcastListener });
      return api;
    }

    const o = opts as { event: string; table: string; filter?: string };
    subs.push({
      event: o.event === "UPDATE" ? "UPDATE" : "INSERT",
      table: o.table,
      filter: o.filter,
      fn: fn as Listener,
    });
    return api;
  }

  api.on = on;
  return api;
}

export const demoRemoveChannel = (ch: DemoChannel): void => {
  ch.unsubscribe();
};
