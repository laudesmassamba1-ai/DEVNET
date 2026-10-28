/**
 * Tests du moteur de défis quotidiens (`lib/challenges.ts`).
 *
 * Exécuter avec :  npx tsx scripts/test-challenges.ts
 *
 * Le moteur est pur et **déterministe** : la date du jour sert de
 * graine. On vérifie donc surtout des propriétés de tirage — même jour,
 * même défi partout ; jour différent, tirage différent ; compteurs ⇒
 * progression —, pas des valeurs exactes qui dépendraient de la liste.
 */

import {
  challengeSeed, challengeStreak, challengesFor, challengeXp,
  CHALLENGE_POOL, difficultyWheel, type ChallengeCounters,
} from "../lib/challenges";
import { fnv1a } from "../lib/mathx";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

const ZERO: ChallengeCounters = {
  post: 0, post_code: 0, group_message: 0, group_code: 0,
  project: 0, fork: 0, review: 0, rating: 0, snippet: 0,
};

/* ------------------------------------------------------------------ */
/* 1. Graine                                                          */
/* ------------------------------------------------------------------ */

eq("graine = fnv1a du cache canonique", challengeSeed("2026-10-10", 2), fnv1a("devnet::2026-10-10::defi-2"));
eq("graine différente par index", challengeSeed("2026-10-10", 1) !== challengeSeed("2026-10-10", 2), true);
eq("graine différente par jour", challengeSeed("2026-10-10", 1) !== challengeSeed("2026-10-11", 1), true);

/* ------------------------------------------------------------------ */
/* 2. Roue de difficulté                                              */
/* ------------------------------------------------------------------ */

check("roue : le dimanche est en 1.5×", difficultyWheel("2026-10-11") === 1.5, difficultyWheel("2026-10-11"));
// 2026-10-10 est un samedi.
check("roue : le samedi est en 1.5×", difficultyWheel("2026-10-10") === 1.5, difficultyWheel("2026-10-10"));
const vals = new Set<string>();
for (let i = 1; i <= 14; i++) {
  const day = `2026-10-${String(i).padStart(2, "0")}`;
  vals.add(String(difficultyWheel(day)));
}
check("roue : les deux valeurs sortent sur 2 semaines", vals.has("1") && vals.has("1.5"), [...vals]);

/* ------------------------------------------------------------------ */
/* 3. Tirage du jour                                                  */
/* ------------------------------------------------------------------ */

const lundi = challengesFor("2026-10-12", ZERO);
const lundiBis = challengesFor("2026-10-12", ZERO);
const mardi = challengesFor("2026-10-13", ZERO);

eq("trois défis du jour", lundi.length, 3);
check("même jour → même tirage", JSON.stringify(lundi.map((c) => c.id)) === JSON.stringify(lundiBis.map((c) => c.id)));
check("jour différent → tirage pas identique", JSON.stringify(lundi.map((c) => c.id)) !== JSON.stringify(mardi.map((c) => c.id)));
check("ties d'un jour sans doublon", new Set(lundi.map((c) => c.id)).size === 3, lundi.map((c) => c.id));
check("lysses du réservoir", lundi.every((c) => CHALLENGE_POOL.some((p) => p.id === c.id)));
check("progress nulle sans activité", lundi.every((c) => c.progress === 0 && !c.done));
check("icônes valides", lundi.every((c) => c.difficulty > 0 && Number.isFinite(c.xp)));

/* ------------------------------------------------------------------ */
/* 4. Progression et XP                                               */
/* ------------------------------------------------------------------ */

const actif: ChallengeCounters = { ...ZERO, post: 2, fork: 1 };
const avecAction = challengesFor(lundi[0]?.id && lundi.some((c) => c.kind === "post") ? "2026-10-12" : "2026-10-12", actif);
const gains = avecAction.filter((c) => c.done);
check("au moins un défi fini avec activité", gains.length >= 1, gains.map((g) => g.id));
check("l'XP additionne les défis finis", challengeXp(avecAction) === gains.reduce((a, g) => a + Math.round(g.xp * g.difficulty), 0));
eq("pas d'XP sans défi fini", challengeXp(challengesFor("2026-10-12", ZERO)), 0);

// Progress plafonnée à target : poster 5 fois un défi à 3 → progress 3.
const riche: ChallengeCounters = { ...ZERO, post: 5 };
const defi3 = challengesFor("2026-10-12", riche).find((c) => c.target === 3);
check("progress plafonnée à la cible", !defi3 || defi3.progress === 3, defi3?.progress);

/* ------------------------------------------------------------------ */
/* 5. Série de défis                                                  */
/* ------------------------------------------------------------------ */

eq("série : rien", challengeStreak([], "2026-10-12").current, 0);
const suite = challengeStreak(
  ["2026-10-08", "2026-10-09", "2026-10-10"],
  "2026-10-10",
);
eq("série courante de 3", suite.current, 3);
eq("série : meilleure = courante", suite.best, 3);
const troue = challengeStreak(["2026-10-05", "2026-10-06"], "2026-10-10");
eq("série : trou → 0 courant", troue.current, 0);
eq("série : trou → meilleure conservée", troue.best, 2);
// Hier absent ET aujourd'hui absent : l'implémentation tolère un jour
// de pause — la série de 2 jours (08–09) tient jusqu'à l'expiration du
// délai de grâce.
const hierAbsent = challengeStreak(["2026-10-08", "2026-10-09"], "2026-10-10");
eq("série : jours de grâce tolérés avant expiration", hierAbsent.current, 2);
const horsDelai = challengeStreak(["2026-10-06", "2026-10-07"], "2026-10-10");
eq("série : expirée après le délai de grâce", horsDelai.current, 0);
const jourSeul = challengeStreak(["2026-10-10"], "2026-10-10");
eq("série : un jour seul = 1", jourSeul.current, 1);

check(
  "série : le best compte le pic passé",
  challengeStreak(["2026-10-01", "2026-10-02", "2026-10-03"], "2026-10-10").best === 3,
);

/* ------------------------------------------------------------------ */
/* Bilan                                                              */
/* ------------------------------------------------------------------ */

console.log(`${passed} vérification(s) passée(s), ${failures.length} échec(s)`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
