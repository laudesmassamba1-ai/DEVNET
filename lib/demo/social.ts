import type { Comment, Follow, GroupMember, GroupRole, PostLike, PostProject, Reaction, Repost } from "@/lib/types";
import { DEMO_GROUPS, DEMO_POSTS, DEMO_USERS } from "./data";

/**
 * Données du graphe social en mode démo.
 *
 * Elles vivent à part de `data.ts` parce qu'elles sont **dérivées** :
 * un like est une ligne, donc il se déduit du `liked_by` qu'on avait
 * déjà, et le compteur du post se recalcule ensuite. Écrire `likes: 34`
 * dans `data.ts` pendant que `post_likes` n'en contient que 2
 * produirait une démo qui ment sur son propre modèle — exactement le
 * bug que la migration 005 supprime côté Postgres.
 *
 * Conséquence assumée : les compteurs de la démo sont petits (2 à 4
 * likes), parce qu'il n'y a que sept utilisateurs de démonstration.
 * C'est le bon compromis : un « 211 likes » qui n'a pas 211 lignes
 * derrière teachrait le mauvais réflexe.
 */

/** Tous les identifiants d'utilisateurs connus du jeu de démonstration. */
const USER_IDS = new Set(DEMO_USERS.map((u) => u.id));

/**
 * Les likes existing, convertis en lignes.
 *
 * On ne garde que les identifiants d'utilisateurs réels : un like pointant
 * vers un utilisateur inexistant est une ligne que Postgres refuserait
 * (clé étrangère), donc le mode démo doit la refuser aussi.
 */
export const DEMO_POST_LIKES: PostLike[] = DEMO_POSTS.flatMap((p) =>
  (p.liked_by ?? [])
    .filter((uid) => USER_IDS.has(uid))
    .map((uid, j) => ({
      post_id: p.id,
      user_id: uid,
      // Les likes les plus anciens d'un post sont les plus proches de sa
      // publication : l'ordre se lit dans le temps.
      created_at: new Date(
        Date.parse(p.created_at) + (j + 1) * 7 * 60_000,
      ).toISOString(),
    })),
);

/**
 * Les commentaires.
 *
 * Écrits à la main plutôt que générés : un commentaire de démo doit
 * ressembler à ce qu'un étudiant écrirait, pas à « commentaire 1 ».
 * Ils sont groupés par post pour que la lecture d'un fil soit plausible.
 */
const RAW_COMMENTS: { post_id: string; author_id: string; text: string; after: number }[] = [
  { post_id: "p-1", author_id: "u-thabo", after: 4, text: "Le classique. Moi c'était un `;` en moins dans une boucle for. Trois heures." },
  { post_id: "p-1", author_id: "u-zainab", after: 9, text: "Le pire c'est quand le message d'erreur existe mais ne dit rien d'utile. Bon courage à tous." },
  { post_id: "p-1", author_id: "u-youssef", after: 16, text: "Moi j'ai passé une journée entière sur un `None` qui venait d'une fonction forgotten son return." },
  { post_id: "p-1", author_id: "u-marcus", after: 25, text: "D'où la blague : si le navigateur ne dit rien, ce n'est pas qu'il n'a rien à dire, c'est qu'il a abandonné." },

  { post_id: "p-2", author_id: "u-koffi", after: 6, text: "Ça m'a servi la semaine dernière. Le typage strict avait trouvé exactement le bug que je cherchais." },
  { post_id: "p-2", author_id: "u-chioma", after: 11, text: "Tu peux partager le dépôt ? Je voudrais voir comment tu structures tes validateurs." },

  { post_id: "p-3", author_id: "u-zainab", after: 8, text: "Tu es sur quelle fréquence ? Ici la 4G tient mais c'est pas un miracle." },
  { post_id: "p-3", author_id: "u-thabo", after: 13, text: "En règle générale on voit ~1.2 Mbps en 4G ici, et ça descend vite quand il y a du monde." },
  { post_id: "p-3", author_id: "u-marcus", after: 21, text: "La latence est le vrai problème, pas la bande passante. Pour du dev distant c'est ça qui tue." },

  { post_id: "p-4", author_id: "u-aminata", after: 5, text: "La courbe d'apprentissage est réelle, mais en trois semaines j'avais déjà mon premier déploiement." },
  { post_id: "p-4", author_id: "u-youssef", after: 10, text: "Tu regrettes le passage ? Honnêtement, non." },
  { post_id: "p-4", author_id: "u-koffi", after: 18, text: "Ce qui m'a Popup, c'est le typage. On ne revient pas en arrière après ça." },

  { post_id: "p-5", author_id: "u-chioma", after: 7, text: "On a exactement ce problème en ce moment sur la partie auth. Le timer est notre ennemi." },
  { post_id: "p-5", author_id: "u-thabo", after: 12, text: "Si tu peux mutualiser une seule requête pour résoudre plusieurs ressources, tu gagnes beaucoup." },
  { post_id: "p-5", author_id: "u-marcus", after: 19, text: "Et `stale-while-revalidate` si tu peux tolérer un décalage sur l'affichage." },

  { post_id: "p-6", author_id: "u-koffi", after: 9, text: "La doc est honnête sur ce point, au moins. C'est rare." },

  // Trois commentaires qui **mentionnent** quelqu'un : sans eux, le
  // centre de notifications aurait un type vide, et une démonstration
  // qui ne montre pas une fonctionnalité est une fonctionnalité dont on
  // ne peut pas dire qu'elle marche. Ils sont écrits comme on écrit :
  // le pseudo au début d'une phrase, au milieu d'un remerciement.
  { post_id: "p-11", author_id: "u-thabo", after: 34, text: "@koffi ta version itérative m'a sauvé sur un fichier de 200 Mo. Merci d'avoir laissé le code." },
  { post_id: "p-18", author_id: "u-chioma", after: 41, text: "Deux cents lignes, c'est déjà un vrai outil. @koffi si tu veux un relecteur, dis-le." },
  { post_id: "p-7", author_id: "u-marcus", after: 12, text: "@zainab le `gap` m'a réglé le même problème hier soir." },
];

