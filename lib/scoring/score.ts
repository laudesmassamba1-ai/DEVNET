/**
 * Le score DevNet — de 0 à 1000, à quatre échelles.
 *
 * ## Quatre questions, quatre échelles
 *
 * - **ligne** — celle-ci est-elle lisible *toute seule* ? C'est le grain de
 *   la relecture : on surligne une ligne, on sait quoi corriger.
 * - **fichier** — ce fichier est-il sain ? Six dimensions, une par
 *   famille de signaux.
 * - **projet** — l'ensemble tient-il debout ? Huit dimensions, dont le
 *   graphe d'imports et l'état des tests.
 * - **dépôt** — le projet est-il *installable et transmissible* ? S'ajoute
 *   l'hygiène de dépôt, **vérifiée par le contenu** et non par la présence
 *   d'un fichier.
 *
 * ## Comment les notes s'assemblent
 *
 * Une **moyenne pondérée** des dimensions, une dimension par famille de
 * signaux (`dimensions.ts`), puis des **plafonds nommés** pour les défauts
 * qui ne doivent pas se diluer : un secret committé plafonne la note à C,
 * l'absence de tests à B. Un plafond s'explique en une phrase, ce qui est
 * la condition pour qu'un score soit reçu autrement que comme un verdict.
 *
 * La version précédente utilisait une **moyenne géométrique** de dimensions
 * qui se recoupaient : le même défaut (imbrication, lignes longues,
 * nombres magiques) était compté dans deux ou trois dimensions, et la
 * géométrique **multipliait** ces redites au lieu de les additionner.
 *
 * ## Ce que le module ne fait pas
 *
 * Il ne lit pas le disque, n'appelle pas le réseau et ne connaît pas la
 * base : il note des `{ path, content }`. C'est ce qui permet de le tester
 * en Node, de le faire tourner dans le navigateur (`ScorePanel`), et de
 * l'appliquer aussi bien au brouillon en cours qu'à un dépôt entier.
 */

import { clamp } from "../mathx";
import { analyse, type AnalysedSource, type LineKind } from "./lex";
import {
  DEEP_NESTING,
  LONG_LINE,
  MARKER_RX,
  extractMetrics,
  magicNumbersIn,
  type FileMetrics,
} from "./metrics";
import {
  FILE_WEIGHTS,
  PROJECT_DIMENSIONS,
  REPO_WEIGHTS,
  aggregate,
  applyCaps,
  fileDimensions,
  projectDimensions,
  type DimensionScores,
  type FileDimensionScores,
  type ProjectDimension,
  type ProjectFacts,
  type ScoreCap,
} from "./dimensions";
import { analyseCoupling } from "./coupling";
import {
  cacheLookup,
  cacheRemember,
  cacheStats,
  newBlobCache,
  type BlobCache,
} from "./cache";
import { isGenerated, isScoreable, isTestPath, languageOf } from "./files";
import { meanOf } from "./stats";
import { basename } from "../git/paths";

export const SCORE_MAX = 1000;

/* ------------------------------------------------------------------ */
/* Notes et bandeaux                                                   */
/* ------------------------------------------------------------------ */

export interface Grade {
  /** Lettre affichée, de `A+` à `F`. */
  letter: string;
  /** Libellé français, pour l'écran. */
  label: string;
  tone: "ok" | "warn" | "danger";
}

const GRADES: { min: number; grade: Grade }[] = [
  { min: 920, grade: { letter: "A+", label: "exceptionnel", tone: "ok" } },
  { min: 840, grade: { letter: "A", label: "excellent", tone: "ok" } },
  { min: 740, grade: { letter: "B", label: "solide", tone: "ok" } },
  { min: 620, grade: { letter: "C", label: "correct", tone: "warn" } },
  { min: 480, grade: { letter: "D", label: "fragile", tone: "warn" } },
  { min: 320, grade: { letter: "E", label: "à retravailler", tone: "danger" } },
  { min: 0, grade: { letter: "F", label: "critique", tone: "danger" } },
];

export function gradeFor(score: number): Grade {
  const s = clamp(Math.round(score), 0, SCORE_MAX);
  return GRADES.find((g) => s >= g.min)!.grade;
}

/**
 * Score maximal d'une note encore égale à `letter`.
 *
 * Un plafond « à C » doit laisser la note **dans** la bande C : la borne
 * est donc le minimum de la bande supérieure, moins un. C'est ce qui rend
 * le plafond vérifiable — « cette note ne peut pas dépasser C ».
 */
function ceilingOf(letter: string): number {
  const i = GRADES.findIndex((g) => g.grade.letter === letter);
  const above = GRADES[i - 1];
  return above ? above.min - 1 : SCORE_MAX;
}

/** Une note, sa bande, et les deux marches qui l'encadrent. */
export interface GradeBand {
  grade: Grade;
  /** Les bornes de la bande, **incluses** : la note est dedans par construction. */
  band: { min: number; max: number };
  /** La marche juste au-dessus : ce qu'il reste à monter. `null` au sommet. */
  next: { grade: Grade; min: number } | null;
  /** La marche juste en dessous : ce qu'une perte ferait tomber. `null` au plancher. */
  below: { grade: Grade; min: number } | null;
}

/**
 * La bande de la note, avec les marches voisines.
 *
 * Sert à dire **de combien** on est de la borne — la même information que la
 * marge d'une bande de calibration (`bands.ts`), appliquée ici au barème des
 * notes. Un « B » ne dit pas s'il est à 839 (à un point de A) ou à 741 (à un
 * point de C) ; c'est pourtant tout ce qui distingue une note tenue d'une
 * note que le prochain commit fera basculer.
 */
