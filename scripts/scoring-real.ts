/**
 * Mesure du corpus réel : imprime ce que valent vraiment les paquets.
 *
 * Exécuter avec :  npx tsx scripts/scoring-real.ts
 *
 * C'est le script qui a servi à **poser** les bandes de
 * `lib/scoring/corpus-real.ts`, et celui qu'on relance quand on se demande
 * si un changement de seuil a fait dériver le barème sur du code réel.
 * Il affiche les dimensions séparément parce que c'est là que la mesure
 * est informative : la note totale d'un paquet npm plafonne (pas de tests
 * dans une archive), donc elle dit surtout que le plafond fonctionne.
 */

import { scoreRepo } from "../lib/scoring";
import { loadRealCorpus } from "./corpus-real";

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? "  n/a" : `${String(Math.round(v * 100)).padStart(3)}%`;

const repos = loadRealCorpus();

console.log(`${repos.length} dépôt(s) réel(s) — dépendances du projet, épinglées par package-lock.json\n`);

const header = [
  "dépôt".padEnd(12),
  "note".padEnd(5),
  "note projet".padEnd(11),
  "complexité".padEnd(10),
  "structure".padEnd(9),
  "dupl.".padEnd(5),
  "couplage".padEnd(8),
  "tests".padEnd(5),
  "docs".padEnd(5),
  "sécu.".padEnd(5),
  "hygiène".padEnd(7),
  "fichiers",
].join(" ");
console.log(header);
console.log("-".repeat(header.length));

let totalMs = 0;
for (const repo of repos) {
  const started = Date.now();
  const score = scoreRepo(repo.files);
  totalMs += Date.now() - started;

  const d = score.dimensions;
  console.log(
    [
      repo.spec.name.padEnd(12),
      `${score.score}`.padEnd(5),
      `${score.projectScore}`.padEnd(11),
      pct(d.complexity).padEnd(10),
      pct(d.structure).padEnd(9),
      pct(d.duplication).padEnd(5),
      pct(d.coupling).padEnd(8),
      pct(d.tests).padEnd(5),
      pct(d.documentation).padEnd(5),
      pct(d.security).padEnd(5),
      pct(d.repository).padEnd(7),
      `${repo.files.length}/${repo.available} (${score.metrics.sloc} sloc)`,
    ].join(" "),
  );
  if (score.caps.length) {
    console.log(`             plafond : ${score.caps.map((c) => c.id).join(", ")}`);
  }
}

console.log(`\ntemps total : ${totalMs} ms`);
