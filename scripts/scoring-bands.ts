/**
 * Tableau de bord du **calibrage** : les bandes des corpus, et la marge qu'il
 * reste avant de les perdre.
 *
 * Exécuter avec :
 *
 *     npx tsx scripts/scoring-bands.ts                     # bilan, avec les marges
 *     npx tsx scripts/scoring-bands.ts --save=avant.json   # photographie avant
 *     npx tsx scripts/scoring-bands.ts --compare=avant.json # mesure après
 *
 * ## Pourquoi ce script existe
 *
 * `npm run test:scoring` vérifie que chaque dépôt est **dans** sa bande. C'est
 * la bonne garantie, et elle ne dit rien de la question qu'on se pose
 * vraiment quand on touche un seuil : « combien de dépôts vont sortir de leur
 * bande, et lesquels ? ». Un test répond oui ou non ; un calibrage a besoin
 * d'un écart en points.
 *
 * Le mode `--compare` est la partie qui compte : on enregistre les mesures
 * **avant** de changer un seuil, on change le seuil, on relance, et l'écart
 * s'affiche dépôt par dépôt — y compris les sorties de bande, qui font sortir
 * le script en échec pour qu'il s'utilise dans un enchaînement de commandes.
 *
 * ## Ce que le script mesure, et sur quoi
 *
 * Les deux corpus, et ils ne disent pas la même chose :
 *
 * - le **doré** (`lib/scoring/corpus.ts`) est écrit à la main, une intention
 *   par dépôt : sa note porte sur l'ensemble, hygiène de dépôt comprise ;
 * - le **réel** (`lib/scoring/corpus-real.ts`) est fait de paquets npm, donc
 *   de code que personne n'a écrit pour ce barème. Ses bandes de **dimensions**
 *   sont les plus serrées, et ce sont elles qui bougent les premières quand un
 *   seuil change.
 *
 * Un paquet npm absent est signalé comme tel : une bande qu'on ne peut pas
 * mesurer n'est pas une bande tenue.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { CORPUS, bandReport, scoreRepo, type Band } from "../lib/scoring";
import { frNumber } from "../lib/utils";
import { loadRealCorpus, missingMessage } from "./corpus-real";

/* ------------------------------------------------------------------ */
/* Mesures                                                             */
/* ------------------------------------------------------------------ */

/** Une mesure et sa bande : ce que le bilan compare. */
interface Measuring {
  key: string;
  /** Nombre de points ou part 0…1 — la bande dit l'échelle. */
  measured: number;
  band: Band;
  /** Vrai pour une dimension, dont la bande se lit en pourcentage. */
  percent: boolean;
}

interface MeasuredRepo {
  name: string;
  score: number;
  /** Dimensions mesurées, par clé — ce qui est enregistré par `--save`. */
  dimensions: Record<string, number | null>;
}

function measureReal(): { repos: MeasuredRepo[]; measures: Measuring[]; missing: string[] } {
  const repos: MeasuredRepo[] = [];
  const measures: Measuring[] = [];
  const missing: string[] = [];

  for (const loaded of loadRealCorpus()) {
    if (loaded.missing) {
      missing.push(`${loaded.spec.name} — ${missingMessage(loaded)}`);
      continue;
    }

    const scored = scoreRepo(loaded.files);
    repos.push({ name: loaded.spec.name, score: scored.score, dimensions: { ...scored.dimensions } });
    measures.push({
      key: loaded.spec.name,
      measured: scored.score,
      band: loaded.spec.expect,
      percent: false,
    });

    for (const [dimension, band] of Object.entries(loaded.spec.expectCode)) {
      const value = scored.dimensions[dimension as keyof typeof scored.dimensions];
      if (value === null || value === undefined) continue;
      measures.push({ key: `${loaded.spec.name} · ${dimension}`, measured: value, band, percent: true });
    }
  }

  return { repos, measures, missing };
}

