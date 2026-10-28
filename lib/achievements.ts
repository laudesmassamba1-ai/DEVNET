/**
 * Les succès de DevNet — une couche au-dessus des badges.
 *
 * ## Pourquoi une seconde couche
 *
 * Les **badges** (`lib/gamification.ts`) célèbrent l'activité d'un
 * moment : premier post, semaine de présence. Les **succès** célèbrent
 * une *maîtrise construite dans le temps* : dix projets forkés, une
 * renommée de relecteur, trois langages maîtrisés. Les badges sont la
 * poussière d'or des premiers pas ; les succès sont le trophée du
 * métier.
 *
 * ## La mécanique : trois tiers
 *
 * Chaque succès vient en trois niveaux — bronze, argent, or — séparés
 * par des paliers géométriques (×3 : 3, 9, 27…, ×2 : 10, 20, 40…).
 * Cette progression en puissance reflète la réalité du métier : le
 * premier projet est un exploit, le neuvième est une habitude.
 *
 * Le score affiché d'un profil additionne les tiers obtenus, pondérés
 * bronze 1, argent 3, or 7 — une progression légèrement sur-linéaire
 * qui rend le titre supérieur *sensationnellement* plus rare.
 */

import type { IconName } from "../components/Icon";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type AchievementTier = "bronze" | "argent" | "or";

export interface AchievementDef {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  /** Paliers des trois tiers, croissants. */
  tiers: [number, number, number];
  /** Compteur évalué : le champ de `AchievementCounters` à lire. */
  metric: keyof AchievementCounters;
}

export interface AchievementCounters {
  posts: number;
  commits: number;
  forks: number;
  forksReceived: number;
  reviews: number;
  ratings: number;
  snippets: number;
  projects: number;
  likes: number;
  streakBest: number;
  languages: number;
  challengesDone: number;
}

export interface Achievement {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  /** Tier courant, ou `null` si aucun n'est atteint. */
  tier: AchievementTier | null;
  /** Niveau du tier atteint — 0, 1, 2 ou 3 (aucun = 0). */
  tierLevel: number;
  /** Paliers des trois tiers, dans l'ordre bronze → or. */
  tiers: [number, number, number];
  /** Palier du tier en cours (prochaine cible). */
  nextTarget: number;
  progress: number;
  /** Tous les tiers atteints à ce jour — utile pour l'historique. */
  tiersEarned: AchievementTier[];
}

/* ------------------------------------------------------------------ */
/* Registre                                                           */
/* ------------------------------------------------------------------ */

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "a-artisan", metric: "commits",
    label: "Artisan", hint: "Pousse des commits réguliers sur tes chantiers",
    icon: "branch", tiers: [10, 50, 200],
  },
  {
    id: "a-efficiency", metric: "forks",
    label: "Greffon", hint: "Fork des projets pour t'en servir de base",
    icon: "fork", tiers: [1, 5, 15],
  },
  {
    id: "a-heritage", metric: "forksReceived",
    label: "Héritage", hint: "Des devs forquent tes projets — ton code s'étend",
    icon: "layers", tiers: [1, 10, 50],
  },
  {
    id: "a-review", metric: "reviews",
    label: "Garant", hint: "Relis et corrige le code des autres",
    icon: "eye", tiers: [5, 20, 100],
  },
  {
    id: "a-jury", metric: "ratings",
    label: "Confrère du jury", hint: "Note honnêtement les projets de la communauté",
    icon: "star", tiers: [10, 40, 150],
  },
  {
    id: "a-outils", metric: "snippets",
    label: "Boîte à outils", hint: "Publie des extraits réutilisables",
    icon: "package", tiers: [3, 15, 60],
  },
  {
    id: "a-construction", metric: "projects",
    label: "Bâtisseur", hint: "Lance des projets de bout en bout",
    icon: "grid", tiers: [1, 5, 20],
  },
  {
    id: "a-magnet", metric: "likes",
    label: "Attrape-lumière", hint: "Reçois des likes sur tes contributions",
    icon: "spark", tiers: [25, 150, 1000],
  },
  {
    id: "a-endurance", metric: "streakBest",
    label: "Marathonien", hint: "Tiens une série d'activité longue",
    icon: "flame", tiers: [7, 30, 100],
  },
  {
    id: "a-polyglotte", metric: "languages",
    label: "Polyglotte", hint: "Code dans plusieurs langages",
    icon: "globe", tiers: [3, 6, 10],
  },
  {
    id: "a-regulier", metric: "challengesDone",
    label: "Défieur", hint: "Termine des défis quotidiens",
    icon: "target", tiers: [3, 20, 100],
  },
];

