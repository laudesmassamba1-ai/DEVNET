/**
 * Tests des primitives mathématiques (`lib/mathx.ts`).
 *
 * Exécuter avec :  npx tsx scripts/test-mathx.ts
 *
 * Chaque primitive est vérifiée sur des cas dont le résultat se calcule
 * **à la main** : une moyenne harmonique de deux 1 vaut 1, l'entropie
 * d'une distribution uniforme sur 3 cases vaut log₂(3), une moyenne
 * bayésienne avec prior 3 et dix votes de confiance sur un seul 5 vaut
 * 35/11… Si une primitive change de comportement, c'est ici qu'on le
 * voit en premier.
 */

import {
  bayesianMean, clamp, fnv1a, geometricMean, heapsLaw, harmonicMean,
  levenshtein, mulberry32, normalizedDistance, normalizedEntropy,
  sampleUnique, shannonEntropy, sigmoid, wilsonCenter,
} from "../lib/mathx";

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
  check(name, Math.abs(actual - expected) <= tol, { actual: +actual.toFixed(8), expected });
}

/* ------------------------------------------------------------------ */
/* 1. Bornes                                                          */
/* ------------------------------------------------------------------ */

eq("clamp garde dans [lo, hi]", clamp(5, 0, 3), 3);
eq("clamp garde le bas", clamp(-2, 0, 3), 0);
eq("clamp laisse passer l'intérieur", clamp(1.5, 0, 3), 1.5);
eq("borne inversée : milieu", clamp(9, 3, 0), 1.5);

/* ------------------------------------------------------------------ */
/* 2. Moyennes                                                        */
/* ------------------------------------------------------------------ */

near("harmonique de deux 1 vaut 1", harmonicMean([1, 1]), 1);
near("harmonique(1,2)=4/3", harmonicMean([1, 2]), 4 / 3);
near("harmonique ignore le facteur nul", harmonicMean([1, 0, 2]), 4 / 3);
near("harmonique d'un ensemble vide", harmonicMean([]), 0);

// Géométrique pondérée : exp((2·ln4 + 1·ln1)/3) = 4^(2/3).
near("géométrique pondérée 4^(2/3)", geometricMean([4, 1], [2, 1]), Math.exp((Math.log(4) * 2) / 3), 1e-9);
near("géométrique uniforme de 4 et 1", geometricMean([4, 1]), 2, 1e-12);
near("géométrique : ε plancher", geometricMean([0, 10]), Math.sqrt(0.02 * 10), 1e-12);
eq("géométrique d'un ensemble vide", geometricMean([]), 0);

/* ------------------------------------------------------------------ */
/* 3. Entropie                                                        */
/* ------------------------------------------------------------------ */

// Uniforme sur 3 cases : H = log₂(3) ≈ 1.585 bits.
near("entropie uniforme = log₂(3)", shannonEntropy([1, 1, 1]), Math.log2(3), 1e-12);
near("entropie nulle quand tout est concentré", shannonEntropy([5, 0, 0]), 0, 1e-12);
eq("entropie d'un ensemble vide", shannonEntropy([]), 0);
near("entropie normalisée uniforme = 1", normalizedEntropy([2, 2, 2]), 1, 1e-12);
near("entropie normalisée concentrée = 0", normalizedEntropy([4, 0]), 0, 1e-12);
eq("ormalisée : une seule case = 0", normalizedEntropy([7]), 0);
near("ormalisée invariante par rotation des cases", normalizedEntropy([9, 3, 3]), normalizedEntropy([3, 9, 3]), 1e-12);

/* ------------------------------------------------------------------ */
/* 4. Loi de Heaps                                                    */
/* ------------------------------------------------------------------ */

eq("Heaps(0) nul", heapsLaw(0), 0);
near("Heaps croît sous-linéairement (arrondi près)", heapsLaw(100) / heapsLaw(10), Math.pow(10, 0.5), 0.05);
check("Heaps est toujours au moins 1", heapsLaw(1) >= 1, heapsLaw(1));
near("Heaps respecte κ et β", heapsLaw(4, 20, 0.5), 40, 1e-9);

/* ------------------------------------------------------------------ */
/* 5. Sigmoïde                                                        */
/* ------------------------------------------------------------------ */

