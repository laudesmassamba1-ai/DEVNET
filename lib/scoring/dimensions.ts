/**
 * La couche de **calibration** : des faits vers des scores sur 0…1.
 *
 * ## Un signal, une dimension
 *
 * La version précédente comptait le même défaut plusieurs fois :
 * l'imbrication pesait dans `cognitive`, dans `structure` **et** dans la
 * note de ligne ; les nombres magiques et les lignes longues pesaient dans
 * `readability` (moyenne des lignes) **et** dans `hygiene`. Avec une
 * moyenne géométrique, un même défaut se multipliait au lieu de s'ajouter
 * — un fichier imbriqué perdait trois fois plus de points qu'un fichier
 * équivalent par un autre défaut.
 *
 * Ici, chaque signal appartient à **une** dimension :
 *
 * | dimension de fichier | signaux qui lui appartiennent |
 * |---|---|
 * | complexité | CC et cognition par fonction (moyenne, p90, part de rouges) |
 * | structure | taille des fonctions et du fichier, imbrication relative |
 * | duplication | fenêtres de 4 lignes répétées |
 * | documentation | API exportée documentée, plateau de commentaires |
 * | nommage | identifiants courts, longueur moyenne, ratio descriptif |
 * | hygiène | espaces en fin de ligne, lignes longues, TODOs, indentation mixte, nombres magiques |
 *
 * La note d'une ligne (`scoreLine`, dans `score.ts`) est une **échelle à
 * part** : elle répond à « qu'est-ce que je corrige sur cette ligne ? ».
 * Ce n'est plus une dimension de fichier, précisément pour ne pas ajouter
 * une seconde fois tout ce que les dimensions comptent déjà.
 *
 * ## Moyenne pondérée, puis plafonds
 *
 * L'agrégation est une **moyenne pondérée** — lisible, additive, et dont
 * on peut dire à un utilisateur ce qu'un point de plus veut dire. Un
 * défaut grave ne se noie pas dans une moyenne : il est traité par un
 * **plafond**, explicite et nommé (« un secret committé plafonne la note à
 * C »). Un plafond s'explique en une phrase ; une moyenne géométrique de
 * dimensions corrélées, non.
 */

import { clamp } from "../mathx";
import {
  CC_RED,
  COGNITIVE_RED,
  DEEP_NESTING,
  FUNCTION_LENGTH_SMELL,
  type FileMetrics,
  type FunctionMetric,
} from "./metrics";
import { maxOf, meanOf, percentile, sortedCopy } from "./stats";
import type { CouplingReport } from "./coupling";

/* ------------------------------------------------------------------ */
/* Rampes                                                              */
/* ------------------------------------------------------------------ */

/** Vaut 1 tant que `x ≤ good`, 0 dès `x ≥ bad` : « plus bas est mieux ». */
export function rampDown(x: number, good: number, bad: number): number {
  if (bad <= good) return x <= good ? 1 : 0;
  return clamp(1 - (x - good) / (bad - good), 0, 1);
}

/** Vaut 0 tant que `x ≤ bad`, 1 dès `x ≥ good` : « plus haut est mieux ». */
export function rampUp(x: number, bad: number, good: number): number {
  if (good <= bad) return x >= good ? 1 : 0;
  return clamp((x - bad) / (good - bad), 0, 1);
}

/** Triangle : 0 à `lo`, 1 à `mid`, 0 à `hi` — pour les valeurs « idéales ». */
export function triangle(x: number, lo: number, mid: number, hi: number): number {
  if (x <= lo || x >= hi) return 0;
  return x <= mid ? (x - lo) / (mid - lo) : (hi - x) / (hi - mid);
}

/**
 * Plateau de commentaires : utile jusqu'à ~12 %, sans valeur au-delà, et
 * **pénalisé** au-delà de 35 %.
 *
 * Le plafond haut n'est pas une coquetterie : un ratio de commentaires est
 * le levier le plus simple pour gonfler un score sans rien écrire de
 * mieux. Le borner à l'intérieur de la dimension évite d'avoir à traiter
 * séparément le cas d'un fichier commenté à 80 % qui ne dit rien.
 */
