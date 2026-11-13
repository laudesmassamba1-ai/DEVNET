import type { IconName } from "@/components/Icon";
import { LEVELS, levelFor } from "@/lib/gamification";

/**
 * Le badge vérifié : **un cachet de base, dix variantes de palier**.
 *
 * Le badge dit deux choses qui se superposent :
 *
 * 1. le compte est **vérifié** — quelqu'un a confirmé l'identité
 *    (c'est le cachet de base, celui des comptes officiels) ;
 * 2. cette personne a **avancé** — son palier se lit dans la variante.
 *
 * On ne pouvait jusqu'ici ni demander la vérification ni la distinguer :
 * `verified` n'était qu'un booléen posé à l'inscription et affiché tel quel.
 * Les dix variantes sont **calées sur `LEVELS`** (une table existante,
 * jamais recopiée) : « Bâtisseur » au palier 5, « Ambassadeur » au 9,
 * « Légende » au 10 — exactement les titres que le profil annonce déjà.
 *
 * Module **pur** : ni lecture, ni écriture, ni `Date.now()`. Il se teste
 * à la voix, comme `lib/gamification.ts` et `lib/rating.ts`.
 */

/** L'état d'une demande de vérification — quatre valeurs closes. */
export type VerificationStatus = "none" | "attente" | "acceptee" | "refusee";

/**
 * La silhouette du cachet : onze découpes, une par forme.
 *
 * C'est **la** marque du palier. Un dégradé ne suffit pas : en 13 px,
 * deux pastilles de teintes voisines se confondent dans un fil, alors
 * qu'un losange et un sceau ne se confondent jamais. La couleur suit la
 * silhouette (une teinte par découpe, dans la feuille de style) — les
 * tons ambre et or restent au cachet de base et à la Légende, comme le
 * veut le système.
 *
 * Le badge **ne porte aucun mot** : le titre vit dans le `title` et
 * l'`aria-label`, et les pages qui l'affichent disent déjà le palier.
 */
export type BadgeShape =
  | "round"
  | "diamond"
  | "triangle"
  | "pentagon"
  | "hexagon"
  | "octagon"
  | "square"
  | "star4"
  | "shield"
  | "star6"
  | "seal";

export interface VerifiedBadge {
  /** `0` pour le cachet de base, `1…10` pour un palier. */
  index: number;
  /** Mot d'ordre — la classe du badge, pas celle du palier. */
  key: string;
  /** Étiquette du palier — jamais peinte sur le badge. */
  label: string;
  /** Ce que dit le badge au survol. */
  motto: string;
  shape: BadgeShape;
  icon: IconName;
  /**
   * La marque officielle, posée par `badgeFor` sur le seul compte
   * d'administration. Ce n'est pas une forme de plus : c'est la même
   * silhouette, cerclée d'or. Un administrateur reste un palier — il a
   * seulement l'anneau de l'équipe par-dessus.
   */
  admin?: boolean;
}

/**
 * Le cachet de base : le compte est confirmé, sans palier connu.
 *
 * C'est le cachet générique — celui qu'on montre dans un fil quand on ne
 * connaît pas l'XP de l'auteur, et celui que l'administration affiche
 * dans ses propres écrans. Un compte **d'administration** ne le porte
 * plus à la place de son palier : il garde sa silhouette et reçoit
 * l'anneau officiel (`admin`).
 */
export const VERIFY_BASE: VerifiedBadge = {
  index: 0,
  key: "verifie",
  label: "Vérifié",
  motto: "Identité confirmée par l'équipe DevNet.",
  shape: "round",
  icon: "check",
};

/**
 * Les dix variantes de palier.
 *
 * `icon` n'est pas décoratif : c'est l'emblème, ce qui reste lisible
 * quand le cachet est tout petit. Les titres viennent de `LEVELS`
 * (import ci-dessus) — mais l'emblème et la silhouette, eux, sont posés
 * ici, parce que `Level` ne porte ni icône ni forme.
 */
const TIER_ICONS: IconName[] = [
  "plus", // 1 Nouveau
  "eye", // 2 Explorateur
  "code", // 3 Apprenti
  "branch", // 4 Contributeur
  "package", // 5 Bâtisseur
  "groups", // 6 Pédagogue
  "layers", // 7 Architecte
  "lock", // 8 Gardien
  "globe", // 9 Ambassadeur
  "trophy", // 10 Légende
];

/** Une silhouette par palier, dans l'ordre des niveaux — jamais deux fois la même. */
const TIER_SHAPES: BadgeShape[] = [
  "diamond", //  1 Nouveau
  "triangle", // 2 Explorateur
  "pentagon", // 3 Apprenti
  "hexagon", //  4 Contributeur
  "octagon", //  5 Bâtisseur
  "square", //   6 Pédagogue
  "star4", //    7 Architecte
  "shield", //   8 Gardien
  "star6", //    9 Ambassadeur
  "seal", //    10 Légende
];

/**
 * Les dix variantes, construites **depuis `LEVELS`**.
 *
 * Une table à la main aurait fini par diverger du profil : le jour où un
 * palier est renommé, l'écran dirait une chose et le badge une autre.
 * On ne dérive donc que l'emblème et la silhouette, jamais le titre.
 */
