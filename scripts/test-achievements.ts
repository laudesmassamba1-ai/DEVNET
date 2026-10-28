/**
 * Tests du moteur de succès (`lib/achievements.ts`).
 *
 * Exécuter avec :  npx tsx scripts/test-achievements.ts
 *
 * Trois familles de vérifications : les **paliers** (bronze/argent/or
 * aux bornes exactes), la **progression** (relative au palier en cours,
 * bornée 0–1) et le **score** (bronze 1, argent 3, or 7).
 */

import {
  achievementScore, achievementsFor, ACHIEVEMENTS, goldenAchievements,
  nextAchievement, TIER_WEIGHT, tierLabel, type AchievementCounters,
} from "../lib/achievements";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

const ZERO: AchievementCounters = {
  posts: 0, commits: 0, forks: 0, forksReceived: 0, reviews: 0,
  ratings: 0, snippets: 0, projects: 0, likes: 0, streakBest: 0,
  languages: 0, challengesDone: 0,
};

/* ------------------------------------------------------------------ */
/* 1. Registre                                                        */
/* ------------------------------------------------------------------ */

eq("trois tiers par succès", ACHIEVEMENTS.every((a) => a.tiers.length === 3), true);
check("paliers croissants", ACHIEVEMENTS.every((a) => a.tiers[0] < a.tiers[1] && a.tiers[1] < a.tiers[2]));
check("ids uniques", new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length);
check("métriques connues", ACHIEVEMENTS.every((a) => a.metric in ZERO));
eq("poids des tiers", TIER_WEIGHT.bronze === 1 && TIER_WEIGHT.argent === 3 && TIER_WEIGHT.or === 7, true);
eq("étiquette du tier or", tierLabel("or"), "Or");

/* ------------------------------------------------------------------ */
/* 2. Paliers                                                         */
/* ------------------------------------------------------------------ */

const vide = achievementsFor(ZERO);
check("aucun tier sans activité", vide.every((a) => a.tier === null && a.tierLevel === 0));
check("progress nulle sans activité", vide.every((a) => a.progress === 0));

const artisan = achievementsFor({ ...ZERO, commits: 10 }).find((a) => a.id === "a-artisan");
eq("bronze exactement à la borne", artisan?.tier, "bronze");
eq("progress redémarre à zéro au palier", artisan?.progress, 0);
eq("prochaine cible = palier argent", artisan?.nextTarget, 50);

const midOr = achievementsFor({ ...ZERO, commits: 125 }).find((a) => a.id === "a-artisan");
eq("argent à 125 commits", midOr?.tier, "argent");
near60("progress argent : (125−50)/(200−50)", midOr ? midOr.progress : 0, (125 - 50) / (200 - 50));
eq("tiers gagnés cumulés", JSON.stringify(midOr?.tiersEarned), JSON.stringify(["bronze", "argent"]));

const or = achievementsFor({ ...ZERO, commits: 200 }).find((a) => a.id === "a-artisan");
eq("or à la borne exacte", or?.tier, "or");
eq("tierLevel 3", or?.tierLevel, 3);
near60("progress au palier or : 1", or ? or.progress : 0, 1);

const surOr = achievementsFor({ ...ZERO, commits: 500 }).find((a) => a.id === "a-artisan");
check("progress plafonnée à 1 au-delà de l'or", surOr ? surOr.progress <= 1 : false, surOr?.progress);

const fragment = achievementsFor({ ...ZERO, commits: 4 }).find((a) => a.id === "a-artisan");
eq("pas de tier avant bronze", fragment?.tier, null);
near60("progress avant bronze : 4/10", fragment ? fragment.progress : 0, 4 / 10);

/* ------------------------------------------------------------------ */
/* 3. Score                                                           */
/* ------------------------------------------------------------------ */

const full = achievementsFor({
  ...ZERO, commits: 200, forks: 15, forksReceived: 50, reviews: 100,
  ratings: 150, snippets: 60, projects: 20, likes: 1000, streakBest: 100,
  languages: 10, challengesDone: 100,
});
eq("profil complet : tout l'or", goldenAchievements(full).length, ACHIEVEMENTS.length);
eq("score du profil complet = 11 × (bronze+argent+or)", achievementScore(full), ACHIEVEMENTS.length * (TIER_WEIGHT.bronze + TIER_WEIGHT.argent + TIER_WEIGHT.or));

const partiel = achievementsFor({ ...ZERO, commits: 10, forks: 1 });
eq("bronze paie 1", partiel.filter((a) => a.tier === "bronze").length, 2);
eq("score partiel = 2", achievementScore(partiel), 2);

eq("score nul à zéro", achievementScore(achievementsFor(ZERO)), 0);

/* ------------------------------------------------------------------ */
/* 4. Prochain succès                                                  */
/* ------------------------------------------------------------------ */

const entame = achievementsFor({ ...ZERO, commits: 4 });
const na = nextAchievement(entame);
eq("prochain succès = celui entamé", na?.id, "a-artisan");
check("prochain succès a une progression positive", na !== null && na.progress > 0);
check("aucun prochain quand tout est or", nextAchievement(full) === null);
check("aucun prochain quand vide", nextAchievement(achievementsFor(ZERO)) === null);

/* ------------------------------------------------------------------ */
/* 5. Déterminisme                                                    */
/* ------------------------------------------------------------------ */

const c1: AchievementCounters = { ...ZERO, commits: 33, likes: 77 };
check("deux appels, même état", JSON.stringify(achievementsFor(c1)) === JSON.stringify(achievementsFor(c1)));

/* ------------------------------------------------------------------ */
/* Bilan                                                              */
/* ------------------------------------------------------------------ */

function near60(name: string, actual: number, expected: number): void {
  check(name, Math.abs(actual - expected) <= 1e-9, { actual: +actual.toFixed(6), expected });
}

console.log(`${passed} vérification(s) passée(s), ${failures.length} échec(s)`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
