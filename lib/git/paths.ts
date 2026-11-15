/**
 * Chemins de dépôt.
 *
 * Un chemin de fichier est la clé d'un projet, celle sur laquelle deux
 * membres écrivent en même temps. Il faut donc qu'il soit :
 *
 * - **canonique** — `a/./b`, `a/b/` et `a/b` ne peuvent pas être deux
 *   fichiers différents, sinon deux membres écrivent dans le même fichier
 *   sans le voir ;
 * - **sûr** — un chemin ne doit jamais pouvoir sortir du dépôt. `../../`
 *   sur un projet partagé est une faille, pas une fonctionnalité ;
 * - **prévisible** — le tri doit être stable entre deux clients qui
 *   n'ont pas le même locale.
 *
 * Toutes les fonctions sont pures : un chemin refusé ici ne doit jamais
 * atteindre la base.
 */

/** Raisons de rejet, nommées : une règle de sécurité sans explication n'est pas maintenable. */
export type PathError =
  | "vide"
  | "absolu"
  | "remontant"
  | "dos"
  | "trop-long"
  | "reserve"
  | "trop-profond";

export type PathResult =
  | { ok: true; path: string }
  | { ok: false; reason: PathError };

/** 255 octets : limite du système de fichiers, celle de git aussi. */
const MAX_SEGMENT = 255;
const MAX_DEPTH = 32;

/** Noms réservés par Windows : le dépôt est clonable partout, pas seulement ici. */
const RESERVED = new Set([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const describe: Record<PathError, string> = {
  "vide": "le chemin est vide",
  "absolu": "un chemin de dépôt ne commence pas par /",
  "remontant": "un chemin ne peut pas remonter hors du dépôt",
  "dos": "les séparateurs \\ ne sont pas acceptés",
  "trop-long": "un segment dépasse 255 caractères",
  "reserve": "ce nom est réservé par le système",
  "trop-profond": "l'arborescence est trop profonde",
};

/**
 * Valide et canonise un chemin.
 *
 * On **normalise** au lieu de refuser tout ce qui n'est pas déjà
 * canonique : refuser `a//b` ferait échouer une saisie légitime pour une
 * raison que l'utilisateur ne devine pas. Mais refuser `../` reste
 * obligatoire — c'est une question de sécurité, pas de forme.
 */
export function normalizePath(input: string): PathResult {
  const raw = input.trim();

  if (!raw) return fail("vide");
  if (raw.includes("\\")) return fail("dos");
  if (raw.startsWith("/")) return fail("absolu");

  // Windows tolère `C:\...`, mais on refuse la lettre de lecteur : elle
  // n'a aucun sens dans un dépôt et signale souvent une URL.
  if (/^[a-zA-Z]:/.test(raw)) return fail("absolu");

  const segments = raw.split("/");
  const out: string[] = [];

  for (const seg of segments) {
    // Un segment vide vient d'un `/` en double ou d'un `/` final : c'est
    // une faute de frappe, pas une intention. On la corrige au lieu de la
    // refuser — refuser `src//a.ts` pour une raison invisible à l'écran
    // apprend à l'utilisateur à ne plus rien saisir.
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      // Remonter sort du dépôt, ou annule le segment précédent.
      if (out.length === 0) return fail("remontant");
      out.pop();
      continue;
    }
    if (new TextEncoder().encode(seg).length > MAX_SEGMENT) return fail("trop-long");
    if (RESERVED.has(seg.toLowerCase().split(".")[0])) return fail("reserve");
    out.push(seg);
  }

  if (out.length === 0) return fail("vide");
  if (out.length > MAX_DEPTH) return fail("trop-profond");

  return { ok: true, path: out.join("/") };
}

function fail(reason: PathError): PathResult {
  return { ok: false, reason };
}

/** Message lisible, pour un formulaire de création de fichier. */
export function pathErrorText(reason: PathError): string {
  return describe[reason];
}

/**
 * Trie les chemins comme le fait un explorateur de fichiers.
 *
 * Répertoires d'abord, puis les fichiers, chaque groupe par nom. La
 * comparaison est une comparaison de chaînes simple et déterministe, et
 * non `localeCompare` : celle-ci dépend de la machine, donc deux
 * navigateurs pourraient construire deux arbres différents à partir des
 * mêmes fichiers.
 */
export function sortPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const da = a.split("/");
    const db = b.split("/");
    const n = Math.min(da.length, db.length);

    for (let i = 0; i < n; i++) {
      if (da[i] === db[i]) continue;
      const aDir = i < da.length - 1;
      const bDir = i < db.length - 1;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return da[i] < db[i] ? -1 : 1;
    }
    return da.length - db.length;
  });
}

