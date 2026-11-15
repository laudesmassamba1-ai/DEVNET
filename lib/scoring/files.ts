/**
 * Quels fichiers sont du code, et lesquels ne le sont pas.
 *
 * Cette politique vivait dans `score.ts`, au milieu de l'agrégation. Elle
 * est ici pour deux raisons : le graphe d'imports et l'agrégation doivent
 * **répondre la même chose**, et un module qui décide ce qu'on note ne doit
 * pas dépendre de celui qui note.
 *
 * ## Rien n'est noté par accident
 *
 * Le score d'un dépôt n'a de sens que s'il porte sur ce que l'auteur a
 * **écrit**. Les exclusions ne sont donc pas cosmétiques :
 *
 * - `*.d.ts`, `*.min.*`, `*.generated.*`, `*.g.dart`… sont produits par un
 *   outil : une ligne générée n'est la faute de personne ;
 * - `migrations/` décrit l'histoire d'une base, pas un choix de code ;
 * - `components/ui/`, `vendor/`, `third_party/` sont des composants
 *   copiés — les noter reviendrait à noter leur auteur, pas le nôtre ;
 * - `.svg`, `.xml`, `.png`… sont des **ressources**, pas du code : les
 *   compter gonflerait le dénominateur sans rien dire de la qualité ;
 * - `linguistically-generated` désigne les fichiers de traduction produits
 *   par un outil (`i18n/…/generated`, `.po` compilé) : mêmes raisons.
 */

import { basename, extname, looksBinary } from "../git/paths";

/** Extensions réellement du code source, analysables par le lexeur. */
const SOURCE_EXTENSIONS = new Set([
  "c", "h", "hpp", "cpp", "cc", "cxx", "cs", "java", "go", "rs",
  "swift", "kt", "kts", "dart", "js", "mjs", "cjs", "jsx", "ts",
  "tsx", "css", "scss", "less", "sass", "php", "scala", "py", "rb",
  "sh", "bash", "zsh", "fish", "pl", "pm", "r", "ps1", "sql", "lua",
  "hs", "html", "htm", "vue", "svelte",
]);

/** Suffixes de fichiers produits par un outil. */
const GENERATED_SUFFIXES = [
  ".min.js", ".min.css", ".d.ts", ".generated.ts", ".generated.js",
  ".g.dart", ".g.cs", ".pb.go", "_pb2.py", ".designer.cs", ".freezed.dart",
];

/** Fragments de chemin qui désignent du code qui n'est pas « le nôtre ». */
const VENDORED = [
  "node_modules/", "vendor/", "third_party/", "third-pary/", "bower_components/",
  "components/ui/", "dist/", "build/", ".next/", "coverage/",
];

const MIGRATION = /(?:\/|^)(?:migrations?|db\/migrations)\//i;

/** Fichiers de traduction ou de données produits par un outil. */
const LINGUISTIC = /(^|\/)(i18n|locales?|lang)\/[^/]*generated/i;

/** Ce fichier est-il produit par un outil plutôt qu'écrit à la main ? */
export function isGenerated(path: string): boolean {
  const base = basename(path).toLowerCase();
  if (GENERATED_SUFFIXES.some((s) => base.endsWith(s))) return true;
  if (/\.(lock)$/i.test(base) || base === "package-lock.json" || base === "yarn.lock") return true;
  if (base === "go.sum" || base === "cargo.lock") return true;
  return VENDORED.some((fragment) => path.includes(fragment));
}

/** Le fichier décrit-il une migration de base, hors du code de l'application ? */
export function isMigration(path: string): boolean {
  return MIGRATION.test(path) || LINGUISTIC.test(path);
}

/** Les documents, données, ressources et fichiers générés ne sont pas du code. */
export function isScoreable(path: string): boolean {
  if (looksBinary(path)) return false;
  // `.svg` et `.xml` sont des ressources : `looksBinary` n'en couvre pas
  // tous, et ce sont des dessins, pas des programmes.
  const ext = extname(path);
  if (ext === "svg" || ext === "xml") return false;
  if (isGenerated(path) || isMigration(path)) return false;
  return SOURCE_EXTENSIONS.has(ext);
}

const TEST_RX = [
  /(^|\/)(__tests__|tests?|specs?)(\/)/i,
  /(^|\/)test[-_.][^/]+$/i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /_test\.(go|py|rb|rs|java|kt|cs)$/i,
  /(^|\/)[^/]+_spec\.rb$/i,
  /(^|\/)test[^/]*\.(py|rb)$/i,
];

/** Ce chemin est-il un test ? Les tests mesurent la qualité, ils ne la subissent pas. */
export function isTestPath(path: string): boolean {
  return TEST_RX.some((rx) => rx.test(path));
}

/** Une langue par extension, pour compter la diversité d'un projet. */
export function languageOf(path: string): string {
  const ext = extname(path);
  return ext || "sans-extension";
}