function measureGolden(): { repos: MeasuredRepo[]; measures: Measuring[] } {
  const repos: MeasuredRepo[] = [];
  const measures: Measuring[] = [];

  for (const repo of CORPUS) {
    const scored = scoreRepo(repo.files);
    repos.push({ name: repo.name, score: scored.score, dimensions: { ...scored.dimensions } });
    measures.push({ key: repo.name, measured: scored.score, band: repo.expect, percent: false });
  }

  return { repos, measures };
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

// `frNumber` vient de `lib/utils` : le script n'a pas de raison d'avoir sa
// propre écriture des nombres — et un « -0,0 » écrit ici quand tous les
// écrans écrivent « 0,0 » est exactement le genre d'écart qui se remarque.
const number = (value: number, digits = 1): string =>
  Number.isFinite(value) ? frNumber(value, digits) : "illisible";

/** Une mesure : des points pour une note, un pourcentage pour une dimension. */
const shown = (m: Measuring): string =>
  m.percent ? `${number(m.measured * 100)} %` : `${Math.round(m.measured)}`;

const bandShown = (m: Measuring): string =>
  m.percent ? `${number(m.band.min * 100, 0)}–${number(m.band.max * 100, 0)} %`
    : `${m.band.min}–${m.band.max}`;

/** La marge, dans l'unité de la mesure — c'est elle qu'un seuil consomme. */
const marginShown = (m: Measuring, margin: number): string =>
  m.percent ? `${number(margin * 100)} pt` : `${number(margin, 0)} pt`;

function printTable(title: string, measures: Measuring[]): void {
  console.log(`\n${title}`);
  console.log("-".repeat(72));

  const report = bandReport(measures.map(({ key, measured, band }) => ({ key, measured, band })));
  const byKey = new Map(measures.map((m) => [m.key, m]));

  for (const { key, check } of report.checks) {
    const m = byKey.get(key)!;
    const state = check.inside ? "✓" : "✗ HORS BANDE";
    console.log(
      [
        key.padEnd(28),
        shown(m).padStart(9),
        bandShown(m).padStart(12),
        `marge ${marginShown(m, check.margin)}`.padStart(16),
        state,
      ].join(" "),
    );
  }

  if (report.tightest) {
    const m = byKey.get(report.tightest.key)!;
    const cote = report.tightest.side === "bas" ? "vers le bas" : "vers le haut";
    console.log(
      `\n  le plus fragile : ${report.tightest.key} — ${marginShown(m, report.tightest.margin)} ${cote}`,
    );
    console.log("  → c'est cette mesure qui sortira la première d'un changement de seuil.");
  }

  // Épinglées : la mesure est **exactement** sur une borne. Ce n'est pas une
  // fragilité, c'est un plafond qui mord ou une dimension parfaite ; le dire
  // évite de désigner un danger inexistant à la place d'un vrai.
  if (report.pinned.length) {
    console.log(`\n  épinglée(s) — exactement sur une borne, donc pas fragiles : ${report.pinned.join(", ")}`);
  }

  if (report.outsideCount > 0) {
    console.log(`\n  ${report.outsideCount} mesure(s) hors bande : ${report.outside.join(", ")}`);
  }
}

/* ------------------------------------------------------------------ */
/* Enregistrement et comparaison                                       */
/* ------------------------------------------------------------------ */

interface Snapshot {
  /** Les mesures enregistrées, par clé. */
  measures: Record<string, number>;
  /** Les bandes en vigueur : la comparaison doit juger avec celles-ci. */
  bands: Record<string, Band>;
  /** Vrai pour une dimension, dont la marge se lit en pourcentage. */
  percent: Record<string, boolean>;
  /** Révisions du corpus, pour dire ce que la photographie contient. */
  repos: string[];
}

function snapshotPath(): { save: string | null; compare: string | null } {
  const arg = (name: string): string | null =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  return { save: arg("save"), compare: arg("compare") };
}

function toSnapshot(measures: Measuring[], repos: string[]): Snapshot {
  return {
    measures: Object.fromEntries(measures.map((m) => [m.key, m.measured])),
    bands: Object.fromEntries(measures.map((m) => [m.key, m.band])),
    percent: Object.fromEntries(measures.map((m) => [m.key, m.percent])),
    repos,
  };
}

/**
 * Ce qui a bougé depuis la photographie, et ce qui est sorti de bande.
 *
 * La comparaison juge avec les bandes **de la photographie** : c'est le
 * calibrage tel qu'il était quand on a décidé de le changer. Comparer avec
 * les bandes du jour mélangerait deux causes — un seuil modifié et une bande
 * modifiée — dans un seul écart.
 */
function compare(before: Snapshot, measures: Measuring[]): number {
  const report = bandReport(measures.map(({ key, measured, band }) => ({ key, measured, band })));
  const exits: string[] = [];

  console.log("\nécart depuis la photographie");
  console.log("-".repeat(72));
  console.log(
    ["mesure".padEnd(28), "avant".padStart(10), "après".padStart(10), "écart".padStart(10), "état"].join(" "),
  );

  for (const { key, check } of report.checks) {
    const m = measures.find((x) => x.key === key)!;
    const previous = before.measures[key];
    const known = Number.isFinite(previous);
    // L'écart s'écrit dans l'unité **lue** : des points pour une note, des
    // points de pourcentage pour une dimension. Sans cette conversion, une
    // chute de 5,7 points de pourcentage s'afficherait « -0,1 » — un écart
    // presque nul pour un changement qui vient de sortir une bande.
    const delta = known ? (m.measured - previous) * (m.percent ? 100 : 1) : Number.NaN;
    const deltaShown = (value: number): string => `${value > 0 ? "+" : ""}${number(value)} pt`;
    const left = !check.inside;
    if (left) exits.push(key);

    console.log(
      [
        key.padEnd(28),
        (known ? shown({ ...m, measured: previous }) : "absent").padStart(10),
        shown(m).padStart(10),
        (known ? deltaShown(delta) : "—").padStart(10),
        left ? "✗ HORS BANDE" : "✓",
      ].join(" "),
    );
  }

  const nouveau = measures.filter((m) => !Number.isFinite(before.measures[m.key]));
  if (nouveau.length) {
    console.log(`\n  ${nouveau.length} mesure(s) absente(s) de la photographie : ${nouveau.map((m) => m.key).join(", ")}`);
  }

  if (exits.length) {
    console.log(`\n  ${exits.length} bande(s) perdue(s) : ${exits.join(", ")}`);
    console.log("  → le changement de seuil n'est pas acceptable en l'état.");
  } else {
    console.log("\n  ✓ toutes les bandes restent tenues après le changement.");
  }

  return exits.length;
}

/* ------------------------------------------------------------------ */
/* Programme                                                           */
/* ------------------------------------------------------------------ */

const { save, compare: comparePath } = snapshotPath();

const golden = measureGolden();
const real = measureReal();

if (real.missing.length) {
  console.log("Paquet(s) du corpus réel absent(s) :");
  for (const line of real.missing) console.log(`  - ${line}`);
}

const measures = [...golden.measures, ...real.measures];
const repos = [...golden.repos.map((r) => r.name), ...real.repos.map((r) => r.name)];

console.log(
  `\ncalibrage — ${repos.length} dépôt(s), ${measures.length} bande(s) mesurée(s)` +
    (real.missing.length ? `, ${real.missing.length} paquet(s) manquant(s)` : ""),
);

printTable("corpus doré — dépôts écrits à la main, une intention par dépôt", golden.measures);
printTable("corpus réel — paquets npm, code écrit par d'autres", real.measures);

const report = bandReport(measures.map(({ key, measured, band }) => ({ key, measured, band })));
console.log(
  `\n  ${report.checks.length - report.outsideCount}/${report.checks.length} bande(s) tenue(s)` +
    (report.outsideCount ? ` — ${report.outsideCount} hors bande` : ""),
);

if (report.tightest) {
  const m = measures.find((x) => x.key === report.tightest!.key)!;
  const cote = report.tightest.side === "bas" ? "vers le bas" : "vers le haut";
  console.log(
    `  à surveiller : ${report.tightest.key} — ${marginShown(m, report.tightest.margin)} ${cote}`,
  );
}

if (save) {
  writeFileSync(save, `${JSON.stringify(toSnapshot(measures, repos), null, 2)}\n`, "utf8");
  console.log(`\n  photographie écrite : ${save}`);
  console.log("  → changez un seuil, puis relancez avec --compare=" + save);
}

let exits = 0;
if (comparePath) {
  const before = JSON.parse(readFileSync(comparePath, "utf8")) as Snapshot;
  exits = compare(before, measures);
}

// Le code de sortie porte le verdict : un enchaînement de commandes peut
// s'arrêter sur une bande perdue, ce qu'un tableau imprimé ne permet pas.
process.exit(exits > 0 ? 1 : 0);
