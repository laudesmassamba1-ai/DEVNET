import {
  DEMO_COMMUNITIES, DEMO_COMMUNITY_MEMBERS,
  DEMO_CONVERSATIONS, DEMO_DIRECT_MESSAGES, DEMO_GROUP_MESSAGES,
  DEMO_GROUPS, DEMO_POSTS, DEMO_USERS,
} from "./data";
import {
  DEMO_CHANNELS, DEMO_CHANNEL_MEMBERS, DEMO_GITHUB_CONNECTIONS,
  DEMO_GIT_COMMIT_FILES,
  DEMO_GIT_COMMITS, DEMO_GIT_FILES,
  DEMO_PROJECT_LINKS, DEMO_PROJECT_MEMBERS, DEMO_PROJECT_SESSIONS,
  DEMO_PROJECTS,
  DEMO_GIT_COMMIT_FILES_BRANCHES,
  DEMO_GIT_COMMITS_BRANCHES,
  DEMO_GIT_FILES_BRANCHES,
  DEMO_GIT_REFS_BRANCHES,
  DEMO_PULL_REQUESTS,
} from "./foundation";
import {
  DEMO_COMMENTS, DEMO_FOLLOWS, DEMO_GROUP_MEMBERS, DEMO_POST_LIKES,
  DEMO_POST_PROJECTS, DEMO_REACTIONS, DEMO_REPOSTS,
} from "./social";
import { DEMO_REPORTS } from "./reports";
import { DEMO_ISSUE_COMMENTS, DEMO_ISSUES } from "./issues";
import { DEMO_PROJECT_PAGES } from "./pages";
import {
  DEMO_BOOKMARKS, DEMO_COMMENT_REPLIES, DEMO_MESSAGE_PINS,
  DEMO_MESSAGE_REACTIONS, DEMO_STORIES,
} from "./profond";
import { extractTags } from "../tags";
import { replayNotifications } from "./notifications";
import {
  DEMO_PROJECT_APPLICATIONS, DEMO_PROJECT_TASKS, DEMO_REVIEW_CORRECTIONS,
  DEMO_SNIPPETS, replayProofs,
} from "./proofs";

/**
 * Store local du mode démo.
 *
 * Remplace Postgres : mêmes tables, mêmes lignes. Persiste dans
 * localStorage pour que les écritures du présentateur survivent à un
 * rechargement de page — une démo qui perd ses posts est une démo cassée.
 */

export type Row = Record<string, unknown>;

