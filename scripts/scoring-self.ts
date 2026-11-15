/**
 * Calibration du barème sur un **dépôt réel** : celui-ci.
 *
 * Exécuter avec :  npx tsx scripts/scoring-self.ts
 *
 * Le corpus doré (`lib/scoring/corpus.ts`) est fait de petits dépôts
 * écrits pour isoler un signal. Il ne dit pas si le barème tient sur
 * 50 000 lignes de code réel, écrites par quelqu'un qui ne pensait pas au
 * barème. Ce script le dit — et c'est en le lançant que deux angles morts
 * ont été trouvés : les imports par alias (`@/lib/…`) n'étaient pas
 * résolus, ce qui faisait passer 147 fichiers sur 269 pour « jamais
 * importés », et l'avertisseur de secrets criait sur ses propres valeurs
 * d'exemple.
 *
 * La liste des fichiers vient de **git** : suivis, plus non suivis non
 * ignorés. C'est exactement ce que voit le moteur quand il note un dépôt —
 * un fichier ignoré n'est pas dans le dépôt, donc il n'est pas noté.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { scoreRepo, type FileEntry } from "../lib/scoring";

/** Au-delà, ce n'est plus un fichier de code — et le lire coûterait cher. */
const MAX_BYTES = 1_000_000;

const listed = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\0")
  .filter(Boolean);

const files: FileEntry[] = [];
let skipped = 0;
for (const path of listed) {
  try {
    if (statSync(path).size > MAX_BYTES) { skipped++; continue; }
    files.push({ path, content: readFileSync(path, "utf8") });
  } catch {
    skipped++; // fichier binaire illisible en UTF-8, ou supprimé depuis
  }
}

const started = Date.now();
const repo = scoreRepo(files);
const elapsed = Date.now() - started;

const pct = (v: number | null): string => (v === null || v === undefined ? " n/a" : `${Math.round(v * 100)}%`);

console.log(`${files.length} fichier(s) évalué(s) (${skipped} ignoré(s)) — ${repo.metrics.sloc} lignes de code\n`);
console.log(`note du dépôt  : ${repo.score}/1000  (${repo.grade.letter} — ${repo.grade.label})`);
console.log(`note du projet : ${repo.projectScore}/1000`);
console.log(`hygiène        : ${repo.hygieneScore}/1000`);
console.log(`temps          : ${elapsed} ms (${(elapsed / Math.max(files.length, 1)).toFixed(1)} ms/fichier)\n`);

console.log("dimensions");
for (const [key, value] of Object.entries(repo.dimensions)) {
  console.log(`  ${key.padEnd(14)} ${pct(value)}`);
}

console.log("\nmesures");
console.log(`  fichiers notés        ${repo.metrics.scored}`);
console.log(`  fonctions             ${repo.metrics.functions}`);
console.log(`  maintenabilité        ${Math.round(repo.metrics.maintainability)}/100`);
console.log(`  code recopié          ${Math.round(repo.metrics.duplicateShare * 100)} %`);
console.log(`  fichiers en cycle     ${repo.metrics.cyclicFiles}`);
console.log(`  jamais importés       ${repo.metrics.orphanFiles}`);
console.log(`  masquage              ${repo.metrics.confidence === "lexer" ? "lexical et vérifié" : "heuristique sur au moins un fichier"}`);
console.log(`  analyse tronquée      ${repo.metrics.truncated ? "oui" : "non"}`);

if (repo.caps.length) {
  console.log("\nplafonds");
  for (const cap of repo.caps) console.log(`  ${cap.id} : ${cap.label}`);
}

if (repo.security.findings.length) {
  console.log("\nsécurité");
  for (const finding of repo.security.findings.slice(0, 8)) {
    console.log(`  [${finding.severity}] ${finding.label} — ${finding.where}`);
  }
}

if (repo.actions.length) {
  console.log("\nles actions qui rapportent le plus");
  for (const action of repo.actions) {
    console.log(`  +${action.gain} points — ${action.label}`);
    for (const where of action.where.slice(0, 4)) console.log(`      ${where}`);
  }
}

if (repo.weaknesses.length) console.log(`\nfaiblesses : ${repo.weaknesses.join(" · ")}`);
if (repo.strengths.length) console.log(`forces     : ${repo.strengths.join(" · ")}`);
