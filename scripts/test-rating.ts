/**
 * Tests du moteur de notation par les pairs (`lib/rating.ts`).
 *
 * Exécuter avec :  npx tsx scripts/test-rating.ts
 *
 * On vérifie les trois garde-fous sur des cas construits à la main :
 * prior bayésien en l'absence de votes, convergence vers la vraie
 * moyenne quand n grandit, pénalité de Wilson sur les petits
 * échantillons, prime de diversité, unicité du votant.
 */

import {
  PRIOR_CONFIDENCE, platformMean, rankProjects,
  rateProject, validVotes, type RatingVote,
} from "../lib/rating";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

function near(name: string, actual: number, expected: number, tol = 1e-9): void {
  check(name, Math.abs(actual - expected) <= tol, { actual: +actual.toFixed(6), expected });
}

function vote(stars: number, voterId: string, voterLang = "ts"): RatingVote {
  return { stars, voterId, voterLang };
}

/* ------------------------------------------------------------------ */
/* 1. Votes valides                                                   */
/* ------------------------------------------------------------------ */

eq("filtre : une voix par votant", validVotes([vote(5, "a"), vote(4, "a")]).length, 1);
eq("filtre : identifiant votant vide rejeté", validVotes([vote(5, " ")]).length, 0);
eq(" filtre : étoiles hors bornes rejetées", validVotes([vote(0, "a"), vote(6, "b")]).length, 0);
eq(" filtre : demi-étoiles acceptées", validVotes([vote(3.5, "c")]).length, 1);
eq(" filtre : les votes honnêtes passent", validVotes([vote(1, "a"), vote(5, "b")]).length, 2);
eq(" filtre : liste vide", validVotes([]).length, 0);
eq(" filtre : NaN rejeté", validVotes([{ stars: NaN, voterId: "a" }]).length, 0);

/* ------------------------------------------------------------------ */
/* 2. Le prior bayésien                                               */
/* ------------------------------------------------------------------ */

const froid = rateProject([], 3.4);
eq("sans vote : étoiles = prior", froid.stars, 3.4);
eq("sans vote : évidence nulle", froid.evidence, 0);
eq("sans vote : score nul (pas affichable)", froid.score, 0);
eq("sans vote : comptage nul", froid.votes, 0);

// Prior = 3, un seul 5/5 : (5·3 + 5)/(5+1) = 20/6 ≈ 3.33 — pas 5.
near("un seul 5/5 ne vaut pas 5", rateProject([vote(5, "a")], 3).stars, 20 / 6);
const avec50 = rateProject(
  Array.from({ length: 50 }, (_, i) => vote(5, `v${i}`)),
  3,
);
check("50 votes de 5/5 tirent la note vers 5", avec50.stars > 4.8, avec50.stars);
// Le nombre exact : (5·3+250)/55 = 265/55.
near("50×5 avec prior 3 = 265/55", avec50.stars, 265 / 55);

/* ------------------------------------------------------------------ */
/* 3. Confiance Wilson                                                */
/* ------------------------------------------------------------------ */

const petit = rateProject([vote(5, "a"), vote(5, "b"), vote(5, "c")], 3);
const grand = rateProject(
  Array.from({ length: 30 }, (_, i) => vote(5, `g${i}`)),
  3,
);
check("3 votes : évidence partielle", petit.evidence > 0 && petit.evidence < 0.5, petit.evidence);
check("30 votes : évidence supérieure", grand.evidence > petit.evidence, { grand: grand.evidence, petit: petit.evidence });

const mitiges = rateProject([vote(1, "a"), vote(2, "b"), vote(5, "c"), vote(5, "d")], 3);
check("votes partagés : estimation favorable modérée", mitiges.favorableEstimate <= 0.5, mitiges.favorableEstimate);

/* ------------------------------------------------------------------ */
/* 4. Diversité                                                       */
/* ------------------------------------------------------------------ */

const ghetto = rateProject(
  [vote(5, "a", "ts"), vote(5, "b", "ts"), vote(5, "c", "ts")],
  3,
);
const mosaic = rateProject(
  [vote(5, "a", "ts"), vote(5, "b", "py"), vote(5, "c", "go")],
  3,
);
near("ghetto : diversité 0", ghetto.diversity ?? ghetto.diversity, 0);
check("mosaïque : diversité maximale", mosaic.diversity > 0.99, mosaic.diversity);
near("la diversité du jury n'altère pas la note", mosaic.score, ghetto.score);
check("un petit jury ne ramène pas la note à zéro", ghetto.score > 0, ghetto.score);
near(
  "casse des langues normalisée pour la diversité",
  rateProject([vote(5, "a", "TypeScript"), vote(5, "b", "typescript")], 3).diversity,
  0,
);
near("prior hors bornes ramené à 5", rateProject([], 12).stars, 5);
near("prior non fini remplacé par la valeur neutre", rateProject([], Infinity).stars, 3);

/* ------------------------------------------------------------------ */
/* 5. Score géométrique                                               */
/* ------------------------------------------------------------------ */

const r = rateProject(
  [vote(5, "a", "ts"), vote(4, "b", "py"), vote(4, "c", "go"), vote(5, "d", "ts")],
  3,
);
near("score égal à la moyenne bayésienne affichée", r.score, r.stars);
check("score borné [0,5]", r.score >= 0 && r.score <= 5, r.score);
check("prior pesé par PRIOR_CONFIDENCE", PRIOR_CONFIDENCE === 5);

/* ------------------------------------------------------------------ */
/* 6. Classement et moyenne de plateforme                             */
/* ------------------------------------------------------------------ */

const classement = rankProjects([
  { nom: "faible", rating: rateProject([vote(2, "a")], 3) },
  { nom: "fort", rating: rateProject([vote(5, "a"), vote(5, "b"), vote(5, "c"), vote(4, "d", "py"), vote(5, "e", "go")], 3) },
  { nom: "vide", rating: rateProject([], 3) },
]);
eq("rang 1 = le projet fort", classement[0].nom, "fort");
check("le vide reste en queue", classement[classement.length - 1].nom === "vide");

eq("moyenne de plateforme sans votes = 3", platformMean([]), 3);
near("moyenne de plateforme = moyenne des votes", platformMean([vote(4, "a"), vote(5, "b"), vote(3, "c")]), 4);
check("la moyenne ignore les doublons", platformMean([vote(4, "a"), vote(4, "a")]) === 4);

/* ------------------------------------------------------------------ */
/* 7. Déterminisme                                                    */
/* ------------------------------------------------------------------ */

const v = [vote(4, "a", "ts"), vote(2, "b", "py"), vote(5, "c")];
check("deux appels, même score", JSON.stringify(rateProject(v, 3)) === JSON.stringify(rateProject(v, 3)));

/* ------------------------------------------------------------------ */
/* Bilan                                                              */
/* ------------------------------------------------------------------ */

console.log(`${passed} vérification(s) passée(s), ${failures.length} échec(s)`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
