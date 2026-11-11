/**
 * Types du domaine DevNet.
 * Miroir des tables définies dans schema.sql.
 *
 * Les types du **stade** et des **rôles recherchés** vivent dans
 * `lib/match.ts`, avec les règles qui les utilisent : ce fichier les
 * réimporte pour que `Project` les porte sans en dupliquer la définition.
 */

import type { ProjectStage, SeekingRole } from "./match";
import type { VerificationStatus } from "./verification";

/** Le fragment de code publié (§4) — il a **tourné** au moins une fois. */
export interface Snippet {
  id: string;
  author_id: string;
  title: string;
  language: string;
  code: string;
  /** Sortie observée lors de la dernière exécution réussie. */
  output: string;
  ran_at: string | null;
  created_at: string;
}

/**
 * Une proposition de correction **ancrée sur une ligne** (§5).
 *
 * `original` est figé au moment de la proposition : si le fichier change,
 * la proposition reste lisible au lieu de pointer dans le vide.
 */
export interface ReviewCorrection {
  id: string;
  project_id: string;
  path: string;
  line_no: number;
  original: string;
  proposed: string;
  language: string;
  author_id: string;
  status: "proposee" | "acceptee" | "refusee";
  comment: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

/** Une tâche de l'équipe, en trois colonnes (§7). */
export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  body: string;
  status: "todo" | "doing" | "done";
  position: number;
  assignee: string | null;
  language: string;
  created_by: string;
  done_at: string | null;
  created_at: string;
}