export const VERIFY_TIERS: VerifiedBadge[] = LEVELS.map((lvl, i) => ({
  index: lvl.level,
  key: lvl.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-"),
  label: lvl.title,
  motto: lvl.motto,
  shape: TIER_SHAPES[i] ?? "round",
  icon: TIER_ICONS[i] ?? "check",
}));

/** Toutes les formes du badge — base comprise. On en compte 11. */
export const ALL_VERIFY_BADGES: VerifiedBadge[] = [VERIFY_BASE, ...VERIFY_TIERS];

/**
 * Le cachet officiel : le rond de base, anneau de l'équipe compris.
 *
 * Il sert aux écrans qui parlent d'un compte d'administration **sans
 * connaître son palier** — la file et l'annuaire de `/admin`. Ailleurs
 * c'est `badgeFor` qui pose l'anneau, sur la silhouette du palier.
 */
export const VERIFY_OFFICIAL: VerifiedBadge = { ...VERIFY_BASE, admin: true };

function clampTier(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(Math.max(Math.round(level), 1), VERIFY_TIERS.length);
}

/** La variante de badge pour un palier donné (borné à 1…10). */
export function badgeForLevel(level: number): VerifiedBadge {
  return VERIFY_TIERS[clampTier(level) - 1] ?? VERIFY_BASE;
}

/** La variante de badge pour une somme d'XP. */
export function badgeForXp(xp: number): VerifiedBadge {
  return badgeForLevel(levelFor(xp).level);
}

/**
 * Le badge à afficher pour un compte — son palier, plus l'anneau s'il
 * est de l'équipe.
 *
 * Retourne `null` quand le compte n'est pas vérifié : rien ne s'affiche.
 * Un **administrateur garde son palier** : il l'a bâti comme n'importe
 * qui, et le remplacer par un cachet générique effaçait son travail —
 * c'est ce qui est arrivé à un compte de Légende, dont le sceau a été
 * recouvert par le rond de base. La distinction officielle se pose donc
 * *par-dessus* la silhouette (`admin`), jamais *à la place*.
 *
 * Sans `xp` — `undefined` ou `null` — on ne **sait** pas le palier : le
 * cachet de base est le seul honnête. C'est le cas des listes qui
 * n'agrègent pas l'activité (annuaire de l'administration). Ne pas
 * confondre avec `0`, qui est une mesure : un compte vérifié sans
 * activité est au palier 1.
 */
export function badgeFor(
  profile: { verified?: boolean; is_admin?: boolean } | null | undefined,
  xp?: number | null,
): VerifiedBadge | null {
  if (!profile?.verified) return null;
  if (xp === undefined || xp === null) {
    return profile.is_admin ? VERIFY_OFFICIAL : VERIFY_BASE;
  }
  const badge = badgeForXp(xp);
  return profile.is_admin ? { ...badge, admin: true } : badge;
}

/**
 * L'xp d'un objet profil dont la forme porte éventuellement la mesure.
 *
 * Absent → `undefined`, pas `0` : zéro est une **mesure** (palier 1),
 * l'absence est une ignorance. Confondre les deux faisait afficher un
 * palier 1 à des comptes dont on n'avait simplement pas chargé l'activité.
 */
export function xpOf(profile?: unknown): number | undefined {
  const xp = (profile as { xp?: unknown } | null | undefined)?.xp;
  return typeof xp === "number" ? xp : undefined;
}

/** Libellé d'un état de demande — pour les puces de statut. */
export const VERIFY_STATUS_LABEL: Record<VerificationStatus, string> = {
  none: "Non vérifié",
  attente: "Demande envoyée",
  acceptee: "Vérifié",
  refusee: "Demande refusée",
};

/** Traduit la colonne `verification_status` (null inclus) en état. */
export function asVerificationStatus(value: unknown): VerificationStatus {
  return value === "attente" || value === "acceptee" || value === "refusee"
    ? value
    : "none";
}

/** Le message d'une erreur, quelle que soit sa forme (Error, objet, texte). */
function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message ?? "");
  }
  return "";
}

/**
 * Pourquoi une écriture de vérification a échoué — en clair.
 *
 * Le flux compte deux écritures (la demande, la décision) et **quatre
 * échecs distincts** qu'il ne faut pas confondre :
 *
 *  - `42703` : la base n'a pas les colonnes de la 037. Ce n'est pas une
 *    panne de l'application, c'est une migration non appliquée — et
 *    l'écran doit le dire, sinon « Demande impossible » envoie chercher
 *    le bug dans le navigateur alors qu'il est dans la base ;
 *  - `42501` : la base a refusé, parce que le compte n'a pas le rôle. Un
 *    refus est un résultat, pas une panne ;
 *  - le réseau : le serveur est injoignable, ça se réessaie ;
 *  - le reste : on ne sait pas, et on le dit sans inventer.
 */
export function verificationErrorMessage(err: unknown): string {
  const raw = errorMessage(err);

  if (/42703|does not exist/i.test(raw)) {
    return "Base incomplète : applique la migration 037 (colonnes de la vérification).";
  }
  if (/42501|permission denied/i.test(raw)) {
    return "La base a refusé : ton compte n'a pas le rôle requis.";
  }
  if (/fetch|network|load failed|timeout/i.test(raw)) {
    return "Serveur injoignable — réessaie.";
  }
  return raw ? `Écriture refusée : ${raw}` : "Écriture refusée.";
}