export interface DemoStore {
  users: Row[];
  posts: Row[];
  groups: Row[];
  group_messages: Row[];
  conversations: Row[];
  direct_messages: Row[];
  /**
   * Adhésion aux conversations de privé. Elle n'est pas écrite par
   * l'application : la migration 006 installe un déclencheur sur
   * `conversations` qui la remplit depuis `participants`. On rejoue ce
   * déclencheur ici pour que la démo reflects le même état — c'est
   * cette table que la politique `dm_read` interroge.
   */
  conversation_members: Row[];
  channels: Row[];
  channel_members: Row[];
  projects: Row[];
  project_members: Row[];
  git_commits: Row[];
  git_refs: Row[];
  git_files: Row[];
  /**
   * État des fichiers à chaque commit (migration 008). Sans lui, on ne
   * peut pas comparer deux commits — un dépôt ne se reconstruit pas avec
   * ses seuls commits, puisque le commit ne porte que le nom de son
   * arbre.
   */
  git_commit_files: Row[];
  /** Rattachement d'une publication à un projet (migration 009). */
  post_projects: Row[];
  /**
   * Les événements adressés au lecteur (migration 010).
   *
   * Comme `conversation_members`, elle n'est pas écrite par
   * l'application : ce sont les quatre déclencheurs de la migration 010
   * qui la remplissent. Le client n'y écrit que `read_at`, ou ne la
   * supprime pas du tout — et le rejeu se trouve dans
   * `syncCounters`, avec les autres déclencheurs.
   */
  notifications: Row[];
  /**
   * Les signalements (migration 011).
   *
   * Contrairement à `notifications`, celle-ci est **écrite par le
   * client** : un signalement est un geste, pas un fait qu'un
   * déclencheur produit. Elle vient quand même du seed plutôt que des
   * restes de `localStorage`, parce qu'une démonstration dont la file de
   * modération se remplit de Signalement #1, #2, #3 n'illustre plus rien.
   */
  reports: Row[];
  github_connections: Row[];
  project_links: Row[];
  project_sessions: Row[];
  /** Tables de jonction : le like, le commentaire et le suivi sont des lignes. */
  post_likes: Row[];
  /** Issues des dépôts (migration 013) et leur discussion. */
  issues: Row[];
  issue_comments: Row[];
  /** Wiki des dépôts (migration 015) : pages ordonnées par `position`. */
  project_pages: Row[];
  /**
   * Demandes d'intégration (migration 014).
   *
   * Aucun diff n'y est stocké, en base comme ici : il se calcule à la
   * lecture, à partir de l'état des deux branches. Un jeu de données
   * qui contiendrait un diff figé afficherait des nombres qui ne
   * correspondent plus au dépôt dès la première ligne écrite sur la
   * branche.
   */
  pull_requests: Row[];
  comments: Row[];
  follows: Row[];
  group_members: Row[];
  /**
   * Les communautés (migration 028) — des fils publics, distincts des
   * groupes : on y publie des posts plutôt que d'y tenir salon.
   */
  communities: Row[];
  community_members: Row[];
  /** Réactions par publication (migration 016). */
  reactions: Row[];
  /** Reposts (idem). */
  reposts: Row[];
  /** Signets — migration 018. Lecture **privée**. */
  bookmarks: Row[];
  /** Stories, avec leur expiration. */
  stories: Row[];
  /** Réactions sur un message, privé ou de groupe. */
  message_reactions: Row[];
  /** Épingles : comme les signets, elles sont privées. */
  message_pins: Row[];
  /**
   * Les preuves de travail — l'objet central de la vision.
   *
   * Comme `notifications`, elles ne sont **pas** écrites à la main : le
   * rejeu des déclencheurs de la migration 023 les reconstruit depuis
   * les tables sources. Les écrire dans le seed garantirait qu'elles
   * finissent par contredire les commits et les corrections dont elles
   * prétendent parler.
   */
  proofs: Row[];
  /** Snippets publiés : un fragment de code qui a tourné (§4). */
  snippets: Row[];
  /** Corrections ancrées sur une ligne, acceptées ou non (§5). */
  review_corrections: Row[];
  /** Tâches d'équipe en trois colonnes (§7). */
  project_tasks: Row[];
  /** Candidatures aux projets (§6) — acceptées, elles créent une preuve. */
  project_applications: Row[];
  /**
   * Les forks (migration 025) : parent, racine, et l'instantané cloné.
   * Écrite par le client — un fork est un geste, pas un fait dérivé.
   */
  project_forks: Row[];
  /**
   * Les notations par les pairs (migration 025) : une étoile de 1 à 5
   * par votant et par projet. Une voix par votant — la contrainte
   * `project_ratings_pkey` de la base.
   */
  project_ratings: Row[];
}

/**
 * Version du stockage local.
 *
 * Le suffixe sert à **invalider** un jeu de données qui n'a plus le même
 * contenu : sans lui, un navigateur qui a déjà ouvert l'application
 * continuerait de servir l'ancien jeu, alors que le seed en contient un
 * nouveau. Les publications ajoutées, les hashtags, les nouveaux membres
 * de groupe — rien n'apparaîtrait, et on en conclurait que la
 * fonctionnalité est cassée.
 *
 * À monter dès que le seed change de contenu, pas seulement de forme.
 * v13 : un message privé de code et un message corrigé (migration 041).
 * v11 : les tables `communities` et `community_members` (migration 028) et
 * la colonne `posts.community_id`.
 */
