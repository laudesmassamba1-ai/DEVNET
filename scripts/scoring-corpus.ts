/**
 * Calibration du barème : imprime le corpus doré, dépôt par dépôt.
 *
 * Exécuter avec :  npx tsx scripts/scoring-corpus.ts
 *
 * Ce script sert deux fois :
 *
 * - **à calibrer** — on lit la colonne des scores, pas un tableur. Un bon
 *   dépôt qui tombe à 600 est un signe que le barème a dérivé, pas que le
 *   dépôt a changé ;
 * - **à expliquer** — devant un jury, la question « qu'est-ce que ça vaut,
 *   un dépôt noté 800 ? » a une réponse : « le dépôt *propre* de ce
 *   corpus », nommée et reproductible.
 *
 * `scripts/test-scoring.ts` vérifie les **bandes** ; ce script montre les
 * valeurs qui les remplissent. Il affiche les **deux** corpus : les dépôts
 * dorés écrits à la main, puis les paquets npm réels — c'est la lecture
 * côte à côte qui dit si le barème mesure le code ou le corpus.
 */

import { CORPUS, REPO_WEIGHTS, scoreRepo } from "../lib/scoring";
import { loadRealCorpus, missingMessage } from "./corpus-real";

const padded = (text: string, width: number): string => text.padEnd(width, " ");

const header = [
  padded("dépôt", 22),
  padded("note", 6),
  padded("note", 6),
  padded("code", 7),
  padded("structure", 10),
  padded("dupl.", 7),
  padded("couplage", 9),
  padded("tests", 7),
  padded("docs", 7),
  padded("sécurité", 9),
  padded("hygiène", 8),
  "bande attendue",
].join(" ");
console.log(header);
console.log("-".repeat(header.length));

const rows = CORPUS.map((repo) => {
  const repoScore = scoreRepo(repo.files);
  const d = repoScore.dimensions;
  const pct = (v: number | null): string => (v === null || v === undefined ? "  n/a" : `${Math.round(v * 100)}%`);
  return {
    name: repo.name,
    project: repoScore.projectScore,
    score: repoScore.score,
    grade: repoScore.grade.letter,
    cells: [
      pct(d.complexity), pct(d.structure), pct(d.duplication), pct(d.coupling),
      pct(d.tests), pct(d.documentation), pct(d.security), pct(d.repository),
    ],
    min: repo.expect.min,
    max: repo.expect.max,
    expect: `${repo.expect.min}–${repo.expect.max}`,
    cap: repoScore.caps[0]?.id ?? "",
  };
});

for (const row of rows) {
  console.log(
    [
      padded(row.name, 22),
      padded(String(row.project), 6),
      padded(`${row.score} ${row.grade}`.slice(0, 6), 6),
      ...row.cells.map((c, i) => padded(c, [7, 10, 7, 9, 7, 7, 9, 8][i])),
      row.expect + (row.cap ? `  (plafond : ${row.cap})` : ""),
    ].join(" "),
  );
}

console.log("\nPoids des dimensions (note du dépôt) :");
const total = Object.values(REPO_WEIGHTS).reduce((a, b) => a + b, 0);
for (const [key, weight] of Object.entries(REPO_WEIGHTS)) {
  console.log(`  ${padded(key, 16)} ${String(Math.round((weight / total) * 100)).padStart(3)} %`);
}

const good = rows.find((r) => r.name === "propre")!;
const bad = rows.find((r) => r.name === "brouillon")!;
console.log(`\nÉcart « propre » − « brouillon » : ${good.score - bad.score} points (${good.grade} contre ${bad.grade})`);

const outside = rows.filter((r) => r.score < r.min || r.score > r.max);
if (outside.length) {
  console.log(`\n⚠️  ${outside.length} dépôt(s) hors bande : ${outside.map((r) => r.name).join(", ")}`);
  console.log("   `npm run test:scoring` échoue sur les mêmes bandes.");
} else {
  console.log("\n✓ tous les dépôts dorés sont dans leur bande");
}

/* ------------------------------------------------------------------ */
/* Corpus réel : des paquets que personne n'a écrits pour le barème     */
/* ------------------------------------------------------------------ */

const real = loadRealCorpus();
console.log("\n\ndépôts réels — paquets npm épinglés par package-lock.json, code écrit par d'autres\n");
console.log(
  [
    padded("dépôt", 14), padded("version", 9), padded("licence", 15),
    padded("note", 6), padded("projet", 7), padded("fichiers", 12), "bande  code",
  ].join(" "),
);

const realOutside: string[] = [];
for (const repo of real) {
  if (repo.missing) {
    console.log(padded(repo.spec.name, 14) + " ABSENT — " + missingMessage(repo));
    realOutside.push(repo.spec.name);
    continue;
  }

  const scored = scoreRepo(repo.files);
  const band = `${repo.spec.expect.min}–${repo.spec.expect.max}`;
  const ok = scored.score >= repo.spec.expect.min && scored.score <= repo.spec.expect.max;
  if (!ok) realOutside.push(repo.spec.name);

  console.log(
    [
      padded(repo.spec.name, 14),
      padded(repo.version, 9),
      padded(repo.spec.license, 15),
      padded(`${scored.score}${ok ? " " : "!"}`, 6),
      padded(String(scored.projectScore), 7),
      padded(`${repo.files.length}/${repo.available}`, 12),
      band,
    ].join(" ") + (ok ? "" : "   ← hors bande"),
  );
}

if (realOutside.length) {
  console.log(`\n⚠️  ${realOutside.length} dépôt(s) réel(s) hors bande : ${realOutside.join(", ")}`);
  console.log("   `npm run test:scoring` échoue sur les mêmes bandes.");
} else {
  console.log("\n✓ tous les dépôts réels sont dans leur bande");
  console.log("   `npm run score:real` montre le détail des dimensions et le temps d'analyse.");
}