export function commentPlateau(ratio: number): number {
  if (ratio <= 0.35) return rampUp(ratio, 0, 0.12);
  return 1 - 0.45 * rampUp(ratio, 0.35, 0.7);
}

/* ------------------------------------------------------------------ */
/* Agrégation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Moyenne pondérée **renormalisée sur les dimensions applicables**.
 *
 * Une dimension à `null` n'est pas « parfaite » (1) ni « nulle » (0) :
 * elle n'existe pas pour ce fichier, et son poids est redistribué. C'est
 * ce qui permet de ne pas noter la complexité d'un fichier sans fonction
 * — la corriger en lui donnant 1 aurait offert un point gratuit, la
 * corriger en lui donnant 0 aurait puni un fichier de configuration.
 */
export function aggregate(
  dims: Record<string, number | null | undefined>,
  weights: Record<string, number>,
): number {
  let acc = 0;
  let total = 0;
  for (const key of Object.keys(weights)) {
    const v = dims[key];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    acc += weights[key] * clamp(v, 0, 1);
    total += weights[key];
  }
  return total > 0 ? acc / total : 0;
}

/** Un plafond : une raison en clair, et le score au-delà duquel on ne monte pas. */
export interface ScoreCap {
  id: string;
  label: string;
  max: number;
}

/** Applique les plafonds et dit lequel a mordu, s'il y en a un. */
export function applyCaps(
  score: number,
  caps: readonly ScoreCap[],
): { score: number; applied: ScoreCap | null } {
  let best: ScoreCap | null = null;
  for (const cap of caps) {
    if (score <= cap.max) continue;
    if (!best || cap.max < best.max) best = cap;
  }
  return { score: best ? best.max : score, applied: best };
}

/* ------------------------------------------------------------------ */
/* Dimensions de fichier                                               */
/* ------------------------------------------------------------------ */

export const FILE_DIMENSIONS = [
  "complexity", "structure", "duplication", "documentation", "naming", "hygiene",
] as const;
export type FileDimension = (typeof FILE_DIMENSIONS)[number];

/** Valeur `null` : la dimension ne s'applique pas à ce fichier. */
export type FileDimensionScores = Record<FileDimension, number | null>;

export const FILE_WEIGHTS: Record<FileDimension, number> = {
  complexity: 0.28,
  structure: 0.22,
  duplication: 0.14,
  documentation: 0.14,
  naming: 0.10,
  hygiene: 0.12,
};

/** Complexité d'un ensemble de fonctions : moyenne, p90, pires cas. */
export function complexityScore(functions: readonly FunctionMetric[]): number | null {
  // Sans fonction détectée, il n'y a rien à noter : mesurer la complexité
  // d'un fichier de constantes en comparant le total du fichier à des
  // seuils prévus par fonction donnait 0,00 sur trente fonctions triviales.
  if (!functions.length) return null;

  const cc = functions.map((f) => f.cyclomatic);
  const cog = functions.map((f) => f.cognitive);
  const redCC = cc.filter((v) => v > CC_RED).length / cc.length;
  const redCog = cog.filter((v) => v > COGNITIVE_RED).length / cog.length;

  // Le calibrage vise une moyenne d'environ **2** par fonction et tolère
  // jusqu'à 10 : au-delà, une fonction n'est plus un cas particulier mais
  // une habitude. Les bornes sont des rampes, pas des falaises — une
  // fonction à 3 ne doit pas être traitée comme une fonction à 10.
  return aggregate(
    {
      meanCC: rampDown(meanOf(cc), 2, 10),
      p90CC: rampDown(percentile(sortedCopy(cc), 0.9), 3, 18),
      redCC: 1 - redCC,
      p90Cog: rampDown(percentile(sortedCopy(cog), 0.9), 4, 20),
      redCog: 1 - redCog,
    },
    { meanCC: 0.30, p90CC: 0.25, redCC: 0.15, p90Cog: 0.20, redCog: 0.10 },
  );
}

