import type {
  Bookmark, Comment, MessagePin, MessageReaction, Story,
} from "@/lib/types";
import { DEMO_POSTS, DEMO_USERS } from "./data";
import { DEMO_COMMENTS } from "./social";

/**
 * Signets, discussions, messagerie, stories — le jeu de démonstration.
 *
 * Trois règles valent ici comme partout ailleurs dans `lib/demo/` :
 *
 * - une donnée **dérivée** ne s'écrit pas à la main (les compteurs
 *   viennent des tables de jonction) ;
 * - une donnée dont l'absence serait **falsifiable** ne se fabrique pas
 *   (on ne prétend pas que quelqu'un a vu un message qu'il n'a pas pu
 *   voir) ;
 * - une ligne qui n'aurait pas de sens en base est refusée ici aussi
 *   (clé étrangère, unicité, expiration).
 */

const t0 = Date.parse("2026-10-03T14:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;

const ago = (ms: number): string => new Date(t0 - ms).toISOString();

const USER_IDS = new Set(DEMO_USERS.map((u) => u.id));

/**
 * Les identifiants des commentaires existants, par publication.
 *
 * Sert à **vérifier** qu'un parent désigné vit bien sur la même
 * publication que sa réponse. La constitution précédente choisissait le
 * parent par auteur dans une table globale — et le troisième rattachement
 * pointait vers un commentaire d'une **autre** publication : en base, la
 * clé étrangère l'aurait accepté (elle ne contraint pas le post), mais le
 * fil affichait une réponse sous un commentaire qu'elle ne répondait
 * pas. Le genre de ligne qui a l'air normale et qui ment.
 */
const COMMENT_IDS_BY_POST = new Map<string, Set<string>>();
for (const c of DEMO_COMMENTS) {
  const set = COMMENT_IDS_BY_POST.get(c.post_id) ?? new Set<string>();
  set.add(c.id);
  COMMENT_IDS_BY_POST.set(c.post_id, set);
}

/** Vrai si `parentId` peut recevoir une réponse sur `postId`. */
function parentFits(parentId: string, postId: string): boolean {
  return COMMENT_IDS_BY_POST.get(postId)?.has(parentId) ?? false;
}

/**
 * Les signets.
 *
 * Volontairement **sparse** : quatre signets, pas la moitié du fil. Un
 * jeu de démonstration où tout le monde a tout enregistré ne montre
 * rien — une liste de lecture n'a d'intérêt que si elle est courte, et
 * qu'on voit clairement ce qu'on a choisi de garder.
 *
 * On ne garde que des identifiants d'auteurs réels : un signet vers un
 * compte inexistant est une ligne que Postgres refuserait.
 */
export const DEMO_BOOKMARKS: Bookmark[] = [
  { post_id: "p-11", user_id: "u-koffi", created_at: ago(6 * HOUR) },
  { post_id: "p-16", user_id: "u-koffi", created_at: ago(2 * HOUR) },
  { post_id: "p-3", user_id: "u-koffi", created_at: ago(28 * MIN) },
  { post_id: "p-18", user_id: "u-aminata", created_at: ago(9 * HOUR) },
]
  .filter((b) => USER_IDS.has(b.user_id))
  .filter((b) => DEMO_POSTS.some((p) => p.id === b.post_id));

/**
 * Les réponses en fil.
 *
 * Quatre réponses, `parent_id` nommé **explicitement** et vérifié : le
 * parent doit exister et vivre sur la même publication. On ne déduit pas
 * « le premier commentaire de ce post », parce que le rattachement d'une
 * réponse change alors de cible dès qu'on insère un commentaire au-dessus
 * — un test qui bouge tout seul.
 *
 * La quatrième répond à `cr-1`, une **réponse**. Le client n'en produit
 * jamais (il remonte à la racine, voir `lib/social.ts`), mais la base
 * l'autorise : elle ne refuse qu'un parent qui serait la ligne elle-même.
 * Le cas est présent exprès — c'est lui qui prouve que l'interface sait
 * remonter à la racine au lieu d'afficher une réponse orpheline.
 */
const RAW_REPLIES: {
  post_id: string;
  author_id: string;
  parent_id: string;
  text: string;
  after: number;
}[] = [
  { post_id: "p-1", author_id: "u-youssef", parent_id: "c-1",
    text: "Le `;` en trop, c'est ma spécialité. J'ai perdu un week-end là-dessus une fois.",
    after: 30 },
  { post_id: "p-1", author_id: "u-chioma", parent_id: "c-2",
    text: "Les messages d'erreur qui ne disent rien, c'est la moitié du métier. Le reste, c'est de savoir quoi écrire.",
    after: 42 },
  { post_id: "p-11", author_id: "u-zainab", parent_id: "c-17",
    text: "J'ai exactement ce fichier de 200 Mo chez moi. Merci d'avoir laissé le code, ça m'évite une nuit.",
    after: 55 },
  // Réponse à une réponse : `parent_id` désigne `cr-1`, pas une racine.
  { post_id: "p-1", author_id: "u-aminata", parent_id: "cr-1",
    text: "Pareil, et c'est exactement ce que fait un linter quand on le laisse faire son travail.",
    after: 70 },
];

export const DEMO_COMMENT_REPLIES: Comment[] = RAW_REPLIES
  .filter((r) => USER_IDS.has(r.author_id))
  .map((r, i) => {
    const id = `cr-${i + 1}`;
    // Un parent qui répond à un autre commentaire **de ce même jeu**
    // (une réponse à une réponse) est légitime ; un parent vers un
    // commentaire racine doit vivre sur la même publication. Tout le
    // reste est un rattachement faux qu'on refuse plutôt que d'afficher
    // un fil qui ment.
    const knownReply = r.parent_id.startsWith("cr-");
    const parent = knownReply
      ? r.parent_id
      : parentFits(r.parent_id, r.post_id)
        ? r.parent_id
        : null;

    return {
      id,
      post_id: r.post_id,
      author_id: r.author_id,
      parent_id: parent,
      text: r.text,
      created_at: ago(r.after * MIN),
    };
  });

/**
 * Les réactions sur les messages.
 *
 * Quelques-unes seulement, et **sur des messages qui existent**. Une
 * réaction sur un message absent est exactement le défaut qu'on refuse
 * partout ailleurs : une ligne qui pointe dans le vide et que
 * l'interface afficherait quand même, collée à la mauvaise bulle.
 */
export const DEMO_MESSAGE_REACTIONS: MessageReaction[] = [
  { id: "mr-1", target_type: "group_message", target_id: "gm-2", user_id: "u-koffi",
    emoji: "\u2705", created_at: ago(44 * MIN) },
  { id: "mr-2", target_type: "group_message", target_id: "gm-2", user_id: "u-thabo",
    emoji: "\u2764\uFE0F", created_at: ago(42 * MIN) },
  { id: "mr-3", target_type: "group_message", target_id: "gm-9", user_id: "u-zainab",
    emoji: "\u{1F602}", created_at: ago(88 * MIN) },
  { id: "mr-4", target_type: "direct_message", target_id: "dm-4", user_id: "u-koffi",
    emoji: "\u2705", created_at: ago(36 * MIN) },
];

/**
 * Les épingles.
 *
 * Un seul, et il est posé par le lecteur de démonstration : un épingle
 * qu'on ne peut pas retirer depuis l'interface où on veut le montrer
 * serait une fonctionnalité non démontrable.
 */
export const DEMO_MESSAGE_PINS: MessagePin[] = [
  {
    id: "mp-1",
    target_type: "group_message",
    target_id: "gm-2",
    user_id: "u-koffi",
    created_at: ago(40 * MIN),
  },
];

/**
 * Les stories.
 *
 * Trois, dont une **périmée** : une démo où toutes les stories sont
 * vivantes ne montre jamais le filtre d'expiration, donc ne prouve
 * rien. La périmée est là pour qu'on voie la liste la retirer.
 *
 * `media_url` est vide : une story sans média se lit quand même, et
 * c'est le cas que le moteur doit savoir afficher sans planter. Le
 * stockage configuré plus tard remplira la colonne.
 */
export const DEMO_STORIES: Story[] = [
  {
    id: "s-1",
    author_id: "u-koffi",
    caption: "Le registre des coopératives tourne enfin. Trois jours de retard, un typage strict, et cette boucle.",
    media_url: "",
    created_at: ago(3 * HOUR),
    // Vivante : dans deux heures, comme une story qui vient d'être
    // postée.
    expires_at: new Date(t0 + 2 * HOUR).toISOString(),
  },
  {
    id: "s-2",
    author_id: "u-aminata",
    caption: "Présentation de mon modèle aujourd'hui. J'espère que mes coefficients ne surapprennent pas.",
    media_url: "",
    created_at: ago(50 * MIN),
    expires_at: new Date(t0 + 23 * HOUR).toISOString(),
  },
  {
    id: "s-3",
    author_id: "u-thabo",
    caption: "Writeup du CTF publié. L'injection était encore dans un ORDER BY concaténé.",
    media_url: "",
    created_at: ago(2 * 24 * HOUR),
    // Périmée : elle ne doit apparaître nulle part, ni dans le rail, ni
    // dans le compteur de stories.
    expires_at: ago(4 * HOUR),
  },
].filter((s) => USER_IDS.has(s.author_id));