export function gradeBandFor(score: number): GradeBand {
  const s = clamp(Math.round(score), 0, SCORE_MAX);
  const i = GRADES.findIndex((g) => s >= g.min);
  const entry = GRADES[i];
  const above = GRADES[i - 1];
  const under = GRADES[i + 1];
  return {
    grade: entry.grade,
    band: { min: entry.min, max: ceilingOf(entry.grade.letter) },
    next: above ? { grade: above.grade, min: above.min } : null,
    below: under ? { grade: under.grade, min: under.min } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Score de ligne                                                      */
/* ------------------------------------------------------------------ */

export interface LineContext {
  /** Profondeur d'imbrication de la ligne (0 = racine). */
  depth?: number;
  /** Longueur au-delà de laquelle la ligne devient pénible à lire. */
  limit?: number;
  /** Vrai si la ligne est un pur commentaire. */
  comment?: boolean;
  /**
   * Ligne masquée (commentaires et chaînes remplacés par des espaces).
   * Fournie par `scoreFile` : sans elle, un nombre cité dans un
   * commentaire serait compté comme un nombre magique.
   */
  masked?: string;
}

export interface LineScore {
  /** 0…1000. */
  score: number;
  kind: LineKind;
  /** Ce qui a coûté des points, en clair. */
  reasons: string[];
}

/**
 * Score d'une ligne isolée.
 *
 * Une ligne vide vaut 1000 : elle ne coûte rien à personne. Les pénalités
 * sont toutes *explicables* et listées dans `reasons`, parce qu'un score
 * sans justification n'apprend rien à celui qui le reçoit.
 *
 * C'est une échelle **à part** : elle n'entre dans aucune dimension de
 * fichier. Un même défaut peut donc apparaître ici et dans une dimension
 * de fichier sans que le score soit compté deux fois — ce sont deux
 * réponses à deux questions différentes (« que corriger ici ? » et « ce
 * fichier est-il sain ? »).
 */
export function scoreLine(text: string, ctx: LineContext = {}): LineScore {
  // La longueur se juge sur la ligne **utile**, sans son indentation de
  // gauche (le commentaire disait « sans l'indentation » alors que le code
  // mesurait la ligne entière, indentation comprise).
  const limit = ctx.limit ?? LONG_LINE;
  const reasons: string[] = [];

  if (text.trim() === "") {
    return { score: SCORE_MAX, kind: "blank", reasons };
  }

  const kind: LineKind = ctx.comment ? "comment" : "code";
  const usefulLength = text.trimEnd().trimStart().length;
  let penalty = 0;

  const readabilityLimit = kind === "comment" ? limit * 1.5 : limit;
  if (usefulLength > readabilityLimit) {
    const over = usefulLength - readabilityLimit;
    penalty += Math.min(280, over * 4);
    reasons.push(`ligne longue (+${over} caractères)`);
  }

  if (/[ \t]+$/.test(text)) {
    penalty += 70;
    reasons.push("espace en fin de ligne");
  }

  if (MARKER_RX.test(text)) {
    penalty += 130;
    reasons.push("marqueur TODO/FIXME");
  }

  const magic = magicNumbersIn(ctx.masked ?? text);
  if (magic > 0) {
    penalty += Math.min(120, magic * 40);
    reasons.push(`${magic} nombre${magic > 1 ? "s" : ""} magique${magic > 1 ? "s" : ""}`);
  }

  const depth = ctx.depth ?? 0;
  if (depth >= DEEP_NESTING) {
    const over = depth - (DEEP_NESTING - 1);
    penalty += Math.min(220, over * 55);
    reasons.push(`imbrication à ${depth} niveaux`);
  }

  return { score: clamp(SCORE_MAX - penalty, 0, SCORE_MAX), kind, reasons };
}

/* ------------------------------------------------------------------ */
/* Libellés                                                            */
/* ------------------------------------------------------------------ */

/** Libellés français, pour l'écran. */
export const DIMENSION_LABELS: Record<string, string> = {
  complexity: "Complexité",
  structure: "Structure",
  duplication: "Duplication",
  coupling: "Couplage",
  tests: "Tests",
  documentation: "Documentation",
  security: "Sécurité",
  repository: "Hygiène de dépôt",
  naming: "Nommage",
  hygiene: "Hygiène",
  maintainability: "Maintenabilité",
};

/* ------------------------------------------------------------------ */
/* Score de fichier                                                    */
/* ------------------------------------------------------------------ */

export interface FileScore {
  path: string;
  score: number;
  grade: Grade;
  dimensions: FileDimensionScores;
  metrics: FileMetrics;
  /** Score de chaque ligne, dans l'ordre du fichier. */
  lines: LineScore[];
  /** Moyenne des lignes de code, sur 1000. */
  lineAverage: number;
  /** Poids dans les agrégations : nombre de lignes de code. */
  weight: number;
}

function scoreAnalysed(path: string, src: AnalysedSource): FileScore {
  const metrics = extractMetrics(src, { isTest: isTestPath(path) });

  const lines = src.lines.map((l) =>
    scoreLine(l.text, {
      depth: l.depth,
      comment: l.kind === "comment",
      masked: l.masked,
    }),
  );

  const codeLines = lines.filter((_, i) => src.lines[i].kind === "code");
  const lineAverage = codeLines.length ? meanOf(codeLines.map((l) => l.score)) : SCORE_MAX;

  const dimensions = fileDimensions(metrics);
  const score = Math.round(SCORE_MAX * aggregate(dimensions, FILE_WEIGHTS));

  return { path, score, grade: gradeFor(score), dimensions, metrics, lines, lineAverage, weight: metrics.sloc };
}

/** Score d'un fichier, avec ses métriques et le détail par ligne. */
export function scoreFile(path: string, content: string): FileScore {
  return scoreAnalysed(path, analyse(content, path));
}

/**
 * Score d'un fichier, servi par le cache quand le contenu n'a pas bougé.
 *
 * C'est la seule différence avec `scoreFile` : un fichier inchangé — même
 * chemin, même SHA de blob — ne repasse ni par le masquage, ni par la
 * détection de fonctions, ni par Halstead.
 */
export function scoreFileCached(
  path: string,
  content: string,
  cache: BlobCache<CachedFile>,
): FileScore {
  const hit = cacheLookup(cache, path, content);
  if (hit) return hit.score;
  const source = analyse(content, path);
  const score = scoreAnalysed(path, source);
  cacheRemember(cache, path, content, { source, score });
  return score;
}

/** Nombre de lignes du plus long fichier — utile pour dimensionner l'UI. */
export function largestFile(files: FileScore[]): FileScore | null {
  return files.reduce<FileScore | null>((best, f) => (!best || f.weight > best.weight ? f : best), null);
}

/* ------------------------------------------------------------------ */
/* Entrées                                                             */
/* ------------------------------------------------------------------ */

export interface FileEntry {
  path: string;
  content: string;
}

/* ------------------------------------------------------------------ */
/* Hygiène de dépôt — par le contenu                                   */
/* ------------------------------------------------------------------ */

export interface HygieneItem {
  id: string;
  label: string;
  present: boolean;
  weight: number;
  hint: string;
  /** Ce qui a été vérifié, pour que l'utilisateur puisse contester. */
  evidence: string;
}

/** Un README en dessous de ce nombre de mots n'explique rien. */
export const MIN_README_WORDS = 80;

/** Licences reconnues, par leur identifiant SPDX le plus courant. */
const SPDX_SIGNS: [string, RegExp][] = [
  ["MIT", /(^|\W)mit(\W|$)/i],
  ["Apache-2.0", /apache\s*(license|licence)?[^\n]{0,20}2\.0/i],
  ["BSD-3-Clause", /bsd\s*3[- ]clause|redistribution and use in source/i],
  ["ISC", /(^|\W)isc(\W|$)/i],
  ["MPL-2.0", /mozilla public license/i],
  ["GPL-3.0", /gnu general public license[^\n]{0,40}3/i],
  ["GPL-2.0", /gnu general public license[^\n]{0,40}2/i],
  ["AGPL-3.0", /affero general public license/i],
  ["LGPL-3.0", /lesser general public license/i],
  ["Unlicense", /this is free and unencumbered software/i],
  ["CC0-1.0", /cc0/i],
  ["EPL-2.0", /eclipse public license/i],
];

/** Licences copyleft : utilisables, mais pas réutilisables sans vérifier. */
const COPYLEFT_RX = /\b(AGPL|GPL|LGPL|SSPL)\b|affero/i;

/** Identifiant SPDX reconnu, ou `null` si la licence n'est pas identifiée. */
export function recognizeLicense(content: string): string | null {
  for (const [id, rx] of SPDX_SIGNS) if (rx.test(content)) return id;
  return null;
}

function findFile(entries: readonly FileEntry[], rx: RegExp): FileEntry | undefined {
  return entries.find((e) => rx.test(e.path) && !isGenerated(e.path));
}

/** Nombre de mots d'un texte, sans les symboles de balisage seuls. */
function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Ce que dit le workflow de CI : lance-t-il réellement quelque chose ? */
export function ciRunsSomething(content: string): boolean {
  return /^\s*[- ]*\s*run:\s*\S+.*\b(test|vitest|jest|pytest|cargo test|go test|build|lint|npm|pnpm|yarn|make)\b/im.test(content);
}

function packageJsonScripts(entries: readonly FileEntry[]): Record<string, string> {
  const candidates = entries
    .filter((e) => basename(e.path) === "package.json" && !e.path.includes("node_modules/"))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.content) as { scripts?: Record<string, string> };
      if (parsed.scripts) return parsed.scripts;
    } catch {
      // Un `package.json` illisible ne doit pas faire tomber tout le score.
    }
  }
  return {};
}