/** Structure d'un fichier : taille, imbrication **relative**, fonctions longues. */
export function structureScore(m: FileMetrics): number {
  const fns = m.functions;
  const lengths = fns.map((f) => f.length);
  const deep = fns.filter((f) => f.maxDepth >= DEEP_NESTING).length;

  return aggregate(
    {
      size: rampDown(m.sloc, 300, 1200),
      lengthP90: fns.length
        ? rampDown(percentile(sortedCopy(lengths), 0.9), 25, 90)
        : null,
      longShare: fns.length ? 1 - m.longFunctions / fns.length : null,
      deepShare: fns.length ? 1 - deep / fns.length : null,
    },
    { size: 0.35, lengthP90: 0.25, longShare: 0.20, deepShare: 0.20 },
  );
}

/** Duplication d'un fichier : part des lignes qui sont une copie. */
export function duplicationScore(m: FileMetrics): number {
  const ratio = m.duplicateLines / Math.max(m.sloc, 1);
  return 1 - rampUp(ratio, 0, 0.15);
}

/** Documentation d'un fichier : API documentée, puis plateau de commentaires. */
export function documentationScore(m: FileMetrics): number {
  const api = m.api.total > 0 ? m.api.documented / m.api.total : null;
  return aggregate(
    {
      api,
      comments: commentPlateau(m.commentRatio),
      header: m.hasHeaderComment ? 1 : 0.6,
    },
    { api: 0.5, comments: 0.3, header: 0.2 },
  );
}

/** Nommage : identifiants d'une lettre, longueur moyenne, ratio descriptif. */
export function namingScore(m: FileMetrics): number {
  const { naming } = m;
  const poorRatio = naming.distinct ? naming.poor / naming.distinct : 0;
  return aggregate(
    {
      poor: 1 - poorRatio,
      length: triangle(naming.avgLength, 2, 8, 18),
      descriptive: naming.descriptiveRatio,
    },
    { poor: 0.4, length: 0.3, descriptive: 0.3 },
  );
}

/** Hygiène de surface : espaces, lignes longues, TODOs, indentation, magie. */
export function hygieneScore(m: FileMetrics): number {
  const lines = Math.max(m.lines, 1);
  return clamp(
    1 - (
      0.25 * rampUp(m.trailingWhitespace / lines, 0, 0.3) +
      0.25 * rampUp(m.longLines / lines, 0, 0.25) +
      0.15 * rampUp(m.todos, 0, 5) +
      0.20 * (m.mixedIndent ? 1 : 0) +
      0.15 * rampUp(m.magicNumbers / Math.max(m.sloc, 1), 0, 0.1)
    ),
    0,
    1,
  );
}

/** Les six dimensions d'un fichier. */
export function fileDimensions(m: FileMetrics): FileDimensionScores {
  return {
    complexity: complexityScore(m.functions),
    structure: structureScore(m),
    duplication: duplicationScore(m),
    documentation: documentationScore(m),
    naming: namingScore(m),
    hygiene: hygieneScore(m),
  };
}

/* ------------------------------------------------------------------ */
/* Dimensions de projet                                                */
/* ------------------------------------------------------------------ */

export const PROJECT_DIMENSIONS = [
  "complexity", "structure", "duplication", "coupling",
  "tests", "documentation", "security", "repository",
] as const;
export type ProjectDimension = (typeof PROJECT_DIMENSIONS)[number];

/**
 * Score d'une dimension, ou `null` quand elle ne s'applique pas.
 *
 * `null` n'est ni 0 ni 1 : c'est « pas de mesure ». L'agrégation
 * renormalise les poids sur ce qui existe, ce qui évite d'offrir un point
 * gratuit à un fichier de configuration et d'en punir un fichier vide.
 */
export type DimensionScores<K extends string = string> = Record<K, number | null>;

/** Les dimensions qui composent la note **de projet** (hors hygiene de dépôt). */
export type ProjectCoreDimension = Exclude<ProjectDimension, "repository">;

