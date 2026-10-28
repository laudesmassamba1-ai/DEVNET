/**
 * Chargement du **corpus réel** depuis le disque.
 *
 * Exécuter avec :  npx tsx scripts/scoring-real.ts
 *
 * Les données et les bandes sont dans `lib/scoring/corpus-real.ts` ; ce
 * fichier ne fait que **lire**. La séparation n'est pas cosmétique : un
 * module de `lib/scoring` qui importerait `node:fs` casserait la
 * construction du client, puisque `ScorePanel` importe le moteur.
 *
 * ## Le chemin est ré-raciné, et c'est important
 *
 * Un fichier lu dans `node_modules/eslint/lib/rules/x.js` est présenté au
 * moteur sous le chemin `lib/rules/x.js`. Sans cela, `isGenerated`
 * reconnaîtrait `node_modules/` et **écarterait le fichier entier** — le
 * moteur exclut le code vendorisé, à juste titre. On note donc le paquet
 * **comme si son arborescence était le dépôt**, ce qui est exactement la
 * question posée : « ce paquet, noté comme un dépôt, vaut combien ? »
 *
 * ## Un sous-ensemble déterministe, et pourquoi
 *
 * ESLint, c'est quatre cents fichiers et cent mille lignes : le noter en
 * entier prendrait une dizaine de secondes à chaque `npm run test:scoring`.
 * On garde donc `maxFiles` fichiers, choisis par **pas régulier** sur la
 * liste triée — pas les cinquante premiers, qui ne seraient que le début
 * de l'alphabet. Le choix est identique à chaque exécution, et il est
 * annoncé dans le rapport : un sous-ensemble caché serait une bande
 * qu'on ne peut pas interpréter.
 *
 * ## Ce que l'échantillonnage biaise, et ce qu'il ne biaise pas
 *
 * C'est la limite à connaître avant de lire une bande, et elle est
 * exacte :
 *
 * - les dimensions calculées **fichier par fichier** puis agrégées
 *   (complexité, structure, duplication, documentation) sont **sans
 *   biais** : on tire des fichiers au hasard dans une population
 *   homogène, ce que fait un échantillon par pas régulier. Ce sont elles
 *   qui portent les bandes serrées ;
 * - le **couplage** est biaisé, et vers le bas : un import qui pointe vers
 *   un fichier non échantillonné est compté comme un orphelin. La même
 *   cause gonfle le nombre de fichiers « jamais importés » du rapport. Sa
 *   bande est donc large, et une valeur de couplage sur ce corpus ne se
 *   compare pas à celle d'un dépôt noté en entier ;
 * - la **note totale** reste comparable entre les cinq paquets, puisque
 *   tous sont échantillonnés de la même façon.
 */

import { readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

import type { FileEntry } from "../lib/scoring";
import { REAL_CORPUS, type RealRepoSpec } from "../lib/scoring/corpus-real";

/** Au-delà, ce n'est plus un fichier de code — et le lire coûterait cher. */
const MAX_BYTES = 1_000_000;

/**
 * Fichiers de racine qui font partie du dépôt tel qu'un humain le voit.
 *
 * npm embarque le README et la licence dans le paquet précisément pour
 * qu'on puisse les lire : les inclure, c'est noter le dépôt, pas une
 * archive tronquée. Ce qui manque (`.gitignore`, tests, CI, verrouillage)
 * est signalé dans l'en-tête de `lib/scoring/corpus-real.ts`.
 */
const ROOT_FILES = [
  "README.md",
  "README.markdown",
  "README.rst",
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "COPYING",
  "package.json",
  "tsconfig.json",
  ".editorconfig",
];

/** Répertoires jamais parcourus : dépendances et artefacts. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "__pycache__"]);

export interface LoadedRealRepo {
  spec: RealRepoSpec;
  /** Version réellement installée. */
  version: string;
  files: FileEntry[];
  /** Fichiers présents dans les sous-arbres, avant échantillonnage. */
  available: number;
  /** Le paquet est absent de `node_modules`. */
  missing: boolean;
}

/** Tous les fichiers d'un sous-arbre, triés par chemin. */
function walk(root: string, dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // sous-arbre absent : le paquet ne le livre pas, ce n'est pas une erreur
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(root, full, out);
    } else if (entry.isFile()) {
      out.push(relative(root, full).split("\\").join("/"));
    }
  }
}

/**
 * Un sous-ensemble réparti sur toute la liste.
 *
 * On prend un fichier tous les `n/limite`, ce qui donne un échantillon
 * **étalé** plutôt qu'un préfixe alphabétique. `Math.floor(i * step)` ne
 * sort jamais de la liste, y compris quand `step` vaut exactement 1.
 */
export function strideSample<T>(items: readonly T[], limit: number): T[] {
  if (limit <= 0 || items.length <= limit) return [...items];
  const out: T[] = [];
  const step = items.length / limit;
  for (let i = 0; i < limit; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

/** Lit un paquet du corpus, ou dit qu'il manque. */
export function loadRealRepo(spec: RealRepoSpec, cwd = process.cwd()): LoadedRealRepo {
  const root = join(cwd, spec.dir);

  let version = "?";
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version?: string;
    };
    version = manifest.version ?? "?";
  } catch {
    return { spec, version, files: [], available: 0, missing: true };
  }

  const found: string[] = [];
  for (const sub of spec.roots) walk(root, join(root, sub), found);
  found.sort();

  const chosen = strideSample(found, spec.maxFiles);
  const files: FileEntry[] = [];

  for (const path of [...ROOT_FILES.filter((name) => isFileAt(root, name)), ...chosen]) {
    const full = join(root, path);
    try {
      if (statSync(full).size > MAX_BYTES) continue;
      files.push({ path, content: readFileSync(full, "utf8") });
    } catch {
      // illisible ou disparu entre le listage et la lecture
    }
  }

  return { spec, version, files, available: found.length, missing: false };
}

function isFileAt(root: string, name: string): boolean {
  try {
    return statSync(join(root, name)).isFile();
  } catch {
    return false;
  }
}

/** Le corpus réel complet, chargé. */
export function loadRealCorpus(cwd = process.cwd()): LoadedRealRepo[] {
  return REAL_CORPUS.map((spec) => loadRealRepo(spec, cwd));
}

/**
 * Message d'erreur quand un paquet du corpus manque.
 *
 * Un test qui échoue sur « dépôt absent » doit dire **quoi faire** : sans
 * cela, une installation partielle ressemble à un barème cassé.
 */
export function missingMessage(repo: LoadedRealRepo): string {
  return (
    `corpus réel : le paquet « ${repo.spec.package} » est absent de node_modules. ` +
    `Lancez \`npm ci\` (il est déclaré dans package.json, le corpus n'ajoute aucune dépendance).`
  );
}