/** Une candidature à un projet (§6). Acceptée, elle crée une preuve. */
export interface ProjectApplication {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  message: string;
  status: "attente" | "acceptee" | "refusee" | "retiree";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export type AccountType = "student" | "professional";

export type AvatarColor =
  | "av-lime"
  | "av-sage"
  | "av-pink"
  | "av-orange"
  | "av-violet";

/**
 * Lien externe déclaré sur un profil (portfolio, dépôt, site personnel).
 *
 * Une liste plutôt qu'un champ unique : un développeur a souvent *plusieurs*
 * adresses à montrer, et un seul champ « site web » finit toujours par
 * contenir trois liens collés à la main, illisibles et non cliquables.
 */
export interface ProfileLink {
  /** Étiquette courte — « GitHub », « Portfolio »… */
  label: string;
  /** URL absolue (ou relative normalisée en `https://` à l'enregistrement). */
  url: string;
}

export interface User {
  id: string;
  prenom: string;
  pseudo: string;
  email: string;
  filiere: string;
  niveau: string;
  langages: string[];
  avatar_color: AvatarColor;
  bio: string;
  /** Ville déclarée — placée sur la carte d'accueil. */
  ville: string;
  /** Pays déclaré — affiché sur le profil. */
  pays: string;
  /** Liens externes (migration 026). Absent des anciens profils. */
  links?: ProfileLink[];
  /** Thème de l'interface (migration 029). */
  theme?: string;
  account_type: AccountType;
  verified: boolean;
  /**
   * Compte d'administration (décision de produit posée par la migration 037).
   *
   * Ce n'est pas un rôle de contenu : un modérateur de groupe ou de
   * communauté le reste porté par sa ligne d'adhésion. C'est un état du
   * **compte**, qui décide de deux choses — traiter les demandes de
   * vérification, et porter le cachet de base plutôt qu'une variante de
   * palier.
   */
  is_admin?: boolean;
  /** État de la dernière demande de vérification (`lib/verification.ts`). */
  verification_status?: VerificationStatus;
  /** Mot joint à la demande — relis par l'administration, jamais public. */
  verification_note?: string;
  followers: number;
  following: number;
  /** Préférence : accepter les photos et vidéos dans les messages privés. */
  dm_media?: boolean;
  created_at: string;
}

export interface Post {
  id: string;
  author_id: string;
  /**
   * Les six champs suivants sont des **reliques**. Ils sont recopiés dans
   * le post à l'insertion, donc figés : changer de nom ou de filière les
   * laisse périmés sur tous les posts anciens. Ils subsistent en base
   * (colonnes `default ''`) pour que `select("*")` des anciens clients
   * ne casse pas, mais plus rien ne les écrit ni ne les lit — l'auteur
   * se lit par jointure, via `PostWithAuthor`.
   */
  author_name?: string;
  author_pseudo?: string;
  author_color?: AvatarColor;
  filiere?: string;
  niveau?: string;
  author_type?: string;
  text: string;
  has_code: boolean;
  code: string;
  lang: string;
  /**
   * GIF joint, sous forme de **lien** https vers un fournisseur (Tenor,
   * Giphy). Vide si la publication n'en a pas. Aucun binaire n'est
   * stocké : le fournisseur peut retirer le GIF, le texte reste.
   */
  gif_url?: string;
  /** Description du GIF pour les lecteurs d'écran (≤ 300 caractères). */
  gif_alt?: string;
  /** Photo ou vidéo de la publication (migration 056) — URL du bucket `media`. */
  media_url?: string;
  /** `image`, `video`, ou vide quand la publication n'a pas de fichier. */
  media_type?: "" | "image" | "video";
  /** Cache, maintenu par le déclencheur `sync_post_likes`. Jamais écrit par le client. */
  likes: number;
  /**
   * Obsolète — conservé pour que `select("*")` des anciens clients ne
   * casse pas. Le like est une ligne dans `post_likes` ; l'interface
   * ne lit plus ce champ.
   */
  liked_by: string[];
  /** Cache, maintenu par le déclencheur `sync_post_comments`. */
  comments: number;
  /**
   * Nombre de réactions, cache du déclencheur `sync_post_reactions`.
   *
   * Le détail par emoji n'est **pas** sur le post : il se lit dans la
   * table `reactions` quand on ouvre le sélecteur. Ici on n'a besoin que
   * du total, donc on ne paie pas une requête par carte du fil.
   */
  reactions?: number;
  /** Nombre de reposts, cache du déclencheur `sync_post_reposts`. */
  reposts?: number;
  /**
   * Hashtags du texte, extraits par le déclencheur `posts_sync_tags`.
   * Jamais écrit par le client — d'où sa présence ici : la valeur
   * existe dans la colonne, et c'est ce qui permet à la recherche de
   * filtrer dessus sans relire chaque texte.
   */
  tags?: string[];
  /**
   * Communauté à laquelle la publication est rattachée (migration 028).
   *
   * `null` (le cas courant) = publication de fil personnel. Une valeur
   * rattache la publication au fil d'une communauté ; la portée de
   * lecture et d'écriture suit alors `communities.visibility`.
   */
  community_id?: string | null;
  created_at: string;
}

/**
 * Un like est une **ligne**, pas un nombre.
 *
 * Tant que le like était un `int` mis à jour sur le post, il fallait
 * faire confiance au client pour l'incrémenter — ce que la RLS ne peut
 * pas interdire, puisqu'elle raisonne en lignes et non en colonnes. Ici
 * la clé primaire `(post_id, user_id)` rend le double like impossible
 * par construction, et le compteur n'est plus qu'un cache.
 */
export interface PostLike {
  post_id: string;
  user_id: string;
  created_at: string;
}

/**
 * Une réaction est une **ligne**, exactement comme un like.
 *
 * Une seule réaction par personne et par publication : la clé
 * `(post_id, user_id)` rend le double impossible par construction, et le
 * remplacement se fait en delete+insert — le compteur par emoji est un
 * cache dérivé, jamais écrit par le client.
 *
 * Le jeu de réactions affiché est déclaré dans l'interface, pas ici :
 * il ne doit pas diverger entre écran, démo et base.
 */
export interface Reaction {
  post_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

/**
 * Un repost est une **ligne**, pas un booléen sur le post.
 *
 * Comme `post_likes` et `reactions` : la clé `(post_id, user_id)`
 * empêche un utilisateur de republier deux fois le même post, et le
 * compteur est un cache dérivé. Le repost ne modifie ni le texte ni
 * l'auteur — il réaffiche le post dans le fil de celui qui le republie,
 * avec sa source conservée.
 */
export interface Repost {
  post_id: string;
  user_id: string;
  created_at: string;
}

/**
 * Un commentaire n'est jamais réécrit : il est supprimé ou posté à
 * nouveau. C'est pourquoi il n'existe pas de politique `update` sur
 * `comments` — l'historique ne se réécrit pas.
 */
export interface Comment {
  id: string;
  post_id: string;
  author_id: string | null;
  text: string;
  /**
   * Le commentaire auquel celui-ci répond.
   *
   * Un seul niveau : répondre à une réponse s'applique au commentaire
   * racine. Au-delà, un fil devient illisible sur un téléphone et la
   * notification n'a plus de forme lisible (« X a répondu à Y qui avait
   * répondu à Z »).
   */
  parent_id?: string | null;
  /** GIF joint (migration 054) — `https` uniquement, comme les messages. */
  gif_url?: string;
  gif_alt?: string;
  /** Sticker joint — un identifiant du catalogue, jamais un caractère. */
  sticker_id?: string | null;
  created_at: string;
}

/** Un commentaire avec son auteur résolu, pour l'affichage. */
export type CommentWithAuthor = Comment & {
  author: AuthorWithBadge | null;
};

/** Un lien de suivi. `follower_id` <> `followee_id` est garanti par la base. */
export interface Follow {
  follower_id: string;
  followee_id: string;
  created_at: string;
}

/**
 * Un signet.
 *
 * Une **ligne**, comme le like : la clé `(post_id, user_id)` interdit
 * d'enregistrer deux fois la même publication. Et la lecture est
 * privée — un signet est une liste de lecture, elle décrit ce que
 * quelqu'un a choisi de garder, et personne n'a à le savoir.
 */
export interface Bookmark {
  post_id: string;
  user_id: string;
  created_at: string;
}

/** Ce qu'une réaction de message peut viser. */
export type MessageTarget = "direct_message" | "group_message";

/**
 * Une réaction sur un message, quel qu'il soit.
 *
 * Une seule table pour le privé et le groupe : c'est le choix déjà posé
 * pour les signalements (migration 011). `target_id` ne peut donc pas
 * porter de clé étrangère — il désigne tantôt une ligne de
 * `direct_messages`, tantôt une de `group_messages`.
 */
export interface MessageReaction {
  id: string;
  target_type: MessageTarget;
  target_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

/** Un épingle — comme un signet, il est privé à celui qui l'a posé. */
export interface MessagePin {
  id: string;
  target_type: MessageTarget;
  target_id: string;
  user_id: string;
  created_at: string;
}

/**
 * Une story.
 *
 * `expires_at` est ce qui la distingue d'une publication : elle
 * disparaît, donc ce qu'elle dit n'a pas besoin d'être vrai demain.
 */
export interface Story {
  id: string;
  author_id: string;
  caption: string;
  media_url: string;
  created_at: string;
  expires_at: string;
}

/** Une story avec son auteur résolu, pour le rail et le lecteur. */
export type StoryWithAuthor = Story & { author: UserLite | null };

export type GroupRole = "owner" | "moderator" | "member";

/** L'adhésion à un groupe, en remplacement du tableau `groups.members`. */
export interface GroupMember {
  group_id: string;
  user_id: string;
  role: GroupRole;
  joined_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  category: string;
  emoji: string;
  created_by: string;
  members: string[];
  member_count: number;
  created_at: string;
}

/**
 * Une **communauté** — l'équivalent « forum » d'un groupe.
 *
 * La distinction avec `Group` est délibérée : un groupe est une **salle**
 * (canaux, messages en temps réel), une communauté est un **fil public**
 * (des publications rattachées). On s'y abonne pour suivre un thème, on
 * ne s'y connecte pas pour discuter.
 *
 * `visibility` porte la portée du fil :
 * - `public`     : lisible et publiable par toute personne connectée ;
 * - `restricted` : lisible par tous, seule l'adhésion permet de publier ;
 * - `private`    : lisible et publiable par les membres seulement.
 */
export type CommunityRole = "owner" | "moderator" | "member";
export type CommunityVisibility = "public" | "restricted" | "private";

export interface CommunityMember {
  community_id: string;
  user_id: string;
  role: CommunityRole;
  joined_at: string;
}

export interface Community {
  id: string;
  /** Identifiant lisible et stable dans l'URL — jamais recalculé. */
  slug: string;
  name: string;
  description: string;
  /** Règlement intérieur, texte libre affiché en tête du fil. */
  rules: string;
  /** Icône du répertoire (nom lucide résolu par `asIconName`). */
  icon: string;
  visibility: CommunityVisibility;
  created_by: string;
  member_count: number;
  created_at: string;
}

/** Une communauté lue avec son créateur joint, pour l'en-tête. */
export interface CommunityWithAuthor extends Community {
  author?: UserLite | null;
}

// ── Extensions ──────────────────────────────────

/**
 * Les extensions — ce que VS Code appelle un *marketplace*.
 *
 * Une extension n'est **pas** du code exécuté : c'est un manifeste déclaratif
 * que l'éditeur interprète (snippets de complétion, commandes, réglages,
 * thème). On refuse délibérément d'exécuter du code tiers — un éditeur en
 * ligne qui chargerait le JavaScript d'un autre compte serait un vecteur
 * d'attaque, pas une place de marché.
 *
 * `category` borne ce qu'une extension peut prétendre être ; la base la
 * valide par un `check`, comme les rôles d'un groupe.
 */
export type ExtensionCategory =
  | "theme"
  | "snippets"
  | "language"
  | "tool"
  | "other";

/** Un gabarit de saisie (snippet) : un préfixe qui se déploie en corps. */
export interface ExtensionSnippet {
  /** Langage Monaco visé (« javascript », « python »…), ou `*` pour tous. */
  language: string;
  /** Le texte qu'on tape et qui déclenche la complétion. */
  prefix: string;
  /** Le corps inséré ; `${1}`, `${2}`… marquent les tabulations. */
  body: string;
  description?: string;
}

/**
 * Une commande exposée par l'extension, dans la palette de l'éditeur.
 *
 * `body` est ce que la commande **fait** : le texte inséré au curseur.
 * Une commande sans corps n'est pas une action, c'est une entrée de
 * menu qui ne produit rien — l'IDE ne l'enregistre donc pas. Le champ
 * reste optionnel pour que les manifestes publiés avant cette
 * précision restent lisibles, pas pour encourager des commandes vides.
 */
export interface ExtensionCommand {
  id: string;
  title: string;
  body?: string;
}

/** Un réglage proposé par l'extension, avec sa valeur par défaut. */
export interface ExtensionSetting {
  key: string;
  label: string;
  type: "string" | "boolean" | "number";
  default: string | boolean | number;
}

/**
 * Une carte qu'une extension déclare pour un emplacement de l'interface.
 *
 * `slot` est un identifiant d'emplacement connu de l'application
 * (`discover.sidebar`, `extensions.page`), pas un sélecteur CSS : une
 * extension ne peut pas décider *où* elle s'affiche, seulement dans quels
 * emplacements prévus. `href` est restreint à `https://` et aux chemins
 * internes (voir `isSafeSlotHref`) — jamais de `javascript:`.
 */
export interface ExtensionSlot {
  slot: string;
  title: string;
  body?: string;
  href?: string;
}

/** Le manifeste : tout ce qu'une extension déclare, et rien de plus. */
export interface ExtensionManifest {
  snippets?: ExtensionSnippet[];
  commands?: ExtensionCommand[];
  settings?: ExtensionSetting[];
  slots?: ExtensionSlot[];
}

export interface Extension {
  id: string;
  /** Identifiant lisible et stable dans l'URL — jamais recalculé. */
  slug: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  category: ExtensionCategory;
  manifest: ExtensionManifest;
  owner_id: string | null;
  /** Compteur **dérivé** des installations, comme `Community.member_count`. */
  installs: number;
  created_at: string;
}

export interface ExtensionInstall {
  extension_id: string;
  user_id: string;
  enabled: boolean;
  settings: Record<string, string | boolean | number>;
  installed_at: string;
}

/** Une extension lue avec son auteur joint, pour la carte de la place de marché. */
export interface ExtensionWithAuthor extends Extension {
  author?: UserLite | null;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  /** Canal de rattachement ; absent sur les messages écrits avant les canaux. */
  channel_id?: string | null;
  /** Message auquel celui-ci répond, s'il en est un. */
  reply_to_id?: string | null;
  author_id: string;
  author_name: string;
  author_color: AvatarColor;
  text: string;
  is_code: boolean;
  /** Sticker du catalogue joint (migration 053). */
  sticker_id?: string | null;
  /** GIF joint, lien https vers un fournisseur (migration 053). */
  gif_url?: string;
  gif_alt?: string;
  /** Photo ou vidéo jointe (migration 056) — URL du bucket `media`. */
  media_url?: string;
  media_type?: "" | "image" | "video";
  created_at: string;
}

// ── Canaux ──────────────────────────────────────

export type ChannelRole = "owner" | "moderator" | "member";

export interface Channel {
  id: string;
  group_id: string;
  slug: string;
  name: string;
  topic: string;
  position: number;
  is_private: boolean;
  created_by: string;
  created_at: string;
}

export interface ChannelMember {
  channel_id: string;
  user_id: string;
  role: ChannelRole;
  muted: boolean;
  joined_at: string;
  /**
   * Dernier instant lu dans ce canal (migration 017).
   *
   * C'est la source du « lu par n sur m » : un canal n'affiche pas de
   * double tick, parce qu'un double tick y signifierait « lu par
   * quelqu'un » — ce que personne ne croit en le voyant.
   */
  last_read_at?: string | null;
}

// ── Projets ─────────────────────────────────────

export type ProjectRole = "owner" | "maintainer" | "editor" | "viewer";
export type ProjectVisibility = "public" | "group" | "private";

export interface Project {
  id: string;
  group_id: string;
  created_by: string;
  name: string;
  slug: string;
  description: string;
  emoji: string;
  language: string;
  visibility: ProjectVisibility;
  default_branch: string;
  /**
   * Où en est le projet (§6). Un stade n'est pas une décoration : il dit
   * ce qu'on s'engage à faire en rejoignant, et il sert de seuil aux
   * filtres.
   */
  stage: ProjectStage;
  /** Le projet cherche-t-il des membres ? Sans cela, aucune compatibilité. */
  seeking: boolean;
  /** Langages recherchés — comparés aux **preuves**, pas aux déclarations. */
  demand_languages: string[];
  /** Rôles recherchés, dans le vocabulaire de `SEEKING_ROLES`. */
  demand_roles: SeekingRole[];
  created_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  added_at: string;
}

// ── Dépôt interne ───────────────────────────────

export interface GitCommit {
  sha: string;
  project_id: string;
  parent_sha: string;
  author_id: string;
  author_name: string;
  message: string;
  tree: string;
  files_changed: number;
  insertions: number;
  deletions: number;
  source: "internal" | "github";
  created_at: string;
}

export interface GitRef {
  project_id: string;
  name: string;
  kind: "branch" | "tag";
  sha: string;
  updated_at: string;
}

/**
 * L'état des fichiers à un commit donné.
 *
 * Un commit ne porte que le nom de son arbre — c'est le principe de git.
 * Sans cet instantané, on ne peut ni comparer deux commits, ni savoir s'il
 * reste des changements à enregistrer.
 */
export interface GitCommitFile {
  project_id: string;
  sha: string;
  path: string;
  content: string;
  blob_sha: string;
}

export interface GitFile {
  project_id: string;
  /**
   * Branche à laquelle appartient le fichier (migration 012).
   *
   * Une branche a son propre jeu de fichiers : c'est ce qui rend deux
   * branches comparables, donc ce qui rend une pull request possible.
   */
  branch: string;
  path: string;
  content: string;
  blob_sha: string;
  size: number;
  updated_by: string;
  updated_at: string;
}

// ── Connexions sortantes ────────────────────────

/**
 * L'état d'une connexion sortante.
 *
 * Trois valeurs, closes. `pending` couvre le cas où une destination a été
 * enregistrée mais pas encore confirmée (un tunnel pas encore joint, une
 * API jamais appelée) : l'afficher comme « active » serait un mensonge, et
 * la montrer comme « en erreur » le serait aussi — rien n'a encore échoué.
 */
export type ConnectionStatus = "active" | "pending" | "error";

/**
 * Une connexion à un service extérieur, **par personne**.
 *
 * La table s'appelait `github_connections` (004) du temps où GitHub était
 * la seule destination. Elle porte désormais plusieurs fournisseurs — le
 * `provider` les distingue, et `unique (user_id, provider)` garantit une
 * seule connexion par fournisseur et par personne.
 *
 * Le secret n'est **jamais** ici : `token_ref` est le nom sous lequel le
 * jeton est rangé dans un coffre. Une fuite de lecture ne donne pas d'accès.
 */
export interface GithubConnection {
  id: string;
  user_id: string;
  /** `github` | `vscode` | `api` | … */
  provider: string;
  /** Identité affichée : login GitHub, nom du tunnel, nom du service. */
  login: string;
  external_id: string;
  avatar_url: string;
  scopes: string[];
  /** Référence vers un coffre ; le jeton n'est jamais dans cette table. */
  token_ref: string;
  /** Destination (URL du tunnel, base d'API). Vide pour GitHub. */
  endpoint: string;
  status: ConnectionStatus;
  /** Dernier usage connu, `null` tant qu'on ne s'en est pas servi. */
  used_at: string | null;
  /** Ce que le fournisseur a renvoyé d'autre, sans forme imposée. */
  metadata: Record<string, unknown>;
  connected_at: string;
}

/**
 * Un dépôt GitHub du compte connecté, tel que l'écran le propose au
 * rattachement.
 *
 * On ne garde pas l'objet GitHub entier : l'écran n'a besoin que de quoi
 * montrer une liste lisible et écrire `owner/repo` dans un lien de projet.
 * Le reste (URLs d'API, compteurs, permissions) n'est jamais montré et
 * alourdirait la réponse pour rien.
 */
export interface GithubRepo {
  id: number;
  /** `propriétaire/dépôt`, la forme qui s'écrit dans un champ de lien. */
  full_name: string;
  owner: string;
  name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string | null;
  language: string | null;
  /** Dernière poussée, pour trier « ce sur quoi on travaille ». */
  pushed_at: string | null;
}

/**
 * Un dépôt GitHub **public**, tel que vu par un visiteur d'un profil.
 *
 * Sortie de `/api/github/users/[login]/repos`, qui n'emploie ni cookie ni
 * jeton : les dépôts privés ne peuvent pas figurer ici, et `private` ne
 * fait même pas partie du champ — l'écran n'a aucun moyen de les afficher.
 */
export interface PublicGithubRepo {
  id: number;
  full_name: string;
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  pushed_at: string | null;
}

/**
 * Le détail d'un dépôt GitHub, pour la page `/github/[owner]/[repo]`.
 *
 * Même principe que {@link GithubRepo} : on ne transporte que ce que
 * l'écran montre. Les URLs d'API et les objets imbriqués de GitHub
 * restent côté route.
 */
export interface GithubRepoDetail extends GithubRepo {
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  updated_at: string | null;
  license: string | null;
}

/** Une entrée de l'arbre d'un dépôt (fichier ou répertoire). */
export interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size: number | null;
}

/** Une révision GitHub, réduite à ce que la liste affiche. */
export interface GithubCommitSummary {
  sha: string;
  message: string;
  author_name: string | null;
  author_login: string | null;
  date: string | null;
}

/** Une branche GitHub. */
export interface GithubBranchSummary {
  name: string;
  sha: string;
  protected: boolean;
}

/** Le contenu d'un fichier GitHub, déjà décodé en texte. */
export interface GithubFileContent {
  path: string;
  content: string;
  size: number;
  /** `true` quand GitHub n'a pas rendu tout le contenu (binaire ou trop gros). */
  truncated: boolean;
}

/**
 * Les charges de l'import « fichiers + historique ».
 *
 * Le fil n'envoie pas un instantané complet à chaque révision : la
 * première est `full`, les suivantes sont `delta` — les seuls chemins
 * ajoutés ou modifiés, plus la liste des supprimés. Rejouer l'historique
 * côté client reconstruit l'état cumulatif, ce qui garde la réponse
 * petite même pour un dépôt qui a beaucoup bougé.
 */
export interface GithubImportFile {
  path: string;
  content: string;
}

export interface GithubImportCommit {
  message: string;
  authorName: string;
  authorEmail: string;
  /** Horodatage du commit GitHub, en secondes. */
  when: number;
  mode: "full" | "delta";
  files: GithubImportFile[];
  deleted: string[];
}

export interface GithubImportPayload {
  owner: string;
  repo: string;
  branch: string;
  /** `true` si l'historique a été coupé à la borne d'import. */
  truncated: boolean;
  commits: GithubImportCommit[];
}

/**
 * Rattachement d'une publication à un projet.
 *
 * Un post appartient à **au plus un** projet : rattacher la même
 * publication à deux dépôts obligerait à choisir lequel afficher, et le
 * lecteur comprendrait mal.
 */
export interface PostProject {
  post_id: string;
  project_id: string;
}

export interface ProjectLink {
  id: string;
  project_id: string;
  user_id: string;
  owner: string;
  repo: string;
  default_branch: string;
  sync_mode: "manuel" | "pull" | "push" | "bidirectionnel";
  last_push_sha: string;
  last_pull_sha: string;
  last_synced_at: string | null;
  /** Dernier sha de branche vu sur GitHub (base de détection « GitHub a avancé »). */
  remote_sha: string;
  /** Tête DevNet au moment de la dernière synchro live. */
  local_sha: string;
  /** Cadence du polling, en secondes. */
  sync_interval_seconds: number;
  created_at: string;
}

// ── Notifications ──────────────────────────────

/**
 * Les quatre événements adressés à un compte.
 *
 * Une seule table les porte tous : ils partagent la même forme — un
 * destinataire, un auteur, une cible, une date — et c'est ce qui permet
 * d'en ajouter un cinquième sans migration.
 */
export type NotificationKind = "like" | "follow" | "mention" | "message";

export interface Notification {
  id: string;
  /** Seul le destinataire peut la lire : c'est lui qui décide. */
  recipient_id: string;
  /** Absent si le compte de l'acteur a été supprimé. */
  actor_id: string | null;
  kind: NotificationKind;
  post_id: string | null;
  comment_id: string | null;
  conversation_id: string | null;
  created_at: string;
  /** La seule colonne que le client peut écrire. */
  read_at: string | null;
}

/** Une notification avec son auteur résolu, pour l'affichage. */
export type NotificationWithActor = Notification & { actor: AuthorWithBadge | null };

// ── Signalements ────────────────────────────────────

/**
 * Un signalement.
 *
 * **Une seule cible, jamais deux.** Les quatre colonnes `*_id` sont des
 * clés étrangères — donc `on delete cascade` : la suppression du contenu
 * signalé emporte le signalement, et l'écran n'affichera jamais une ligne
 * qui ne sait plus de quoi elle parle.
 *
 * `target_type` est une colonne **générée** en base : elle est déduite,
 * jamais écrite. Elle figure dans le type pour que l'écran n'ait pas à
 * la recalculer, mais elle ne se renseigne pas à la main.
 */
export interface Report {
  id: string;
  reporter_id: string;
  post_id: string | null;
  comment_id: string | null;
  message_id: string | null;
  reported_user: string | null;
  /** Déduit par la base — jamais écrit par le client. */
  target_type: ReportTarget;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  resolved_at: string | null;
  created_at: string;
}

export type ReportTarget = "post" | "comment" | "group_message" | "user";

export type ReportReason = "harassment" | "spam" | "hate" | "scam" | "other";

export type ReportStatus = "open" | "resolved" | "dismissed";

/**
 * Un signalement avec ce qu'il faut pour l'afficher.
 *
 * `can_classify` n'est pas une information stockée : c'est la RLS qui
 * décide de qui voit quoi, donc **la seule personne qui voit un
 * signalement sans pouvoir le classer est celle qui l'a écrit**. La
 * dérivation tient donc en une ligne — et surtout, elle ne peut pas
 * diverger de la base, puisqu'elle ne fait que relire sa règle au lieu
 * de la réinventer.
 */
export type ReportWithReporter = Report & {
  reporter: UserLite | null;
  can_classify: boolean;
};

// ── Présence ────────────────────────────────────

/**
 * Une session de travail : où en est **une personne** dans **un projet**.
 *
 * La clé est la paire `(project_id, user_id)` — jamais le chemin du
 * fichier. La 004 l'avait écrit « project_id:chemin », ce qui faisait de
 * la présence une propriété d'un fichier : deux membres sur le même
 * fichier tenaient une seule ligne, et le second effaçait le premier. La
 * migration 019 corrige la clé ; `file_path` est une colonne que l'on
 * met à jour, pas une identité.
 */
export interface ProjectSession {
  project_id: string;
  user_id: string;
  file_path: string;
  cursor: Record<string, number>;
  color: string;
  seen_at: string;
}

export interface Conversation {
  id: string;
  participants: string[];
  last_message: string;
  last_message_at: string;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  /** Message auquel celui-ci répond, s'il en est un. */
  reply_to_id?: string | null;
  author_id: string;
  author_name: string;
  text: string;
  /** Bloc de code isolé, jamais interprété (migration 041). */
  is_code?: boolean;
  /** Dernière correction ; absent pour un message d'origine (041). */
  edited_at?: string | null;
  /** Story d'origine, quand le message est une réponse de story (050). */
  story_id?: string | null;
  /** Sticker du catalogue joint (migration 053). */
  sticker_id?: string | null;
  /** GIF joint, lien https vers un fournisseur (migration 053). */
  gif_url?: string;
  gif_alt?: string;
  /** Photo ou vidéo jointe (migration 056) — URL du bucket `media`. */
  media_url?: string;
  media_type?: "" | "image" | "video";
  created_at: string;
}

/**
 * L'adhésion à une conversation privée, déduite des participants.
 *
 * `last_read_at` (migration 017) est écrit par le **lecteur** : c'est la
 * seule colonne de cette table que le client a le droit de poser, et il
 * ne la pose que sur sa propre ligne.
 */
export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  last_read_at?: string | null;
}

/**
 * Profil léger, pour les listes où on n'a pas besoin de tout.
 *
 * `filiere` et `niveau` en font partie : la carte de post affiche la
 * filière de son auteur, et la lire sur une colonne recopiée dans le
 * post la figerait au moment de la publication.
 */
export type UserLite = Pick<
  User,
  | "id"
  | "prenom"
  | "pseudo"
  | "avatar_color"
  | "account_type"
  | "verified"
  | "filiere"
  | "niveau"
  | "dm_media"
>;

/**
 * Le profil tel qu'il se lit sur `/u/[pseudo]`.
 *
 * `UserLite` sert aux listes où l'on a besoin de savoir **qui** parle : un
 * nom, un pseudo, une couleur. Sur un profil, il faut en plus pouvoir dire ce
 * que la personne fait — d'où `bio`, `langages` et la filière.
 *
 * `followers` et `following` sont des **caches**, pas la vérité : la vérité
 * ce sont les lignes de `follows`. Le déclencheur `sync_follows()` les
 * réécrit à chaque insertion et chaque suppression, donc ils ne peuvent pas
 * dériver — même raison que pour `posts.likes`.
 */
export type PublicProfile = UserLite &
  Pick<User, "bio" | "langages" | "ville" | "pays" | "links" | "followers" | "following">;

/** Un post enrichi de son auteur via la jointure `users`. */
export type PostWithAuthor = Post & { author: AuthorWithBadge | null };

/**
 * L'auteur d'une carte, avec de quoi peindre son cachet.
 *
 * `is_admin` porte l'anneau officiel ; `xp` est l'agrégat d'activité de
 * son auteur (voir `lib/author-badges.ts`) — la seule chose qui dise le
 * palier, puisque l'XP n'est jamais stockée. Un `xp` **absent** veut dire
 * « pas mesuré », et non « zéro » : c'est cette distinction qui fait
 * tomber un auteur sur le cachet de base au lieu du palier 1.
 */
export type AuthorWithBadge = UserLite & Pick<User, "is_admin"> & { xp?: number };

export const FILIERES = [
  "Informatique",
  "Génie Logiciel",
  "Réseaux & Télécoms",
  "Intelligence Artificielle",
  "Cybersécurité",
  "Data Science",
  "Autre",
] as const;

export const NIVEAUX = ["L1", "L2", "L3", "M1", "M2", "Doctorat"] as const;

export const LANGAGES = [
  "Python", "JavaScript", "Java", "C / C++", "PHP", "TypeScript",
  "Kotlin", "Dart", "Go", "Rust", "Swift", "SQL",
] as const;

export const AVATARS: AvatarColor[] = [
  "av-lime", "av-sage", "av-pink", "av-orange", "av-violet",
];