export const DEMO_COMMENTS: Comment[] = RAW_COMMENTS.filter((c) =>
  // Commentaire signé par quelqu'un qui existe : sinon la jointure
  // d'affichage rendrait `null` et la ligne ressemblerait à un bug.
  USER_IDS.has(c.author_id),
).map((c, i) => ({
  id: `c-${i + 1}`,
  post_id: c.post_id,
  author_id: c.author_id,
  text: c.text,
  created_at: new Date(
    Date.parse(
      DEMO_POSTS.find((p) => p.id === c.post_id)?.created_at ?? new Date().toISOString(),
    ) + c.after * 60_000,
  ).toISOString(),
}));

/**
 * Le graphe de suivi.
 *
 * Volontairement **non symétrique** : un réseau où tout le monde suit
 * tout le monde ne montre pas le graphe. Ici il y a des comptes très
 * suivis et des comptes quiet, comme dans le vrai.
 */
const RAW_FOLLOWS: [string, string][] = [
  // autour de koffi
  ["u-koffi", "u-aminata"],
  ["u-koffi", "u-thabo"],
  ["u-koffi", "u-zainab"],
  ["u-koffi", "u-marcus"],
  ["u-koffi", "u-chioma"],
  ["u-aminata", "u-koffi"],
  ["u-thabo", "u-koffi"],
  ["u-zainab", "u-koffi"],
  ["u-chioma", "u-koffi"],
  ["u-youssef", "u-koffi"],

  // entre les autres
  ["u-aminata", "u-thabo"],
  ["u-aminata", "u-zainab"],
  ["u-thabo", "u-aminata"],
  ["u-thabo", "u-youssef"],
  ["u-zainab", "u-chioma"],
  ["u-chioma", "u-zainab"],
  ["u-chioma", "u-marcus"],
  ["u-marcus", "u-chioma"],
  ["u-youssef", "u-marcus"],
  ["u-marcus", "u-youssef"],
];

export const DEMO_FOLLOWS: Follow[] = RAW_FOLLOWS.filter(
  ([a, b]) => USER_IDS.has(a) && USER_IDS.has(b) && a !== b,
).map(([follower_id, followee_id], i) => ({
  follower_id,
  followee_id,
  created_at: new Date(Date.parse("2026-09-01T09:00:00Z") + i * 3_600_000).toISOString(),
}));