/* ------------------------------------------------------------------ */
/* Barème et évaluation                                               */
/* ------------------------------------------------------------------ */

/** Poids du score par tier : bronze 1, argent 3, or 7. */
export const TIER_WEIGHT: Record<AchievementTier, number> = {
  bronze: 1, argent: 3, or: 7,
};

/** Étiquette lisible d'un tier. */
export function tierLabel(tier: AchievementTier): string {
  return { bronze: "Bronze", argent: "Argent", or: "Or" }[tier];
}

/**
 * Évalue tous les succès d'un profil. La fonction est **pure** : elle
 * ne lit que les compteurs qu'on lui passe, et deux appels avec les
 * mêmes compteurs rendent le même état — testable et déterministe.
 */
export function achievementsFor(counters: AchievementCounters): Achievement[] {
  return ACHIEVEMENTS.map((def) => {
    const value = counters[def.metric] ?? 0;
    const tiersEarned: AchievementTier[] = [];
    let tierLevel = 0;
    let nextTarget = def.tiers[0];

    for (let i = 0; i < def.tiers.length; i++) {
      if (value >= def.tiers[i]) {
        tierLevel = i + 1;
        tiersEarned.push((["bronze", "argent", "or"] as AchievementTier[])[i]);
        nextTarget = def.tiers[i + 1] ?? def.tiers[i];
      }
    }

    // Le tier en cours est le dernier franchi, sinon aucun.
    const tier: AchievementTier | null =
      tierLevel === 0 ? null : tiersEarned[tierLevel - 1];

    // La progression se lit sur la borne en cours : de palier en palier,
    // pas depuis zéro — sinon un profil à 190 commits du tiers or n'en
    // montrerait qu'un cinquième. Tous les paliers franchis : 1.
    const borneInf = tierLevel === 0 ? 0 : def.tiers[tierLevel - 1];
    const auSommet = tierLevel === def.tiers.length;
    const span = Math.max(nextTarget - borneInf, 1);
    const progress = auSommet ? 1 : Math.min(1, Math.max(0, (value - borneInf) / span));

    return {
      id: def.id,
      label: def.label,
      hint: def.hint,
      icon: def.icon,
      tier,
      tierLevel,
      tiers: def.tiers,
      nextTarget,
      progress,
      tiersEarned,
    };
  });
}

/**
 * Le **score de succès** d'un profil : chaque tier obtenu paie son
 * poids. Ce score alimente le classement global, à côté de l'XP —
 * il récompense la *fondation*, pas le volume.
 */
export function achievementScore(achievements: Achievement[]): number {
  return achievements.reduce(
    (a, x) => a + x.tiersEarned.reduce((b, t) => b + TIER_WEIGHT[t], 0),
    0,
  );
}

/** Les succès débloqués entièrement (or), dans l'ordre du registre. */
export function goldenAchievements(achievements: Achievement[]): Achievement[] {
  return achievements.filter((a) => a.tier === "or");
}

/** Prochain succès à débloquer : le plus proche de son palier supérieur. */
export function nextAchievement(achievements: Achievement[]): Achievement | null {
  const inCourse = achievements.filter((a) => a.progress > 0 && a.tier !== "or");
  if (!inCourse.length) return null;
  return [...inCourse].sort((a, b) => b.progress - a.progress)[0];
}