/**
 * Poids du projet : le code d'abord (complexité, structure, duplication,
 * couplage = 0,62), puis ce qui rend un dépôt repris par un autre
 * (tests, documentation, sécurité = 0,38).
 */
export const PROJECT_WEIGHTS: Record<ProjectCoreDimension, number> = {
  complexity: 0.29,
  structure: 0.14,
  duplication: 0.10,
  coupling: 0.09,
  tests: 0.15,
  documentation: 0.12,
  security: 0.11,
};

/**
 * Au niveau du dépôt, l'hygiène de dépôt entre pour 15 % et les dimensions
 * du projet se partagent les 85 % restants, à proportion de leurs poids.
 */
export const REPO_WEIGHTS: Record<ProjectDimension, number> = (() => {
  const core = Object.values(PROJECT_WEIGHTS).reduce((a, b) => a + b, 0);
  const out = {} as Record<ProjectDimension, number>;
  for (const k of PROJECT_DIMENSIONS) {
    out[k] = k === "repository" ? 0.15 : (PROJECT_WEIGHTS[k] / core) * 0.85;
  }
  return out;
})();

/** Ce que les dimensions de projet ont besoin de savoir. */
export interface ProjectFacts {
  /** Fonctions de **production** (hors tests). */
  functions: FunctionMetric[];
  /** Fichiers de production notés. */
  files: FileMetrics[];
  /** Part des fenêtres de 4 lignes répétées dans le projet. */
  duplicateShare: number;
  /** Graphe d'imports. */
  coupling: CouplingReport;
  tests: {
    testSloc: number;
    sourceSloc: number;
    testFiles: number;
    assertions: number;
    /** `package.json` déclare un script `test`. */
    hasTestScript: boolean;
    /** Le workflow de CI lance un test ou un build. */
    ciRunsTests: boolean;
  };
  documentation: {
    apiTotal: number;
    apiDocumented: number;
    /** README présent, en mots. */
    readmeWords: number;
    /** Le README a une section d'installation **et** d'usage. */
    readmeSections: boolean;
    /**
     * Distribution des ratios de commentaires, **un par fichier**.
     *
     * Envoyer la moyenne plutôt que la distribution diluait le problème :
     * un fichier noyé sous les commentaires était compensé par un fichier
     * qui n'en a aucun. On calibre chaque fichier, puis on agrège — la
     * règle qui vaut pour les fonctions vaut ici.
     */
    commentRatios: number[];
  };
  /** Score de sécurité, 0…1, calculé sur les faits du dépôt. */
  security: number;
  /** Score d'hygiène de dépôt, 0…1, calculé sur le contenu. */
  repository: number;
}