const KEY = "devnet.demo.v14";

const TABLES: (keyof DemoStore)[] = [
  "users", "posts", "groups",
  "group_messages", "conversations", "direct_messages", "conversation_members",
  "channels", "channel_members",
  "projects", "project_members",
  "git_commits", "git_refs", "git_files", "git_commit_files", "post_projects",
  "notifications", "reports",
  "github_connections", "project_links", "project_sessions",
  "post_likes", "comments", "follows", "group_members",
  "issues", "issue_comments",
  "pull_requests",
  "project_pages",
  "reactions", "reposts",
  "bookmarks", "stories", "message_reactions", "message_pins",
  "proofs", "snippets", "review_corrections",
  "project_tasks", "project_applications",
  "project_forks", "project_ratings",
  "communities", "community_members",
];

function seed(): DemoStore {
  return {
    users: structuredClone(DEMO_USERS) as unknown as Row[],
    posts: structuredClone(DEMO_POSTS) as unknown as Row[],
    groups: structuredClone(DEMO_GROUPS) as unknown as Row[],
    group_messages: structuredClone(DEMO_GROUP_MESSAGES) as unknown as Row[],
    conversations: structuredClone(DEMO_CONVERSATIONS) as unknown as Row[],
    direct_messages: structuredClone(DEMO_DIRECT_MESSAGES) as unknown as Row[],
    // La table de jonction est vide au départ : elle se remplit au
    // chargement par le rejeu du déclencheur, exactement comme en base.
    conversation_members: [],
    channels: structuredClone(DEMO_CHANNELS) as unknown as Row[],
    channel_members: structuredClone(DEMO_CHANNEL_MEMBERS) as unknown as Row[],
    projects: structuredClone(DEMO_PROJECTS) as unknown as Row[],
    project_members: structuredClone(DEMO_PROJECT_MEMBERS) as unknown as Row[],
    git_commits: structuredClone([
      ...DEMO_GIT_COMMITS,
      ...DEMO_GIT_COMMITS_BRANCHES,
    ]) as unknown as Row[],
    git_refs: structuredClone(DEMO_GIT_REFS_BRANCHES) as unknown as Row[],
    git_files: structuredClone([
      ...DEMO_GIT_FILES,
      ...DEMO_GIT_FILES_BRANCHES,
    ]) as unknown as Row[],
    git_commit_files: structuredClone([
      ...DEMO_GIT_COMMIT_FILES,
      ...DEMO_GIT_COMMIT_FILES_BRANCHES,
    ]) as unknown as Row[],
    post_projects: structuredClone(DEMO_POST_PROJECTS) as unknown as Row[],
    // Alimentée par le rejeu des déclencheurs au chargement, comme
    // `conversation_members` : un jeu de données écrit à la main
    // finirait par ne plus correspondre aux tables d'origine.
    notifications: [],
    reports: structuredClone(DEMO_REPORTS) as unknown as Row[],
    github_connections: structuredClone(DEMO_GITHUB_CONNECTIONS) as unknown as Row[],
    project_links: structuredClone(DEMO_PROJECT_LINKS) as unknown as Row[],
    project_sessions: structuredClone(DEMO_PROJECT_SESSIONS) as unknown as Row[],
    post_likes: structuredClone(DEMO_POST_LIKES) as unknown as Row[],
    follows: structuredClone(DEMO_FOLLOWS) as unknown as Row[],
    group_members: structuredClone(DEMO_GROUP_MEMBERS) as unknown as Row[],
    communities: structuredClone(DEMO_COMMUNITIES) as unknown as Row[],
    community_members: structuredClone(DEMO_COMMUNITY_MEMBERS) as unknown as Row[],
    issues: structuredClone(DEMO_ISSUES) as unknown as Row[],
    issue_comments: structuredClone(DEMO_ISSUE_COMMENTS) as unknown as Row[],
    project_pages: structuredClone(DEMO_PROJECT_PAGES) as unknown as Row[],
    pull_requests: structuredClone(DEMO_PULL_REQUESTS) as unknown as Row[],
    reactions: structuredClone(DEMO_REACTIONS) as unknown as Row[],
    reposts: structuredClone(DEMO_REPOSTS) as unknown as Row[],
    bookmarks: structuredClone(DEMO_BOOKMARKS) as unknown as Row[],
    stories: structuredClone(DEMO_STORIES) as unknown as Row[],
    message_reactions: structuredClone(DEMO_MESSAGE_REACTIONS) as unknown as Row[],
    message_pins: structuredClone(DEMO_MESSAGE_PINS) as unknown as Row[],
    // Les réponses en fil vivent dans `comments`, pas dans une table à
    // part : les fusionner ici évite une jointure pour les lire, et
    // garde le compteur de commentaires — qui les compte — exact.
    comments: [
      ...structuredClone(DEMO_COMMENTS) as unknown as Row[],
      ...structuredClone(DEMO_COMMENT_REPLIES) as unknown as Row[],
    ],
    // Vide au départ : le rejeu des déclencheurs de la 023 les remplit,
    // exactement comme en base.
    proofs: [],
    snippets: structuredClone(DEMO_SNIPPETS) as unknown as Row[],
    review_corrections: structuredClone(DEMO_REVIEW_CORRECTIONS) as unknown as Row[],
    project_tasks: structuredClone(DEMO_PROJECT_TASKS) as unknown as Row[],
    project_applications: structuredClone(DEMO_PROJECT_APPLICATIONS) as unknown as Row[],
    // Le seed ne pose pas de fork ni de note : un fork est un geste de
    // cette session, une notation vient de ce jury. Des lignes d'origine
    // feraient afficher des actions que personne n'a posées.
    project_forks: [],
    project_ratings: [],
  };
}