/**
 * Les promotions posées par un créateur de groupe (migration 020).
 *
 * Le jeu de démonstration doit montrer **les deux cas** qui rendent le
 * rôle réel : Koffi est créateur de « Débutants en algo » — il y gère
 * les rôles — et il est **modérateur** de « Python Afrique », un groupe
 * qu'il ne possède pas : il y voit les pouvoirs de modération sans en
 * être le créateur. Un rôle qui ne se verrait que chez le créateur
 * serait une étiquette, pas une capacité.
 */
const PROMOTIONS: Record<string, Record<string, GroupRole>> = {
  "g-1": { "u-koffi": "moderator" },
};

/** L'adhésion aux groupes, déduite du tableau `members` historique. */
export const DEMO_GROUP_MEMBERS: GroupMember[] = DEMO_GROUPS.flatMap((g) =>
  (g.members ?? [])
    .filter((uid) => USER_IDS.has(uid))
    .map((uid, i) => ({
      group_id: g.id,
      user_id: uid,
      role: uid === g.created_by
        ? ("owner" as const)
        : PROMOTIONS[g.id]?.[uid] ?? ("member" as const),
      joined_at: new Date(
        Date.parse(g.created_at) + (i + 1) * 3_600_000,
      ).toISOString(),
    })),
);
/**
 * Les rattachements publication ↔ projet (migration 009).
 *
 * Écrits à la main plutôt que générés : une démonstration doit montrer un
 * rapport believable. Deux publications de Koffi rattachées à son projet
 * disent « cette idée vient de ce dépôt » ; un rattachement au hasard sur
 * n'importe quel post dirait l'inverse, et le lien perdrait tout son
 * sens.
 */
export const DEMO_POST_PROJECTS: PostProject[] = [
  { post_id: "p-11", project_id: "p-1" },
  { post_id: "p-18", project_id: "p-1" },
];

/**
 * Les réactions en mode démo.
 *
 * Parce qu'une réaction est une ligne, tout comme un like : on ne met pas
 * de compteur dans `DEMO_POSTS`, on met des lignes dans cette table, et le
 * compteur se déduit au chargement.
 *
 * Une réaction par personne et par publication, comme en base.
 */
export const DEMO_REACTIONS: Reaction[] = [
  { post_id: "p-1", user_id: "u-zainab", emoji: "\u2705", created_at: new Date(Date.parse(DEMO_POSTS[0].created_at) + 2 * 60_000).toISOString() },
  { post_id: "p-1", user_id: "u-marcus", emoji: "\u{1F602}", created_at: new Date(Date.parse(DEMO_POSTS[0].created_at) + 4 * 60_000).toISOString() },
  { post_id: "p-2", user_id: "u-koffi", emoji: "\u2764\uFE0F", created_at: new Date(Date.parse(DEMO_POSTS[1].created_at) + 1 * 60_000).toISOString() },
  { post_id: "p-2", user_id: "u-thabo", emoji: "\u{1F525}", created_at: new Date(Date.parse(DEMO_POSTS[1].created_at) + 3 * 60_000).toISOString() },
  { post_id: "p-3", user_id: "u-aminata", emoji: "\u{1F62E}", created_at: new Date(Date.parse(DEMO_POSTS[2].created_at) + 5 * 60_000).toISOString() },
  { post_id: "p-6", user_id: "u-thabo", emoji: "\u{1F525}", created_at: new Date(Date.parse(DEMO_POSTS[5].created_at) + 8 * 60_000).toISOString() },
  { post_id: "p-9", user_id: "u-chioma", emoji: "\u2705", created_at: new Date(Date.parse(DEMO_POSTS[8].created_at) + 10 * 60_000).toISOString() },
  { post_id: "p-18", user_id: "u-zainab", emoji: "\u{1F622}", created_at: new Date(Date.parse(DEMO_POSTS[17].created_at) + 15 * 60_000).toISOString() },
];

/**
 * Les reposts en mode démo.
 *
 * Même forme que `post_likes` : une ligne qui dit « ce post est repris par
 * cet auteur ». Le compteur se déduit, et le doublon est impossible car la
 * clé primaire l'interdit.
 */
export const DEMO_REPOSTS: Repost[] = [
  { post_id: "p-2", user_id: "u-marcus", created_at: new Date(Date.parse(DEMO_POSTS[1].created_at) + 20 * 60_000).toISOString() },
  { post_id: "p-7", user_id: "u-aminata", created_at: new Date(Date.parse(DEMO_POSTS[6].created_at) + 18 * 60_000).toISOString() },
];