/**
 * Hygiène de dépôt : ce qui fait qu'un dépôt est **installable et
 * transmissible** par quelqu'un d'autre que son auteur.
 *
 * Chaque critère est vérifié **par le contenu**, pas par la présence d'un
 * fichier. C'était la faille la plus simple à exploiter du barème
 * précédent : un `LICENSE` vide valait 10 % de la note, un dossier
 * `.github/workflows/` sans fichier valait 12 %. Un dossier vide ne vaut
 * plus rien, un workflow qui ne lance rien non plus.
 */
export function repoHygiene(entries: readonly FileEntry[]): HygieneItem[] {
  const readme = findFile(entries, /(^|\/)readme(\.|$)/i);
  const readmeWords = readme ? wordCount(readme.content) : 0;
  const readmeSections = !!readme &&
    /installation|installer|install\b/i.test(readme.content) &&
    /usage|utilisation|utiliser|getting started|démarrage|quick ?start/i.test(readme.content);

  const license = findFile(entries, /(^|\/)(licen[cs]e|copying)(\.|$)/i);
  const licenseId = license ? recognizeLicense(license.content) : null;

  const gitignore = findFile(entries, /(^|\/)\.gitignore$/);
  const ignoreEffective = !!gitignore &&
    /node_modules|\*\.pyc|__pycache__|\.next|dist|build|target/i.test(gitignore.content);

  const scripts = packageJsonScripts(entries);
  const manifest = findFile(entries, /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|gemfile|composer\.json|build\.gradle)$/i);
  const manifestUsable = !!manifest && (
    Object.keys(scripts).length > 0 ||
    /\bdependencies\b|\[project\]|\[tool\.|require\b/i.test(manifest.content)
  );

  const lock = findFile(entries, /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock|go\.sum)$/i);

  const ci = entries.find((e) =>
    /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(e.path) ||
    /(^|\/)(\.gitlab-ci\.yml|\.travis\.yml|\.circleci\/config\.yml)$/i.test(e.path),
  );
  const ciEffective = !!ci && ciRunsSomething(ci.content);

  const testFile = entries.find((e) => isTestPath(e.path));

  const mdCount = entries.filter((e) => /\.(md|mdx|rst)$/i.test(e.path)).length;

  const artifacts = entries.some((e) =>
    /(^|\/)(node_modules|__pycache__|\.venv|dist|build|target|\.next)\//.test(e.path),
  );

  const editor = findFile(entries, /(^|\/)(\.editorconfig|\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s|\.prettierrc[^/]*|prettier\.config\.[cm]?[jt]s|tsconfig\.json|ruff\.toml|\.flake8)$/i);

  return [
    {
      id: "readme", label: "README", weight: 0.14,
      present: readmeWords >= MIN_README_WORDS && readmeSections,
      hint: "Explique en une page ce que fait le projet et comment le lancer.",
      evidence: readme
        ? `${readmeWords} mot(s)${readmeSections ? ", sections installation et usage" : ", sections installation et usage manquantes"}`
        : "aucun fichier README",
    },
    {
      id: "license", label: "Licence", weight: 0.10,
      present: licenseId !== null,
      hint: "Sans licence, personne n'a le droit de réutiliser le code.",
      evidence: licenseId ? `reconnue : ${licenseId}` : "licence absente ou non reconnue (SPDX)",
    },
    {
      id: "gitignore", label: ".gitignore", weight: 0.10,
      present: ignoreEffective,
      hint: "Empêche de committer les artefacts de build.",
      evidence: gitignore ? (ignoreEffective ? "couvre les artefacts" : "ne mentionne pas les artefacts de build") : "absent",
    },
    {
      id: "manifest", label: "Manifeste de dépendances", weight: 0.13,
      present: manifestUsable,
      hint: "Déclare ce qu'il faut installer pour faire tourner le projet.",
      evidence: manifest ? `${manifest.path}${Object.keys(scripts).length ? ` (${Object.keys(scripts).length} scripts)` : ""}` : "aucun manifeste",
    },
    {
      id: "lockfile", label: "Fichier de verrouillage", weight: 0.05,
      present: !!lock,
      hint: "Fige les versions pour des installations reproductibles.",
      evidence: lock ? lock.path : "absent",
    },
    {
      id: "ci", label: "Intégration continue", weight: 0.14,
      present: ciEffective,
      hint: "Vérifie automatiquement chaque contribution.",
      evidence: ci
        ? (ciEffective ? `${ci.path} lance une étape` : `${ci.path} ne lance rien (pas de run: avec test ou build)`)
        : "aucun workflow",
    },
    {
      id: "tests", label: "Tests", weight: 0.12,
      present: !!testFile,
      hint: "Permet de modifier sans casser sans le voir.",
      evidence: testFile ? testFile.path : "aucun fichier de test",
    },
    {
      id: "docs", label: "Documentation complémentaire", weight: 0.05,
      present: mdCount >= 2,
      hint: "Au-delà du README : guides, décisions d'architecture.",
      evidence: `${mdCount} fichier(s) de documentation`,
    },
    {
      id: "clean", label: "Aucun artefact committé", weight: 0.10,
      present: entries.length > 0 && !artifacts,
      hint: "Les dossiers de build n'ont rien à faire dans un dépôt.",
      evidence: artifacts ? "un dossier de build est committé" : "aucun artefact",
    },
    {
      id: "editor", label: "Configuration d'éditeur", weight: 0.07,
      present: !!editor,
      hint: "Fixe le style pour tout le monde, sans discussion.",
      evidence: editor ? editor.path : "aucune configuration de style",
    },
  ];
}