/** Les huit dimensions d'un projet, dont l'hygiène de dépôt. */
export function projectDimensions(f: ProjectFacts): DimensionScores<ProjectDimension> {
  const cc = f.functions.map((x) => x.cyclomatic);
  const cog = f.functions.map((x) => x.cognitive);
  const sortedCC = sortedCopy(cc);
  const sortedCog = sortedCopy(cog);

  const complexity: number | null = f.functions.length
    ? aggregate(
        {
          p90CC: rampDown(percentile(sortedCC, 0.9), 4, 18),
          maxCC: rampDown(maxOf(sortedCC), 10, 40),
          redCC: 1 - cc.filter((v) => v > CC_RED).length / cc.length,
          p90Cog: rampDown(percentile(sortedCog, 0.9), 6, 24),
          redCog: 1 - cog.filter((v) => v > COGNITIVE_RED).length / cog.length,
        },
        { p90CC: 0.30, maxCC: 0.20, redCC: 0.20, p90Cog: 0.20, redCog: 0.10 },
      )
    : null;

  const godShare = f.files.length
    ? f.files.filter((x) => x.sloc > 500).length / f.files.length
    : 0;
  const deepShare = f.functions.length
    ? f.functions.filter((x) => x.maxDepth >= DEEP_NESTING).length / f.functions.length
    : 0;
  const longShare = f.functions.length
    ? f.functions.filter((x) => x.length > FUNCTION_LENGTH_SMELL).length / f.functions.length
    : 0;
  const rootDepth = maxOf(f.files.map(dirDepth));
  const structure = aggregate(
    {
      avgSloc: f.files.length ? rampDown(meanOf(f.files.map((x) => x.sloc)), 150, 500) : null,
      god: f.files.length ? 1 - rampUp(godShare, 0, 0.25) : null,
      deep: f.functions.length ? 1 - deepShare : null,
      long: f.functions.length ? 1 - longShare : null,
      depth: rampDown(rootDepth, 4, 10),
    },
    { avgSloc: 0.30, god: 0.25, deep: 0.20, long: 0.15, depth: 0.10 },
  );

  // Rampe posée sur le **corpus réel**, pas sur une intuition.
  //
  // La version précédente rendait 0 dès 15 % de fenêtres répétées. Sur cinq
  // paquets open source mûrs, le taux observé va de 2,4 % (PostCSS) à 24,5 %
  // (Ajv, qui *génère* du code : ses gabarits se ressemblent par
  // construction), avec une médiane autour de 7,7 %. À 15 %, le barème
  // condamnait donc Ajv à zéro et Zod à 22 % — deux projets sérieux traités
  // comme des copier-coller.
  //
  // 5 % est le seuil où la répétition cesse d'être du passe-partout, et
  // 30 % celui où elle devient une manière d'écrire. Entre les deux, la
  // note baisse progressivement : c'est une pente, pas un couperet.
  const duplication = 1 - rampUp(f.duplicateShare, 0.05, 0.3);

  const coupling = aggregate(
    {
      cycles: 1 - rampUp(f.coupling.cyclicFiles / Math.max(f.coupling.nodes, 1), 0, 0.2),
      instability: 1 - rampUp(f.coupling.maxInstability, 0.6, 1),
      avgInstability: 1 - rampUp(f.coupling.avgInstability, 0.3, 0.8),
      orphans: 1 - rampUp(f.coupling.orphans.length / Math.max(f.coupling.nodes, 1), 0, 0.3),
    },
    { cycles: 0.40, instability: 0.20, avgInstability: 0.20, orphans: 0.20 },
  );

  const testRatio = f.tests.sourceSloc > 0
    ? f.tests.testSloc / f.tests.sourceSloc
    : f.tests.testSloc > 0 ? 1 : 0;
  const tests = aggregate(
    {
      // Des fichiers de test sans assertion ne prouvent rien : on exige,
      // en plus du ratio, des assertions **par fichier de test**.
      ratio: rampUp(testRatio, 0, 0.25),
      assertions: f.tests.testFiles > 0
        ? rampUp(f.tests.assertions / f.tests.testFiles, 0, 3)
        : 0,
      script: f.tests.hasTestScript ? 1 : 0.4,
      ci: f.tests.ciRunsTests ? 1 : 0.4,
    },
    { ratio: 0.45, assertions: 0.30, script: 0.15, ci: 0.10 },
  );

  const api = f.documentation.apiTotal > 0
    ? f.documentation.apiDocumented / f.documentation.apiTotal
    : null;
  const readme = f.documentation.readmeSections
    ? 1
    : f.documentation.readmeWords >= 60
      ? 0.6
      : f.documentation.readmeWords > 0 ? 0.3 : 0;
  const documentation = aggregate(
    {
      api,
      readme,
      comments: meanOf(f.documentation.commentRatios.map(commentPlateau)),
    },
    { api: 0.45, readme: 0.25, comments: 0.30 },
  );

  return {
    complexity,
    structure,
    duplication,
    coupling,
    tests,
    documentation,
    security: clamp(f.security, 0, 1),
    repository: clamp(f.repository, 0, 1),
  };
}

/** Profondeur d'arborescence d'un fichier. */
function dirDepth(m: { path: string }): number {
  return Math.max(0, m.path.split("/").length - 1);
}