/**
 * Recalcule les compteurs mis en cache à partir des tables de jonction.
 *
 * C'est l'équivalent exact des quatre déclencheurs de la migration 005
 * (`sync_post_likes`, `sync_post_comments`, `sync_follows`,
 * `sync_group_members`). On les rejoue à chaque sauvegarde plutôt qu'à
 * chaque écriture : il n'y a que quelques centaines de lignes en démo,
 * et cela rend impossible d'avoir un compteur désynchronisé — ce qui est
 * le seul vrai risque ici.
 *
 * Le recalcul se fait aussi au premier chargement : `DEMO_POSTS` déclare
 * des compteurs pour l'apparence, et ils sont immédiatement corrigés
 * pour que la démo ne mente pas sur son propre modèle.
 */
function syncCounters(store: DemoStore): DemoStore {
  const count = (rows: Row[], match: (r: Row) => boolean): number =>
    rows.reduce((n, r) => (match(r) ? n + 1 : n), 0);

  for (const p of store.posts) {
    const id = p.id;
    p.likes = count(store.post_likes, (l) => l.post_id === id);
    p.comments = count(store.comments, (c) => c.post_id === id);
    p.reactions = count(store.reactions, (r) => r.post_id === id);
    p.reposts = count(store.reposts, (r) => r.post_id === id);
  }

  // Les stories périmées ne sont pas « cachées » par un drapeau : elles
  // sont retirées. Une story morte qui resterait en table se
  // compterait dans le rail et laisserait croire qu'elle est encore
  // lisible — le défaut exact qu'on refuse ailleurs.
  store.stories = store.stories.filter(
    (s) => Date.parse(String(s.expires_at ?? 0)) > Date.now(),
  );

  for (const u of store.users) {
    const id = u.id;
    u.followers = count(store.follows, (f) => f.followee_id === id);
    u.following = count(store.follows, (f) => f.follower_id === id);
  }

  for (const g of store.groups) {
    const id = g.id;
    g.member_count = count(store.group_members, (m) => m.group_id === id);
  }

  // Même rejeu que pour les groupes (migration 028) : le compteur d'une
  // communauté est un cache de ses adhésions.
  for (const c of store.communities) {
    const id = c.id;
    c.member_count = count(store.community_members, (m) => m.community_id === id);
  }

  // Rejeu du déclencheur `posts_sync_tags` (migration 007).
  //
  // Les hashtags sont un cache de `text`, exactement comme `likes` est un
  // cache de `post_likes`. On les recalcule au chargement plutôt que de
  // les écrire dans le jeu de données : une seule règle, au même endroit
  // que les autres, et aucun risque de dérive entre le texte et sa colonne.
  for (const p of store.posts) {
    p.tags = extractTags(String(p.text ?? ""));
  }

  // Rejeu du déclencheur `conversations_sync_members` (migration 006).
  ////  On repart d'une table vide et on la reconstruit depuis
  // `participants` : c'est plus simple qu'un `on conflict do nothing`,
  // et ça garantit qu'aucune ligne ne survit à la disparition de la
  // conversation à laquelle elle appartenait.
  const membership = store.conversations.flatMap((c) =>
    ((c.participants as string[]) ?? []).map((uid) => {
      // `last_read_at` n'est pas posé par défaut : un `null` signifie
      // « pas encore lu », et c'est le bon état initial. Le poser à la
      // création ferait dire « lu » sur des messages que personne n'a
      // ouverts. Le lecteur se le pose en ouvrant la conversation —
      // c'est exactement ce que fait `markConversationRead`.
      const previous = store.conversation_members.find(
        (m) => m.conversation_id === c.id && m.user_id === uid,
      );
      return {
        conversation_id: c.id as string,
        user_id: uid,
        last_read_at: (previous?.last_read_at ?? null) as string | null,
      };
    }),
  );
  store.conversation_members = membership;

  // Rejeu des quatre déclencheurs de la migration 010 (like, abonnement,
  // mention, message). Comme les compteurs ci-dessus, les notifications
  // sont **dérivées** : le rejeu n'ajoute que les événements qui n'ont
  // pas encore de ligne, et ne touche jamais à un `read_at` déjà posé
  // par le lecteur. C'est ce qui garantit que la démo produit exactement
  // les mêmes lignes que Postgres.
  replayNotifications(store);

  // Rejeu des déclencheurs de la preuve (migration 023). Même logique que
  // les notifications : les preuves sont **dérivées**, donc on les
  // recalcule au lieu de les lire. Le rejeu préserve les exécutions, qui
  // viennent du client et n'ont pas de ligne source.
  replayProofs(store);

  return store;
}