/** Score d'hygiène de dépôt, 0…1 (les poids totalisent 1). */
export function repoHygieneScore(items: readonly HygieneItem[]): number {
  return clamp(items.reduce((a, i) => a + (i.present ? i.weight : 0), 0), 0, 1);
}

/* ------------------------------------------------------------------ */
/* Sécurité                                                            */
/* ------------------------------------------------------------------ */

export interface SecurityFinding {
  id: string;
  label: string;
  /** `fichier:ligne`, pour que l'utilisateur voie où agir. */
  where: string;
  severity: "high" | "medium";
}

/** Motifs de clés. Volontairement stricts : un faux positif use la confiance. */
const SECRET_RX: [string, RegExp][] = [
  ["clé privée", /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["clé AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["jeton GitHub", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["jeton Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["clé Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["clé Stripe", /\bsk_live_[0-9a-zA-Z]{20,}\b/],
  ["chaîne de connexion", /\b(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s:@]+:[^\s@]+@/],
  [
    "secret en dur",
    /\b(?:api[_-]?key|apikey|secret|access[_-]?token|password|passwd|private[_-]?key)\b\s*[:=]\s*["'`][^"'`\s]{12,}["'`]/i,
  ],
];

const EVAL_RX = /\beval\s*\(|new\s+Function\s*\(|child_process[^\n]*\bexec\s*\(/;

/**
 * Valeurs qui sont manifestement des **exemples**, pas des secrets.
 *
 * `AKIAIOSFODNN7EXAMPLE` est la clé d'exemple de la documentation AWS ;
 * `your-token-here`, `changeme` et `<API_KEY>` sont des marqueurs. Un
 * avertisseur qui crie sur la documentation officielle use la confiance
 * qu'on lui accorde, et une alerte ignorée est une alerte perdue.
 */
const PLACEHOLDER_RX = /example|exemple|placeholder|changeme|change[_-]?me|your[_-]|dummy|fake|redacted|sample|xxxx+|\.\.\.|<[^>]{1,40}>/i;

/**
 * Fichiers exemptés du scan de secrets : les **vecteurs de test** du moteur
 * lui-même.
 *
 * Un outil qui signale ses propres valeurs d'exemple ne peut plus être
 * démontré. La liste est explicite et nommée, comme un `.gitleaksignore`,
 * plutôt que devinée par une règle qui laisserait passer de vrais secrets.
 */
const SECRET_SCAN_EXEMPT = [
  "lib/scoring/corpus.ts",
  "scripts/test-scoring.ts",
];
/** Fichiers d'environnement qui ne devraient pas être committés. */
const ENV_RX = /(^|\/)\.env(\.(?!example|sample|template|dist)[\w.-]+)?$/i;

export interface SecurityReport {
  findings: SecurityFinding[];
  /** Au moins un secret est présent dans le dépôt. */
  hasSecret: boolean;
  /** Un fichier `.env` (hors `.example`) est committé. */
  committedEnv: boolean;
  /** Appels à `eval` / `new Function` / `exec`. */
  evalCount: number;
  /** Un fichier de verrouillage existe. */
  locked: boolean;
  /** Licence copyleft détectée. */
  copyleft: boolean;
  /** Score 0…1. */
  score: number;
}

/**
 * Cherche ce qui se voit dans un dépôt public et qui ne devrait pas s'y
 * trouver.
 *
 * Ce n'est pas un antivirus : c'est un **avertisseur**. Un secret committé
 * est le seul défaut qui ne se corrige pas en éditant le fichier — il faut
 * révoquer la clé —, donc il plafonne la note au lieu de la réduire.
 */
export function scanSecurity(entries: readonly FileEntry[]): SecurityReport {
  const findings: SecurityFinding[] = [];
  let evalCount = 0;
  let committedEnv = false;

  for (const entry of entries) {
    if (isGenerated(entry.path)) continue;

    if (ENV_RX.test(entry.path)) {
      committedEnv = true;
      findings.push({
        id: "env", label: "fichier .env committé", where: entry.path, severity: "high",
      });
      continue;
    }

    // On ne scanne que du texte : les binaires et les ressources n'ont pas
    // de clés, et les lire coûterait le plus cher pour rien.
    if (!isScoreable(entry.path)) continue;

    // Les vecteurs de test du moteur ne sont pas des fuites : un outil doit
    // pouvoir être exécuté sur lui-même.
    if (SECRET_SCAN_EXEMPT.includes(entry.path)) continue;

    const lines = entry.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const [label, rx] of SECRET_RX) {
        const match = rx.exec(line);
        if (!match) continue;
        if (PLACEHOLDER_RX.test(match[0])) break;
        findings.push({
          id: "secret", label: `secret : ${label}`, where: `${entry.path}:${i + 1}`, severity: "high",
        });
        break;
      }
      if (EVAL_RX.test(line)) evalCount++;
    }
  }

  const locked = entries.some((e) =>
    /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock|go\.sum)$/i.test(e.path),
  );
  const license = findFile(entries, /(^|\/)(licen[cs]e|copying)(\.|$)/i);
  const copyleft = !!license && COPYLEFT_RX.test(license.content);

  const hasSecret = findings.some((f) => f.id === "secret");
  if (copyleft) {
    findings.push({
      id: "copyleft",
      label: "licence copyleft : vérifiez la compatibilité avant réutilisation",
      where: license!.path,
      severity: "medium",
    });
  }
  if (!locked) {
    findings.push({
      id: "lockfile",
      label: "dépendances non verrouillées",
      where: "manifeste sans fichier de verrouillage",
      severity: "medium",
    });
  }

  let score = 1;
  if (hasSecret) score -= 0.7;
  if (committedEnv) score -= 0.3;
  score -= 0.10 * Math.min(1, evalCount / 2);
  if (!locked) score -= 0.10;
  if (copyleft) score -= 0.10;

  return {
    findings,
    hasSecret,
    committedEnv,
    evalCount,
    locked,
    copyleft,
    score: clamp(score, 0, 1),
  };
}

/* ------------------------------------------------------------------ */
/* Score de projet                                                     */
/* ------------------------------------------------------------------ */

export interface ProjectMetrics {
  files: number;
  scored: number;
  lines: number;
  sloc: number;
  comments: number;
  functions: number;
  /** Complexité cyclomatique cumulée du projet. */
  cyclomatic: number;
  /** Moyenne des indices de maintenabilité **par fonction**, 0…100. */
  maintainability: number;
  languages: number;
  /** Fichiers de code hors tests. */
  sourceFiles: number;
  testFiles: number;
  imports: number;
  /** Part des fenêtres de 4 lignes répétées — mesurée à l'échelle du projet. */
  duplicateShare: number;
  /** Fichiers pris dans un cycle d'imports. */
  cyclicFiles: number;
  /** Fichiers de code que personne n'importe. */
  orphanFiles: number;
  /** L'analyse a été tronquée sur au moins un fichier. */
  truncated: boolean;
  /** Fiabilité du masquage, la plus basse rencontrée. */
  confidence: "lexer" | "heuristic";
}

export interface ProjectScore {
  score: number;
  grade: Grade;
  dimensions: DimensionScores<ProjectDimension>;
  metrics: ProjectMetrics;
  files: FileScore[];
  /** Les fichiers qui plombent le score — affichés en priorité. */
  hotspots: FileScore[];
  /** Ce qui est déjà bien, en clair. */
  strengths: string[];
  /** Ce qui coûte le plus de points. */
  weaknesses: string[];
}

/** Toutes les mesures d'un dépôt, calculées une seule fois. */
interface Analysis {
  analysed: { path: string; source: AnalysedSource }[];
  files: FileScore[];
  production: FileMetrics[];
  testMetrics: FileMetrics[];
  facts: ProjectFacts;
  security: SecurityReport;
  hygiene: HygieneItem[];
  metrics: ProjectMetrics;
}

function analyseEntries(entries: readonly FileEntry[], cache?: BlobCache<CachedFile>): Analysis {
  const analysed = entries
    .filter((e) => isScoreable(e.path))
    .map((e) => {
      // Le cache est indexé par le SHA du contenu **et** vérifié sur le
      // chemin : un fichier inchangé entre deux commits ne repasse pas par
      // l'analyse, ce qui rend le suivi commit par commit praticable.
      const hit = cacheLookup(cache, e.path, e.content);
      if (hit) return { path: e.path, source: hit.source, score: hit.score };
      const source = analyse(e.content, e.path);
      const score = scoreAnalysed(e.path, source);
      cacheRemember(cache, e.path, e.content, { source, score });
      return { path: e.path, source, score };
    });

  const files = analysed.map((a) => a.score).filter((f) => f.metrics.sloc > 0);

  // Les tests ne sont pas jugés comme du code de production : ils se
  // mesurent (ratio, assertions), ils ne se font pas reprocher leurs
  // littéraux ni leurs fonctions longues. Écrire des tests ne doit jamais
  // faire baisser la note — c'était pourtant le cas.
  const production = files.filter((f) => !f.metrics.isTest).map((f) => f.metrics);
  const testMetrics = files.filter((f) => f.metrics.isTest).map((f) => f.metrics);
  const productionPaths = new Set(
    files.filter((f) => !f.metrics.isTest).map((f) => f.path),
  );
  const productionSources = analysed.filter((a) => productionPaths.has(a.path));

  const coupling = analyseCoupling(productionSources);

  // Duplication inter-fichiers : une empreinte qui apparaît dans deux
  // fichiers est une copie, même si chaque fichier, pris seul, est propre.
  const counts = new Map<number, number>();
  let windows = 0;
  for (const f of production) {
    for (const h of f.windowHashes) {
      counts.set(h, (counts.get(h) ?? 0) + 1);
      windows++;
    }
  }
  let repeats = 0;
  for (const c of counts.values()) if (c > 1) repeats += c - 1;

  const security = scanSecurity(entries);
  const hygiene = repoHygiene(entries);
  const documental = readmeFacts(entries);
  const scripts = packageJsonScripts(entries);
  const ci = entries.find((e) =>
    /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(e.path) ||
    /(^|\/)(\.gitlab-ci\.yml|\.travis\.yml|\.circleci\/config\.yml)$/i.test(e.path),
  );

  const functions = production.flatMap((f) => f.functions);
  const apiTotal = production.reduce((a, f) => a + f.api.total, 0);
  const apiDocumented = production.reduce((a, f) => a + f.api.documented, 0);
  const hasManifestTest = /\btest\b|pytest/i.test(
    entries
      .filter((e) => /(pyproject\.toml|makefile|setup\.cfg|tox\.ini)$/i.test(e.path))
      .map((e) => e.content)
      .join("\n"),
  );

  const facts: ProjectFacts = {
    functions,
    files: production,
    duplicateShare: windows ? repeats / windows : 0,
    coupling,
    tests: {
      testSloc: testMetrics.reduce((a, f) => a + f.sloc, 0),
      sourceSloc: production.reduce((a, f) => a + f.sloc, 0),
      testFiles: testMetrics.length,
      assertions: testMetrics.reduce((a, f) => a + f.assertions, 0),
      hasTestScript: typeof scripts.test === "string" || hasManifestTest,
      ciRunsTests: !!ci && ciRunsSomething(ci.content),
    },
    documentation: {
      apiTotal,
      apiDocumented,
      readmeWords: documental.words,
      readmeSections: documental.sections,
      commentRatios: production.map((f) => f.commentRatio),
    },
    security: security.score,
    repository: repoHygieneScore(hygiene),
  };

  const maintainabilities = functions.map((f) => f.maintainability);
  const metrics: ProjectMetrics = {
    files: entries.length,
    scored: files.length,
    lines: files.reduce((a, f) => a + f.metrics.lines, 0),
    sloc: files.reduce((a, f) => a + f.metrics.sloc, 0),
    comments: files.reduce((a, f) => a + f.metrics.comments, 0),
    functions: functions.length,
    cyclomatic: production.reduce((a, f) => a + f.cyclomatic, 0),
    maintainability: meanOf(maintainabilities),
    languages: new Set(files.map((f) => languageOf(f.path))).size,
    sourceFiles: production.length,
    testFiles: testMetrics.length,
    imports: production.reduce((a, f) => a + f.imports, 0),
    duplicateShare: facts.duplicateShare,
    cyclicFiles: coupling.cyclicFiles,
    orphanFiles: coupling.orphans.length,
    truncated: files.some((f) => f.metrics.truncated),
    confidence: files.some((f) => f.metrics.confidence === "heuristic") ? "heuristic" : "lexer",
  };

  return { analysed, files, production, testMetrics, facts, security, hygiene, metrics };
}

function readmeFacts(entries: readonly FileEntry[]): { words: number; sections: boolean } {
  const readme = findFile(entries, /(^|\/)readme(\.|$)/i);
  if (!readme) return { words: 0, sections: false };
  return {
    words: wordCount(readme.content),
    sections:
      /installation|installer|install\b/i.test(readme.content) &&
      /usage|utilisation|utiliser|getting started|démarrage|quick ?start/i.test(readme.content),
  };
}

/** Ce qu'un cache de blobs retient pour un fichier : de quoi ne rien refaire. */
export interface CachedFile {
  source: AnalysedSource;
  score: FileScore;
}

/** Score d'un projet : les huit dimensions, agrégées puis plafonnées. */
export function scoreProject(
  entries: FileEntry[],
  cache?: BlobCache<CachedFile>,
): ProjectScore {
  const a = analyseEntries(entries, cache);

  if (a.files.length === 0 || a.production.length === 0) {
    return emptyProject(entries.length);
  }

  const dimensions = projectDimensions(a.facts);
  const caps = projectCaps(a);
  const raw = Math.round(SCORE_MAX * aggregate(dimensions, PROJECT_WEIGHTS_DERIVED));
  const { score } = applyCaps(raw, caps);

  const sized = a.files;
  const hotspots = [...sized].sort((x, y) => x.score - y.score).slice(0, 5);

  return {
    score,
    grade: gradeFor(score),
    dimensions,
    metrics: a.metrics,
    files: a.files,
    hotspots,
    strengths: describeStrengths(dimensions, a.metrics),
    weaknesses: describeWeaknesses(dimensions, a.metrics),
  };
}

/**
 * Poids de la note **de projet** : les sept dimensions du code, l'hygiène
 * de dépôt n'entrant qu'au niveau du dépôt. On dérive les poids de
 * `PROJECT_WEIGHTS` rather than duplicating them, pour qu'un ajustement de
 * barème ne puisse pas s'appliquer à une échelle et pas à l'autre.
 */
const PROJECT_WEIGHTS_DERIVED: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  const core = PROJECT_DIMENSIONS.filter((k) => k !== "repository");
  const total = core.reduce((s, k) => s + REPO_WEIGHTS[k], 0);
  for (const k of core) out[k] = REPO_WEIGHTS[k] / total;
  return out;
})();

/** Les plafonds qui ne doivent pas se diluer dans une moyenne. */
function projectCaps(a: Analysis): ScoreCap[] {
  const caps: ScoreCap[] = [];
  if (a.security.hasSecret) {
    caps.push({
      id: "secret",
      label: "un secret est présent dans le dépôt : la note ne peut pas dépasser C",
      max: ceilingOf("C"),
    });
  }
  if (a.security.committedEnv) {
    caps.push({
      id: "env",
      label: "un fichier .env est committé : la note ne peut pas dépasser B",
      max: ceilingOf("B"),
    });
  }
  if (a.metrics.testFiles === 0) {
    caps.push({
      id: "no-tests",
      label: "aucun test : la note ne peut pas dépasser B",
      max: ceilingOf("B"),
    });
  }
  return caps;
}

/** Le projet vide : une structure valide, un score nul, et une raison. */
function emptyProject(fileCount: number): ProjectScore {
  const dimensions = Object.fromEntries(
    PROJECT_DIMENSIONS.map((k) => [k, 0]),
  ) as DimensionScores<ProjectDimension>;

  return {
    score: 0,
    grade: gradeFor(0),
    dimensions,
    metrics: {
      files: fileCount, scored: 0, lines: 0, sloc: 0, comments: 0, functions: 0,
      cyclomatic: 0, maintainability: 0, languages: 0, sourceFiles: 0,
      testFiles: 0, imports: 0, duplicateShare: 0, cyclicFiles: 0,
      orphanFiles: 0, truncated: false, confidence: "lexer",
    },
    files: [],
    hotspots: [],
    strengths: [],
    weaknesses: ["Aucun fichier de code à évaluer."],
  };
}

function describeStrengths(d: DimensionScores<ProjectDimension>, m: ProjectMetrics): string[] {
  const out: string[] = [];
  const strong = (k: ProjectDimension, text: string) => {
    const v = d[k];
    if (v !== null && v !== undefined && v >= 0.75) out.push(text);
  };
  strong("complexity", "Fonctions courtes et peu ramifiées.");
  strong("structure", "Fichiers de taille raisonnable, peu d'imbrication.");
  strong("duplication", "Peu de code recopié.");
  strong("coupling", "Graphe d'imports sans cycle, dépendances lisibles.");
  strong("tests", `${m.testFiles} fichier(s) de test pour ${m.sourceFiles} source(s).`);
  strong("documentation", "API exportée documentée, README utilisable.");
  strong("security", "Aucun secret détecté, dépendances verrouillées.");
  strong("repository", "Dépôt installable et transmissible en l'état.");
  return out;
}

function describeWeaknesses(d: DimensionScores<ProjectDimension>, m: ProjectMetrics): string[] {
  const out: string[] = [];
  const weak = (k: ProjectDimension, text: string) => {
    const v = d[k];
    if (v !== null && v !== undefined && v < 0.5) out.push(text);
  };
  weak("complexity", "Des fonctions trop ramifiées.");
  weak("structure", "Fichiers ou fonctions trop longs.");
  weak("duplication", `Code recopié (${Math.round(m.duplicateShare * 100)} % de fenêtres répétées).`);
  weak("coupling", "Cycles d'imports ou dépendances instables.");
  weak("tests", "Peu ou pas de tests.");
  weak("documentation", "Documentation faible.");
  weak("security", "Secrets, .env committé ou dépendances non verrouillées.");
  weak("repository", "Dépôt difficile à reprendre en l'état.");
  return out;
}

/* ------------------------------------------------------------------ */
/* Score de dépôt                                                      */
/* ------------------------------------------------------------------ */

export interface RepoScore extends Omit<ProjectScore, "dimensions"> {
  /**
   * Score du projet seul, **avant** l'hygiène de dépôt.
   * `score` est le score final, hygiène comprise : garder les deux permet
   * à l'écran de montrer séparément « le code est-il bon ? » et « le dépôt
   * est-il repris facilement ? », qui sont deux questions.
   */
  projectScore: number;
  /** Score d'hygiène de dépôt, sur 1000. */
  hygieneScore: number;
  hygiene: HygieneItem[];
  dimensions: DimensionScores<ProjectDimension>;
  /** Plafonds qui ont effectivement réduit la note. */
  caps: ScoreCap[];
  /** Faits de sécurité — secrets, `.env`, `eval`. */
  security: SecurityReport;
  /** Les actions qui rapportent le plus de points, dans l'ordre. */
  actions: Action[];
}

/**
 * Score d'un dépôt : le projet, plus une dimension d'hygiène.
 *
 * L'hygiène pèse 15 % parce qu'un dépôt parfaitement écrit mais impossible
 * à installer vaut moins qu'un dépôt modeste que n'importe qui peut lancer.
 */
export function scoreRepo(
  entries: FileEntry[],
  cache?: BlobCache<CachedFile>,
): RepoScore {
  const a = analyseEntries(entries, cache);

  if (a.files.length === 0 || a.production.length === 0) {
    const empty = emptyProject(entries.length);
    return {
      ...empty,
      projectScore: 0,
      score: 0,
      grade: gradeFor(0),
      hygieneScore: Math.round(repoHygieneScore(a.hygiene) * SCORE_MAX),
      hygiene: a.hygiene,
      caps: [],
      security: a.security,
      actions: [],
    };
  }

  const dimensions = projectDimensions(a.facts);
  const caps = projectCaps(a);

  // La note de projet exclut l'hygiène de dépôt ; celle du dépôt l'inclut
  // pour 15 %. Deux échelles, deux questions, un seul jeu de faits.
  const projectRaw = Math.round(SCORE_MAX * aggregate(dimensions, PROJECT_WEIGHTS_DERIVED));
  const projectScore = applyCaps(projectRaw, caps).score;

  const repoRaw = Math.round(SCORE_MAX * aggregate(dimensions, REPO_WEIGHTS));
  const { score, applied } = applyCaps(repoRaw, caps);

  return {
    score,
    grade: gradeFor(score),
    projectScore,
    hygieneScore: Math.round(repoHygieneScore(a.hygiene) * SCORE_MAX),
    hygiene: a.hygiene,
    dimensions,
    caps: applied ? [applied] : [],
    security: a.security,
    metrics: a.metrics,
    files: a.files,
    hotspots: [...a.files].sort((x, y) => x.score - y.score).slice(0, 5),
    strengths: describeStrengths(dimensions, a.metrics),
    weaknesses: describeWeaknesses(dimensions, a.metrics),
    actions: buildActions(a, dimensions, repoRaw, score, applied),
  };
}

/* ------------------------------------------------------------------ */
/* Les actions qui rapportent le plus de points                        */
/* ------------------------------------------------------------------ */

export interface Action {
  id: string;
  /** Ce qu'il y a à faire, en une phrase. */
  label: string;
  /** Points estimés si le défaut est corrigé. */
  gain: number;
  dimension: ProjectDimension;
  /** Où agir : `fichier:ligne` quand c'est localisable. */
  where: string[];
}

/**
 * « Les trois actions qui rapportent le plus de points. »
 *
 * Un score sur 1000 qui ne dit pas *quoi faire* reste un jugement. Pour
 * chaque défaut, on estime le gain en **recalculant la moyenne pondérée**
 * avec la dimension corrigée : c'est la définition du gain, pas une
 * intuition, et l'utilisateur peut vérifier le calcul.
 *
 * Chaque ligne renvoie à `fichier:ligne` quand le défaut est localisable,
 * pour qu'il n'y ait pas d'écart entre ce qu'on conseille et l'endroit où
 * le faire.
 */
export function buildActions(
  a: Analysis,
  dimensions: DimensionScores<ProjectDimension>,
  /** Score avant plafonds : l'écart avec `score` est ce que coûtent les plafonds. */
  raw: number,
  score: number,
  appliedCap: ScoreCap | null,
): Action[] {
  const weightTotal = Object.values(REPO_WEIGHTS).reduce((x, y) => x + y, 0);
  const gainOf = (dim: ProjectDimension, target: number): number => {
    const now = dimensions[dim];
    if (now === null || now === undefined) return 0;
    const delta = Math.max(0, Math.min(1, target) - now);
    return (delta * REPO_WEIGHTS[dim] * SCORE_MAX) / weightTotal;
  };
  /** Points actuellement perdus à cause du plafond `id`, s'il mord. */
  const capCost = (id: string): number =>
    appliedCap?.id === id ? Math.max(0, raw - score) : 0;

  const out: Action[] = [];

  // Un secret ne se contente pas de coûter des points : il plafonne la
  // note, et c'est la première chose à corriger — une clé committée reste
  // compromise même après suppression du fichier.
  if (a.security.hasSecret || a.security.committedEnv) {
    out.push({
      id: "secret",
      label: a.security.hasSecret
        ? "Révoquer et retirer les secrets committés (révoquer la clé, pas seulement supprimer la ligne)"
        : "Retirer le fichier .env du dépôt et le remplacer par un .env.example",
      gain: Math.round(capCost("secret") + capCost("env") + gainOf("security", 0.95)),
      dimension: "security",
      where: a.security.findings.filter((f) => f.id === "secret" || f.id === "env").map((f) => f.where).slice(0, 5),
    });
  }

  if (a.metrics.testFiles === 0) {
    out.push({
      id: "tests",
      label: "Écrire un premier fichier de test (sans test, la note ne peut pas dépasser B)",
      gain: Math.round(capCost("no-tests") + gainOf("tests", 0.6)),
      dimension: "tests",
      where: ["tests/"],
    });
  } else if (!a.facts.tests.ciRunsTests) {
    out.push({
      id: "ci-tests",
      label: "Ajouter une étape de test dans le CI (run: npm test)",
      gain: Math.round(SCORE_MAX * 0.10 * REPO_WEIGHTS.tests / weightTotal +
        SCORE_MAX * 0.14 * REPO_WEIGHTS.repository / weightTotal),
      dimension: "tests",
      where: [".github/workflows/"],
    });
  }

  const readmeItem = a.hygiene.find((h) => h.id === "readme");
  if (readmeItem && !readmeItem.present) {
    out.push({
      id: "readme",
      label: `Compléter le README (${readmeItem.evidence}) avec une section installation et une section usage`,
      gain: Math.round(gainOf("repository", Math.min(1, dimensions.repository! + readmeItem.weight))),
      dimension: "repository",
      where: ["README.md"],
    });
  }

  // Complexité : on nomme les fonctions, pas le fichier — un conseil
  // « ce fichier est complexe » n'est pas actionnable.
  const heavy = a.production
    .flatMap((f) => f.functions.map((fn) => ({ file: f.path, fn })))
    .filter(({ fn }) => fn.cyclomatic > 15 || fn.cognitive > 20)
    .sort((x, y) => (y.fn.cyclomatic + y.fn.cognitive) - (x.fn.cyclomatic + x.fn.cognitive))
    .slice(0, 5);
  if (heavy.length) {
    out.push({
      id: "complexity",
      label: "Découper les fonctions les plus ramifiées",
      gain: Math.round(gainOf("complexity", 0.8)),
      dimension: "complexity",
      where: heavy.map(({ file, fn }) => `${file}:${fn.line} → ${fn.name} (CC ${fn.cyclomatic}, cognitive ${fn.cognitive})`),
    });
  }

  // Documentation : les fonctions exportées et non documentées, nommées.
  const undocumented = a.production
    .flatMap((f) => f.functions.filter((fn) => fn.exported && !fn.documented).map((fn) => ({ file: f.path, fn })))
    .slice(0, 5);
  if (undocumented.length) {
    out.push({
      id: "documentation",
      label: "Documenter l'API exportée (JSDoc ou docstring)",
      gain: Math.round(gainOf("documentation", 0.85)),
      dimension: "documentation",
      where: undocumented.map(({ file, fn }) => `${file}:${fn.line} → ${fn.name}`),
    });
  }

  // Duplication : les fenêtres répétées sont localisées par fichier.
  const duplicated = a.production
    .filter((f) => f.duplicateLines > 0)
    .sort((x, y) => y.duplicateLines - x.duplicateLines)
    .slice(0, 5);
  if (duplicated.length) {
    out.push({
      id: "duplication",
      label: "Extraire le code recopié dans une fonction partagée",
      gain: Math.round(gainOf("duplication", 0.9)),
      dimension: "duplication",
      where: duplicated.map((f) => `${f.path} (${f.duplicateLines} lignes recopiées)`),
    });
  }

  // Couplage : cycles d'abord, orphelins ensuite.
  if (a.facts.coupling.cyclicFiles > 0 || a.facts.coupling.orphans.length > 0) {
    out.push({
      id: "coupling",
      label: a.facts.coupling.cyclicFiles > 0
        ? "Casser les cycles d'imports (extraire le type ou le module partagé)"
        : "Supprimer ou câbler les fichiers que personne n'importe",
      gain: Math.round(gainOf("coupling", 0.9)),
      dimension: "coupling",
      where: a.facts.coupling.orphans.slice(0, 5),
    });
  }

  return out
    .filter((action) => action.gain > 0)
    .sort((x, y) => y.gain - x.gain)
    .slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Évolution du score par commit                                       */
/* ------------------------------------------------------------------ */

/** Un état du dépôt à un instant donné : ce que git a à un sha. */
export interface RepoSnapshot {
  sha: string;
  /** Date ISO du commit. */
  at: string;
  files: FileEntry[];
}

export interface HistoryPoint {
  sha: string;
  at: string;
  score: number;
  grade: string;
  sloc: number;
  /** Fichiers dont le contenu a changé depuis le commit précédent. */
  changedFiles: number;
}

/**
 * Trace le score **à chaque commit**.
 *
 * C'est la réponse directe à « preuve de travail = réputation » : une note
 * instantanée dit où en est un dépôt, une courbe dit comment il y est
 * arrivé — et une courbe est bien plus difficile à falsifier qu'une note.
 *
 * Le coût est celui des fichiers qui ont changé, pas de l'historique : le
 * cache par SHA de blob fait que les commits qui ne touchent que deux
 * fichiers ne coûtent que deux analyses. C'est exactement l'usage pour
 * lequel le cache existe.
 */
export function scoreEvolution(
  snapshots: readonly RepoSnapshot[],
  cache: BlobCache<CachedFile> = newBlobCache<CachedFile>(),
): { history: HistoryPoint[]; stats: ReturnType<typeof cacheStats> } {
  const history: HistoryPoint[] = [];
  let previous = new Map<string, string>();

  for (const snapshot of snapshots) {
    const current = new Map(snapshot.files.map((f) => [f.path, f.content] as const));
    let changedFiles = 0;
    for (const [path, content] of current) {
      if (previous.get(path) !== content) changedFiles++;
    }

    const repo = scoreRepo(snapshot.files, cache);
    history.push({
      sha: snapshot.sha,
      at: snapshot.at,
      score: repo.score,
      grade: repo.grade.letter,
      sloc: repo.metrics.sloc,
      changedFiles,
    });
    previous = current;
  }

  return { history, stats: cacheStats(cache) };
}