export const dirname = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
};

export const basename = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

/** Extension sans le point, en minuscules. */
export const extname = (path: string): string => {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
};

/**
 * Langage déduit de l'extension.
 *
 * Sert à choisir le runtime d'exécution (voir `lib/execution`) et à
 * proposer une coloration. Volontairement restreint aux langages qu'on
 * sait réellement exécuter dans le navigateur : annoncer « PHP » alors
 * qu'aucun runtime ne l'exécute serait pire que ne rien annoncer.
 */
const BY_EXT: Record<string, string> = {
  py: "Python",
  js: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  jsx: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  md: "Markdown",
  txt: "Texte",
  yml: "YAML",
  yaml: "YAML",
  sql: "SQL",
  rs: "Rust",
  go: "Go",
  java: "Java",
  c: "C",
  h: "C",
  cpp: "C / C++",
  rb: "Ruby",
  sh: "Shell",
};

export function guessLanguage(path: string): string {
  return BY_EXT[extname(path)] ?? "";
}

/** Fichier binaire probable : on refuse de l'afficher comme du texte. */
const BINARY_EXT = [
  "png", "jpg", "jpeg", "gif", "webp", "ico", "svgz",
  "pdf", "zip", "gz", "tgz", "7z", "rar",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "webm", "wav", "ogg",
];

export function looksBinary(path: string): boolean {
  return BINARY_EXT.includes(extname(path));
}

/**
 * Arbre d'un ensemble de chemins, pour l'explorateur de fichiers.
 *
 * Une seule passe, un seul objet par nœud : un projet réel a quelques
 * centaines de fichiers, pas des milliers, et reconstruire l'arbre à
 * chaque rendu d'un `useMemo` coûterait plus cher que le calcul lui-même.
 */
export interface FileNode {
  name: string;
  path: string;
  dir: boolean;
  /** Nombre de fichiers contenus, récursivement — affiché à côté des dossiers. */
  count: number;
  children: FileNode[];
}

export interface FileEntry {
  path: string;
  content: string;
}

export function buildTree(paths: string[]): FileNode[] {
  type Mutable = { node: FileNode; dirs: Map<string, Mutable> };
  const root: Mutable = {
    node: { name: "", path: "", dir: true, count: 0, children: [] },
    dirs: new Map(),
  };

  for (const path of sortPaths(paths)) {
    const segments = path.split("/");
    let cursor = root;
    let prefix = "";

    segments.forEach((segment, i) => {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const isLeaf = i === segments.length - 1;

      let child = cursor.dirs.get(segment);
      if (!child) {
        child = {
          node: { name: segment, path: prefix, dir: !isLeaf, count: 0, children: [] },
          dirs: new Map(),
        };
        cursor.dirs.set(segment, child);
        cursor.node.children.push(child.node);
      }

      if (isLeaf) child.node.count = 1;
      else child.node.count++;
      cursor = child;
    });
  }

  // Les dossiers vide ne doivent pas exister : un dossier ne naît que
  // parce qu'un fichier est dessous.
  const prune = (node: FileNode): FileNode => {
    node.children = node.children.filter((c) => c.dir || c.count > 0).map(prune);
    return node;
  };

  root.node = prune(root.node);
  return root.node.children;
}