#!/usr/bin/env node
/**
 * ui-lint — les règles statiques du contrat d'expérience.
 *
 * Ce script ne remplace pas `ux-scan.mjs` (mesures de qualité : tailles de
 * texte, valeurs arbitraires, cliquet). Il vérifie les règles **bloquantes**
 * qui peuvent l'être sans navigateur ni dépendance :
 *
 * - DS-01  couleurs en dur dans `className` / `style` ;
 * - MO-02  animation de propriétés de mise en page (width, height, top…) ;
 * - MO-05  boucles infinies hors indicateur de chargement ;
 * - FT-01  UI morte (`href="#"`, gestionnaire vide) ;
 * - PR-02  contournements (`eslint-disable`, `@ts-ignore`, `.skip(`, `--no-verify`).
 *
 * ## Pourquoi un fichier de référence
 *
 * Le dépôt viole déjà ces règles par endroits (couleurs historiques,
 * `eslint-disable` justifiés). Un seuil à zéro rendrait la CI rouge en
 * permanence : une porte toujours rouge ne bloque plus rien, on apprend à
 * l'ignorer. La porte **gèle donc le compte actuel** dans
 * `docs/ui/ui-lint-baseline.json` et échoue à la moindre **augmentation**.
 * Le compte ne peut que diminuer : c'est un cliquet, pas une amnistie.
 *
 * Usage :
 *   node scripts/ui-lint.mjs                 # vérifie
 *   node scripts/ui-lint.mjs --write-baseline # fige l'état (dette assumée)
 *   node scripts/ui-lint.mjs --details        # liste les occurrences
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "docs/ui/ui-lint-baseline.json");
const SOURCES = ["app", "components"];

const RULES = {
  hardcodedColor: "DS-01 couleur en dur",
  layoutAnimation: "MO-02 propriété de mise en page animée",
  infiniteLoop: "MO-05 boucle infinie",
  deadUi: "FT-01 UI morte",
  bypass: "PR-02 contournement",
};

function listFiles() {
  const out = execSync(
    `find ${SOURCES.join(" ")} -type f \\( -name '*.tsx' -o -name '*.ts' -o -name '*.css' \\) -not -path '*/node_modules/*'`,
    { cwd: ROOT, encoding: "utf8" },
  );
  return [...out.split("\n").filter(Boolean), "app/globals.css"];
}

const hits = new Map();
function hit(rule, file, line, detail) {
  if (!hits.has(rule)) hits.set(rule, []);
  hits.get(rule).push({ file, line, detail });
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g;

for (const file of listFiles()) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    const n = index + 1;
    // Une ligne de commentaire ne déclare rien : on l'ignore, sinon le
    // lint reprocherait sa propre documentation.
    const trimmed = line.trim();
    const isComment = trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");

    if (!isComment) {
      if (/(?:className|style)=\{?["'`{]/.test(line)) {
        const colors = line.match(COLOR)?.length ?? 0;
        for (let i = 0; i < colors; i += 1) hit("hardcodedColor", file, n, trimmed.slice(0, 120));
      }

      if (/(?:href=["']#["']|onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\})/.test(line)) {
        hit("deadUi", file, n, trimmed.slice(0, 120));
      }

      if (/eslint-disable|@ts-ignore|\.skip\(|--no-verify/.test(line)) {
        hit("bypass", file, n, trimmed.slice(0, 120));
      }

      // MO-02 : une transition ou animation qui nomme une propriété de
      // mise en page. `all` est autorisé ici (il est traité par la règle
      // des propriétés animées, pas par celle des noms).
      if (
        /transition(?:-property)?\s*:[^;]*(?:\bwidth\b|\bheight\b|\btop\b|\bleft\b|\bright\b|\bbottom\b|\bmargin|\bpadding)/.test(
          line,
        )
      ) {
        hit("layoutAnimation", file, n, trimmed.slice(0, 120));
      }

      // MO-05 : `infinite` n'est admis que sur un indicateur de chargement.
      if (/animation[^;]*\binfinite\b/.test(line)) {
        const selector = [...text.slice(0, text.indexOf(line)).matchAll(/([^{}]+)\{/g)]
          .map((m) => m[1].trim())
          .pop();
        // Indicateurs de chargement et curseur de texte : la boucle y est
        // une information (ça travaille), pas une décoration. Le nom du
        // composant compte autant que le sélecteur.
        const allowed =
          /LoadingLogo|ProgressPanel/i.test(file) ||
          /spin|pulse|breathe|scan|skeleton|shimmer|loading|caret|shake|spinner/i.test(
            `${selector ?? ""} ${line}`,
          );
        if (!allowed) hit("infiniteLoop", file, n, `${selector ?? "?"} → ${trimmed.slice(0, 90)}`);
      }
    }
  });
}

const counts = Object.fromEntries(
  Object.keys(RULES).map((rule) => [rule, hits.get(rule)?.length ?? 0]),
);

if (process.argv.includes("--details")) {
  for (const [rule, list] of hits) {
    console.log(`\n${RULES[rule]} : ${list.length}`);
    for (const item of list.slice(0, 12)) console.log(`  ${item.file}:${item.line}  ${item.detail}`);
    if (list.length > 12) console.log(`  … ${list.length - 12} autre(s)`);
  }
}

if (process.argv.includes("--write-baseline")) {
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        note:
          "Dette figée par scripts/ui-lint.mjs. Chaque compte ne peut que diminuer. " +
          "Toute augmentation échoue (contrat d'expérience, Phase 0).",
        counts,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`référence écrite : ${BASELINE_PATH}`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")).counts
  : {};

let failed = 0;
for (const rule of Object.keys(RULES)) {
  const current = counts[rule];
  const allowed = baseline[rule] ?? 0;
  const delta = current - allowed;
  const mark = delta > 0 ? "✗" : delta < 0 ? "↓" : "=";
  console.log(`${mark} ${RULES[rule]} : ${current}${delta ? ` (référence ${allowed}, ${delta > 0 ? "+" : ""}${delta})` : ""}`);
  if (delta > 0) failed += 1;
}

if (failed > 0) {
  console.error(
    `\nui-lint : ${failed} règle(s) en régression. Corrige la cause ; ne relève jamais la référence.`,
  );
  process.exit(1);
}
console.log("\nui-lint : aucune régression.");