near("sigmoïde au point mid vaut ½", sigmoid(10), 0.5, 1e-12);
near("sigmoïde tend vers 1", sigmoid(100), 1, 1e-6);
near("sigmoïde tend vers 0", sigmoid(-100), 0, 1e-6);
check("sigmoïde croissante", sigmoid(2) < sigmoid(12));
eq("sigmoïde ok sur Infinity", sigmoid(Infinity), 1);
eq("sigmoïde refuse NaN", sigmoid(NaN), 0);

/* ------------------------------------------------------------------ */
/* 6. Wilson et bayésienne                                            */
/* ------------------------------------------------------------------ */

// 3 votes 5/5 : p̂=1, centre Wilson < 1 (pénalité d'échantillon).
const w35 = wilsonCenter(3, 3);
check("Wilson pénalise 3/3", 0 < w35 && w35 < 1, w35);
check("Wilson : 9/9 plus proche de 1 que 3/3", wilsonCenter(9, 9) > w35, { w9: wilsonCenter(9, 9), w35 });
check("Wilson : 0/10 reste proche de 0", wilsonCenter(0, 10) < 0.25, wilsonCenter(0, 10));
eq("Wilson : total nul → prior neutre ½", wilsonCenter(0, 0), 0.5);

// (C·m + Σx)/(C+n) = (10·3 + 5)/(10+1) = 35/11.
near("bayésienne (10·3+5)/11", bayesianMean([5], 3, 10), 35 / 11, 1e-12);
// (10·3+5)/12 = 35/12 pour C=10, (3+5)/3 = 8/3 pour C=1 : le grand C reste plus près du prior.
check("bayésienne : un grand C tire vers le prior", Math.abs(bayesianMean([1, 4], 3, 10) - 3) < Math.abs(bayesianMean([1, 4], 3, 1) - 3));
near("bayésienne sans vote = prior", bayesianMean([], 3.5, 10), 3.5);
near("bayésienne : des votes égaux au prior restent au prior", bayesianMean([3, 3], 3, 10), 3, 1e-12);

/* ------------------------------------------------------------------ */
/* 7. Distances                                                       */
/* ------------------------------------------------------------------ */

eq("Levenshtein identique", levenshtein("chat", "chat"), 0);
eq("Levenshtein insertion", levenshtein("chat", "chats"), 1);
eq("Levenshtein chats→chat", levenshtein("chats", "chat"), 1);
eq("Levenshtein substitution", levenshtein("chat", "catz"), 2);
eq("Levenshtein une remplaçade", levenshtein("chat", "cart"), 2); // h→a, a→r déjà comptés… vérifié à la main
eq("Levenshtein vide", levenshtein("", "abc"), 3);
near("distance normalisée identique", normalizedDistance("abc", "abc"), 0);
near("distance normalisée sans lien", normalizedDistance("abcd", "efgh") / 1, 1, 1e-12);

/* ------------------------------------------------------------------ */
/* 8. Hachage et aléa déterministes                                   */
/* ------------------------------------------------------------------ */

eq("fnv1a déterministe", fnv1a("devnet::2026-06-12::defi-1"), fnv1a("devnet::2026-06-12::defi-1"));
eq("fnv1a est entier 32 bits", fnv1a("x"), fnv1a("x") >>> 0);
check("fnv1a : deux textes proches assez différents", fnv1a("defi-1") !== fnv1a("defi-2"));
check("fnv1a('') ≠ h borné de départ (opération)", fnv1a("") === 0x811c9dc5);

const r1 = mulberry32(42);
const r2 = mulberry32(42);
let mêmeFlux = true;
for (let i = 0; i < 10; i++) if (r1() !== r2()) mêmeFlux = false;
check("mulberry32 : même seed → même flux", mêmeFlux);
check("mulberry32 borne [0,1)", (() => { const r = mulberry32(9); for (let i = 0; i < 100; i++) { const v = r(); if (v < 0 || v >= 1) return false; } return true; })());

const src = ["a", "b", "c", "d", "e"];
const s1 = sampleUnique(src, 3, mulberry32(7));
check("échantillon sans répétition", new Set(s1).size === 3, s1);
check("échantillon ⊂ source", s1.every((x) => src.includes(x)), s1);
check("échantillon k ≥ n renvoie tout", (() => { const r = mulberry32(1); const out = sampleUnique(src, 99, r); return out.length === 5; })());

/* ------------------------------------------------------------------ */
/* Bilan                                                              */
/* ------------------------------------------------------------------ */

console.log(`${passed} vérification(s) passée(s), ${failures.length} échec(s)`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