let cache: DemoStore | null = null;

export function isTable(name: string): name is keyof DemoStore {
  return (TABLES as string[]).includes(name);
}

/** Charge le store depuis localStorage, ou le semence au premier accès. */
export function getStore(): DemoStore {
  if (cache) return cache;
  if (typeof window === "undefined") return (cache = syncCounters(seed()));

  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoStore>;
      const fresh = seed();
      // On repart du seed et on ne garde que les tables présentes :
      // un store corrompu ou incomplet ne doit pas casser la démo.
      for (const t of TABLES) {
        if (Array.isArray(parsed[t])) fresh[t] = parsed[t] as Row[];
      }
      return (cache = syncCounters(fresh));
    }
  } catch {
    /* localStorage indisponible ou JSON invalide : on repart du seed. */
  }

  const fresh = syncCounters(seed());
  save(fresh);
  return (cache = fresh);
}

export function save(store: DemoStore = getStore()): void {
  // Les compteurs sont recalculés à chaque écriture : ils sont un cache
  // de la table de jonction, jamais une donnée que le client fournit.
  syncCounters(store);
  cache = store;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota dépassé ou stockage bloqué : la démo reste utilisable en mémoire. */
  }
}

/** Vide le store et repart du jeu de données d'origine. */
export function resetStore(): void {
  cache = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* rien à faire */
  }
  cache = seed();
  syncCounters(cache);
}

/** Identifiant court, suffisant pour un store local. */
export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}