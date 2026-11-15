/**
 * Mesures de qualité logicielle — les **faits** qui fondent le score.
 *
 * ## La couche des faits, et rien d'autre
 *
 * Ce module ne note pas : il **mesure**. La version précédente mélangeait
 * les trois couches — mesurer, calibrer, expliquer — dans les mêmes
 * fonctions, ce qui rendait impossible de dire d'où venait une note, et
 * facile de compter deux fois le même défaut. Ici :
 *
 * - `metrics.ts` (ce fichier) produit des **faits** vérifiables :
 *   complexité cyclomatique, complexité cognitive, Halstead, lignes,
 *   fonctions, duplication, graphe d'imports ;
 * - `dimensions.ts` transforme ces faits en **scores calibrés** ;
 * - `score.ts` agrège et **explique**.
 *
 * ## Les sources, nommées pour être vérifiées
 *
 * - **Halstead (1977)**, *Elements of Software Science* : le volume
 *   `V = N·log₂(n)` estime la taille informationnelle du programme.
 * - **McCabe (1976)**, *A Complexity Measure* : `G = 1 + décisions`, le
 *   nombre de chemins indépendants dans le graphe de flot.
 * - **SonarSource (2018)**, complexité *cognitive* : comme McCabe, mais en
 *   pénalisant l'imbrication **relative à la fonction**, en comptant un
 *   `switch` **une seule fois** quel que soit le nombre de `case`, en
 *   traitant `else` comme un incrément structurel **sans** incrément
 *   d'imbrication, et en ne comptant qu'une fois **une séquence
 *   d'opérateurs logiques de même nature**. Ce que le modèle ne peut pas
 *   voir — récursion, `break` étiqueté, résolution de symboles — est
 *   énuméré dans le commentaire de `cognitiveIn` plutôt que revendiqué
 *   comme conforme.
 * - **Oman & Hagemeister (1992)**, indice de maintenabilité, calculé
 *   **par fonction** puis moyenné (la version précédente le calculait sur
 *   les totaux du fichier, ce qui revenait à noter la taille, pas la
 *   maintenabilité).
 *
 * Toutes les mesures dérivent de `AnalysedSource` — donc du texte *sans*
 * commentaires ni chaînes. Le module est pur, sans réseau ni DOM.
 */

import { clamp, fnv1a } from "../mathx";
import type { AnalysedLine, AnalysedSource, LangFamily } from "./lex";
import { maxOf, meanOf, percentile, sortedCopy } from "./stats";

/* ------------------------------------------------------------------ */
/* Vocabulaire                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mots-clés par famille, et **pas un jeu global**.
 *
 * La version précédente en avait un seul : `count`, `index`, `key`,
 * `values` et `order` — des mots-clés SQL — disparaissaient du nommage
 * dans un fichier TypeScript, où ce sont des identifiants parfaitement
 * recevables. Un vocabulaire partagé entre langages ne peut que
 * surestimer ou sous-estimer l'un des deux.
 */
const C_KEYWORDS = [
  "if", "else", "for", "while", "do", "return", "switch", "case", "default",
  "break", "continue", "throw", "try", "catch", "finally", "new", "delete",
  "typeof", "instanceof", "in", "of", "await", "yield", "void", "with",
  "class", "extends", "implements", "interface", "function", "const", "let",
  "var", "import", "export", "from", "as", "static", "get", "set", "this",
  "super", "null", "undefined", "true", "false", "enum", "type", "namespace",
  "public", "private", "protected", "readonly", "abstract", "async", "declare",
  "struct", "impl", "fn", "mut", "pub", "use", "mod", "trait", "where",
  "match", "loop", "unsafe", "extern", "crate", "self", "Self", "func",
  "defer", "chan", "go", "range", "select", "package",
];

const HASH_KEYWORDS = [
  "def", "elif", "else", "if", "except", "finally", "raise", "pass",
  "lambda", "and", "or", "not", "is", "None", "True", "False", "global",
  "nonlocal", "del", "assert", "print", "import", "from", "as", "return",
  "for", "while", "break", "continue", "try", "with", "yield", "await",
  "async", "class", "end", "then", "begin", "unless", "until", "elsif",
  "require", "module", "nil", "puts", "attr_accessor", "attr_reader",
  "attr_writer", "defined", "self", "do", "then", "each", "in",
];

const SQL_KEYWORDS = [
  "select", "insert", "update", "delete", "into", "values", "set",
  "distinct", "union", "all", "having", "order", "by", "group", "limit",
  "offset", "join", "inner", "left", "right", "outer", "on", "create",
  "table", "drop", "alter", "index", "primary", "key", "foreign",
  "references", "not", "like", "between", "exists", "when", "null", "asc",
  "desc", "count", "using", "and", "or", "case", "then", "else", "end",
  "as", "from", "where", "is", "in", "with", "returning",
];

const KEYWORDS: Record<LangFamily, Set<string>> = {
  c: new Set(C_KEYWORDS),
  hash: new Set(HASH_KEYWORDS),
  sql: new Set(SQL_KEYWORDS.map((k) => k.toLowerCase())),
  html: new Set<string>(),
  text: new Set<string>(),
};

/** Le mot est-il un mot-clé du langage ? (SQL : insensible à la casse.) */
export function isKeyword(word: string, family: LangFamily): boolean {
  const set = KEYWORDS[family];
  return family === "sql" ? set.has(word.toLowerCase()) : set.has(word);
}

/**
 * Sous-ensemble des mots-clés qui **sont** des opérateurs : ceux qui
 * transforment le flot ou les données. `const` déclare, `if` décide ;
 * seul le second entre dans le volume de Halstead.
 */
const OP_KEYWORDS: Record<LangFamily, string[]> = {
  c: [
    "if", "else", "for", "while", "do", "return", "switch", "case",
    "break", "continue", "throw", "try", "catch", "finally", "new",
    "delete", "typeof", "instanceof", "in", "of", "await", "yield", "void",
  ],
  hash: [
    "if", "elif", "else", "for", "while", "return", "break", "continue",
    "raise", "try", "except", "finally", "yield", "await", "and", "or",
    "not", "is", "in", "lambda", "assert", "pass", "del", "with",
  ],
  sql: [
    "select", "from", "where", "join", "on", "having", "group", "order",
    "by", "insert", "into", "update", "set", "delete", "values", "union",
    "and", "or", "not", "like", "in", "is", "case", "when", "then", "else",
    "end", "distinct", "limit", "offset", "create", "table", "drop",
  ],
  html: [],
  text: [],
};

/** Opérateurs symboliques, du plus long au plus court (l'alternance s'y fie). */
const SYMBOLS = [
  "<<=", ">>=", ">>>", "===", "!==", "**=", "&&=", "||=", "??=", "...",
  "<<", ">>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "=>", "->",
  "::", "++", "--", "**", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "+", "-", "*", "/", "%", "=", "<", ">", "!", "&", "|", "^", "~", "?",
];

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SYMBOL_RX = new RegExp(SYMBOLS.map(escapeRx).join("|"), "g");

/**
 * Expressions régulières **compilées une fois**.
 *
 * Les compteurs de décisions et de charge cognitive en construisaient une
 * par mot-clé et par ligne : sur un dépôt de 50 000 lignes de code, cela
 * représentait des centaines de milliers de compilations pour des motifs
 * qui sont toujours les mêmes. Le cache les ramène à quelques dizaines, et
 * la mesure y gagne un facteur visible sur un dépôt réel.
 */
const RX_CACHE = new Map<string, RegExp>();

function cachedRx(pattern: string, flags: string): RegExp {
  const key = `${flags}\u0000${pattern}`;
  let rx = RX_CACHE.get(key);
  if (!rx) {
    rx = new RegExp(pattern, flags);
    RX_CACHE.set(key, rx);
  }
  // `matchAll` partage l'instance : un `lastIndex` non nul fausserait le
  // prochain appel. On le remet à zéro à chaque emprunt.
  rx.lastIndex = 0;
  return rx;
}

/**
 * Identifiants **Unicode**. `[A-Za-z_]` coupait `arithmétique` en deux
 * identifiants — `arithm` et `tique` — dans un projet francophone, ce qui
 * faussait à la fois le nommage et le volume de Halstead.
 */
const IDENT_RX = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
const NUMBER_RX = /\b\d[\w.]*/g;

/** Mots-clés de décision, par famille — la base de McCabe. */
const DECISION_KEYWORDS: Record<LangFamily, string[]> = {
  c: ["if", "for", "while", "case", "catch"],
  hash: ["if", "elif", "for", "while", "except"],
  sql: ["join", "when", "union", "where"],
  html: [],
  text: [],
};

/**
 * Mots-clés qui ouvrent une structure **imbriquante** au sens de Sonar.
 *
 * Deux absences délibérées :
 *
 * - `case` — un `switch` à cinq cas coûte **1**, pas 15. Le `switch` paie
 *   une fois, les `case` ne paient rien ; les compter faisait d'une table
 *   de correspondance la pire fonction du fichier ;
 * - `elif` / `else if` — ils paient +1 **sans** incrément d'imbrication,
 *   comme un `else`. Les compter ici les faisait payer deux fois.
 */
const COGNITIVE_KEYWORDS: Record<LangFamily, string[]> = {
  c: ["if", "for", "while", "catch"],
  hash: ["if", "for", "while", "except"],
  sql: ["join", "when", "union", "where"],
  html: [],
  text: [],
};

/** Familles où `switch` existe et doit être compté **une seule fois**. */
const SWITCH_FAMILY: Record<LangFamily, boolean> = {
  c: true, hash: false, sql: false, html: false, text: false,
};

/** Opérateurs logiques symboliques (famille C). */
const LOGICAL_RX = /&&|\|\||\?\?/g;
/** Opérateurs logiques en mots (`and`, `or`). */
const LOGICAL_WORD_RX = /\b(and|or)\b/g;

/** Expression régulière d'un mot-clé pour une famille donnée. */
function keywordRx(word: string, family: LangFamily, global = true): RegExp {
  return cachedRx(
    `\\b${escapeRx(word)}\\b`,
    (global ? "g" : "") + (family === "sql" ? "i" : ""),
  );
}

/** Occurrences d'un mot-clé dans une ligne masquée. */
function countKeyword(line: string, word: string, family: LangFamily): number {
  return [...line.matchAll(keywordRx(word, family))].length;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Halstead {
  /** Opérateurs distincts. */
  n1: number;
  /** Occurrences d'opérateurs. */
  N1: number;
  /** Opérandes distincts. */
  n2: number;
  /** Occurrences d'opérandes. */
  N2: number;
  /** Vocabulaire `n = n1 + n2`. */
  vocabulary: number;
  /** Longueur `N = N1 + N2`. */
  length: number;
  /** Volume `V = N·log₂(n)`. */
  volume: number;
  /** Difficulté `D = (n1/2)·(N2/n2)`. */
  difficulty: number;
  /** Effort `E = D·V`. */
  effort: number;
  /** Temps de codage estimé `T = E/18`, en secondes. */
  timeSeconds: number;
  /** Bugs livrés estimés `B = V/3000`. */
  bugs: number;
}

export interface FunctionMetric {
  name: string;
  /** Ligne 1-based du `def` / de la déclaration. */
  line: number;
  /** Ligne 1-based de la fin du corps, incluse. */
  endLine: number;
  /** Nombre de lignes du corps, signature comprise. */
  length: number;
  /** Lignes de code (hors blancs et commentaires) du corps. */
  sloc: number;
  /** Lignes de commentaire et de docstring du corps. */
  commentLines: number;
  params: number;
  /** Complexité de McCabe de cette fonction. */
  cyclomatic: number;
  /** Complexité cognitive de cette fonction, imbrication relative. */
  cognitive: number;
  /** Imbrication maximale **relative** au corps de la fonction. */
  maxDepth: number;
  /** Index 0-based de la ligne où s'ouvre le corps (le `{`, ou le `def`). */
  bodyLine: number;
  /** Indice de maintenabilité de la fonction, 0…100. */
  maintainability: number;
  halstead: Halstead;
  /** Un commentaire (JSDoc, docstring) précède immédiatement la fonction. */
  documented: boolean;
  /** La fonction fait partie de la surface publique du module. */
  exported: boolean;
  /** `name` est un rappel de test (`test`, `it`, `describe`…). */
  isTestCallback: boolean;
}

/** Distribution d'une mesure sur les fonctions d'un fichier. */
export interface Distribution {
  count: number;
  mean: number;
  /** 90ᵉ centile — le pire cas courant, plus honnête que la moyenne. */
  p90: number;
  max: number;
  /** Part des fonctions au-delà du seuil rouge. */
  redShare: number;
}

export interface NamingStats {
  total: number;
  distinct: number;
  /** Identifiants d'une seule lettre hors `i/j/k/n/x/y/z`. */
  poor: number;
  /** Longueur moyenne des identifiants distincts. */
  avgLength: number;
  /** Part des identifiants distincts qui sont des « mots » (≥ 4 lettres). */
  descriptiveRatio: number;
}

export interface FileMetrics {
  path: string;
  family: LangFamily;
  confidence: "lexer" | "heuristic";
  /** Le fichier a dépassé un plafond d'analyse. */
  truncated: boolean;
  /** Le fichier est un test (assertions, pas de pénalité de qualité). */
  isTest: boolean;
  /** Lignes totales. */
  lines: number;
  /** Lignes de code. */
  sloc: number;
  /** Lignes de commentaire pur, docstrings comprises. */
  comments: number;
  /** Lignes vides. */
  blanks: number;
  /** Lignes de code portant aussi un commentaire en fin de ligne. */
  inlineComments: number;
  /** Part de lignes commentées `(comments + inlineComments) / lines`. */
  commentRatio: number;
  halstead: Halstead;
  /** McCabe au niveau fichier `1 + Σ décisions`. Diagnostic, pas dimension. */
  cyclomatic: number;
  /** Part des lignes de code qui portent une décision. */
  decisionDensity: number;
  /** Complexité cognitive du fichier, imbrication relative par fonction. */
  cognitive: number;
  maxDepth: number;
  avgDepth: number;
  functions: FunctionMetric[];
  /** Distribution de la complexité cyclomatique par fonction. */
  cyclomaticDistribution: Distribution;
  /** Distribution de la complexité cognitive par fonction. */
  cognitiveDistribution: Distribution;
  /** Distribution de la taille des fonctions, en lignes. */
  lengthDistribution: Distribution;
  avgFunctionLength: number;
  maxFunctionLength: number;
  /** Fonctions au-delà de `FUNCTION_LENGTH_SMELL` lignes. */
  longFunctions: number;
  avgParamsPerFunction: number;
  /**
   * Indice de maintenabilité de Oman, **moyenné sur les fonctions**.
   * `null` quand aucune fonction n'est détectée : il n'y a alors rien à
   * mesurer, et une valeur de repli ferait croire à une mesure.
   */
  maintainability: number | null;
  naming: NamingStats;
  /** Déclarations d'import / require / use. */
  imports: number;
  todos: number;
  trailingWhitespace: number;
  longLines: number;
  maxLineLength: number;
  avgLineLength: number;
  /** Nombres « magiques » : littéraux hors 0, 1, puissances de dix, hors constantes nommées. */
  magicNumbers: number;
  /** Lignes de code prises dans une fenêtre de 4 lignes dupliquée (voir `windowHashes`). */
  duplicateLines: number;
  /**
   * Empreintes des fenêtres de 4 lignes consécutives (normalisées).
   * Permet la duplication **inter-fichiers** sans conserver le texte : une
   * empreinte suffit à dire « cette suite de quatre lignes existe
   * ailleurs ».
   */
  windowHashes: number[];
  /** Le fichier mélange tabulations et espaces **en tête de code**. */
  mixedIndent: boolean;
  /** Le fichier commence par un commentaire. */
  hasHeaderComment: boolean;
  /** Surface publique : fonctions exportées, et combien sont documentées. */
  api: { total: number; documented: number };
  /** Assertions détectées (`expect`, `assert`, `should`…) — dimension tests. */
  assertions: number;
}

/* ------------------------------------------------------------------ */
/* Halstead                                                            */
/* ------------------------------------------------------------------ */

/**
 * Halstead : opérateurs = symboles + mots-clés de flot ; opérandes =
 * identifiants (hors mots-clés **du langage**), nombres et chaînes.
 *
 * Le choix d'exclure les parenthèses et les accolades est délibéré : les
 * compter gonflerait le volume d'un fichier bien parenthésé par rapport au
 * même fichier mal indenté, ce qui n'a aucun sens. Halstead, dans sa
 * définition d'origine, parlait d'opérateurs de langage — pas de
 * ponctuation de groupement.
 */
export function halstead(src: AnalysedSource): Halstead {
  return halsteadOf(src.masked, src.literals, src.family);
}

/** Halstead d'un fragment de texte déjà masqué, pour une fonction. */
export function halsteadOf(masked: string, literals: string[], family: LangFamily): Halstead {
  const operators = [
    ...[...masked.matchAll(SYMBOL_RX)].map((m) => m[0]),
    ...[...masked.matchAll(cachedRx(
      `\\b(?:${OP_KEYWORDS[family].map(escapeRx).join("|")})\\b`,
      family === "sql" ? "gi" : "g",
    ))].map((m) => (family === "sql" ? m[0].toLowerCase() : m[0])),
  ];
  const n1 = new Set(operators).size;
  const N1 = operators.length;

  const identifiers = [...masked.matchAll(cachedRx(IDENT_RX.source, "gu"))]
    .map((m) => m[0])
    .filter((w) => !isKeyword(w, family));
  const numbers = [...masked.matchAll(NUMBER_RX)].map((m) => m[0]);
  const operands = [...identifiers, ...numbers, ...literals.map((s) => `"${s}"`)];

  const n2 = new Set(operands).size;
  const N2 = operands.length;
  const vocabulary = n1 + n2;
  const length = N1 + N2;
  const volume = vocabulary > 1 ? length * Math.log2(vocabulary) : 0;
  const difficulty = n2 > 0 ? (n1 / 2) * (N2 / n2) : 0;
  const effort = difficulty * volume;

  return {
    n1, N1, n2, N2, vocabulary, length, volume, difficulty, effort,
    timeSeconds: effort / 18,
    bugs: volume / 3000,
  };
}

/* ------------------------------------------------------------------ */
/* Décisions et complexités                                            */
/* ------------------------------------------------------------------ */

/**
 * État reporté d'une ligne à l'autre.
 *
 * Un ternaire peut s'étaler sur plusieurs lignes — c'est même ce que fait
 * Prettier dès que la ligne dépasse. La version précédente cherchait `?`
 * et `:` **sur la même ligne** et renvoyait 0 dans ce cas : une décision
 * réelle, invisible. On garde donc en attente un `?` qui n'a pas encore
 * vu son `:`.
 */
export interface DecisionState {
  pendingTernary: boolean;
}

/** Un nouveau état d'analyse, pour une ligne isolée ou un fichier entier. */
export function newDecisionState(): DecisionState {
  return { pendingTernary: false };
}

/** Positions d'un `?` qui ouvre un ternaire : ni `??`, ni `?.`, ni `?:`. */
function ternaryMarks(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "?") continue;
    const d = line[i + 1];
    if (d === "?" || d === "." || d === ":") {
      // `??` se consomme en entier : sans cela, le **second** `?` de
      // `a ?? b` passait pour un ternaire, et une coalescence nulle
      // comptait double.
      i++;
      continue;
    }
    n++;
  }
  return n;
}

/** Nombre de décisions d'une ligne masquée (une décision = une arête de plus). */
export function decisionsIn(
  line: string,
  family: LangFamily,
  state: DecisionState = newDecisionState(),
): number {
  let count = 0;

  for (const kw of DECISION_KEYWORDS[family]) count += countKeyword(line, kw, family);

  count += [...line.matchAll(cachedRx(LOGICAL_RX.source, "g"))].length;
  if (family === "hash" || family === "sql") {
    count += [...line.matchAll(cachedRx(
      LOGICAL_WORD_RX.source,
      family === "sql" ? "gi" : "g",
    ))].length;
  }

  const marks = ternaryMarks(line);
  if (marks > 0) {
    count += marks;
    // Sans `:` sur la ligne, le ternaire se poursuit à la suivante.
    state.pendingTernary = !line.includes(":");
  } else if (state.pendingTernary && line.includes(":")) {
    state.pendingTernary = false;
  }

  return count;
}

/**
 * Nombre de **séquences** d'opérateurs logiques de même nature.
 *
 * Sonar n'incrémente pas par opérateur mais par *séquence* : `a && b && c`
 * coûte 1, `a && b || c` coûte 2. La version précédente comptait chaque
 * occurrence, ce qui faisait d'une garde de trois conditions une faute
 * trois fois plus lourde qu'elle ne l'est.
 */
function logicalSequences(line: string, family: LangFamily): number {
  const hits: { at: number; kind: string }[] = [];
  if (family === "c") {
    for (const m of line.matchAll(cachedRx(LOGICAL_RX.source, "g"))) {
      hits.push({ at: m.index ?? 0, kind: m[0] });
    }
  }
  if (family === "hash" || family === "sql") {
    for (const m of line.matchAll(cachedRx(
      LOGICAL_WORD_RX.source,
      family === "sql" ? "gi" : "g",
    ))) {
      hits.push({ at: m.index ?? 0, kind: m[0].toLowerCase() });
    }
  }
  if (!hits.length) return 0;

  hits.sort((a, b) => a.at - b.at);
  let sequences = 1;
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].kind !== hits[i - 1].kind) sequences++;
  }
  return sequences;
}

/**
 * Complexité **cognitive** d'une ligne, fidèle à la spécification
 * SonarSource pour tout ce qu'un tokeniseur peut observer.
 *
 * Modèle appliqué :
 *
 * | structure | coût |
 * |---|---|
 * | `if`, boucle, `catch`, `switch`, ternaire | `1 + imbrication` |
 * | `else`, `else if` | `+1`, **sans** incrément d'imbrication |
 * | `case`, `default` | 0 (le `switch` a déjà payé) |
 * | séquence d'opérateurs logiques | `+1` par séquence de même nature |
 *
 * `imbrication` est la profondeur **relative au corps de la fonction** —
 * pas la profondeur absolue dans le fichier. C'est la correction
 * centrale : un `if` au premier niveau d'une méthode de classe est à la
 * profondeur 2 dans le fichier, mais à la profondeur 0 dans sa fonction,
 * et ne doit donc coûter que 1. Le paramètre est ici la valeur relative,
 * calculée par `extractMetrics` ; le nom reste `nesting` pour que
 * l'appelant ne puisse pas passer une profondeur absolue par mégarde.
 *
 * Non modélisé, faute de résolution de symboles — et dit plutôt que
 * revendiqué : la récursion, les `break`/`continue` étiquetés, et la
 * pénalité des opérateurs logiques « mixtes » au-delà de la séquence.
 */
export function cognitiveIn(line: string, family: LangFamily, nesting: number): number {
  const n = Math.max(0, nesting);
  let cost = 0;

  // `else if` / `elif` : +1 comme un `else`, sans imbrication. On retire le
  // `if` qu'il contient pour ne pas le payer une seconde fois.
  const elseIf = countElseIf(line, family);
  cost += elseIf;

  for (const kw of COGNITIVE_KEYWORDS[family]) {
    let occurrences = countKeyword(line, kw, family);
    if (kw === "if" && family === "c") occurrences = Math.max(0, occurrences - elseIf);
    cost += occurrences * (1 + n);
  }

  // `else` seul (un `else if` est déjà compté ci-dessus).
  if (family === "c" || family === "hash") {
    const elseWord = countKeyword(line, "else", family);
    cost += Math.max(0, elseWord - elseIf);
  }

  // `switch` : un seul incrément, quels que soient les `case`.
  if (SWITCH_FAMILY[family]) cost += countKeyword(line, "switch", family) * (1 + n);

  cost += ternaryMarks(line) * (1 + n);
  cost += logicalSequences(line, family);

  return cost;
}

/** Occurrences de `else if` / `elif`, qui comptent comme un `else` non imbriqué. */
function countElseIf(line: string, family: LangFamily): number {
  if (family === "hash") return countKeyword(line, "elif", family);
  if (family !== "c") return 0;
  return [...line.matchAll(/\belse\s+if\b/g)].length;
}

/* ------------------------------------------------------------------ */
/* Seuils                                                              */
/* ------------------------------------------------------------------ */

/** Longueur (en lignes) au-delà de laquelle une fonction est suspecte. */
export const FUNCTION_LENGTH_SMELL = 40;
/** Taille (en lignes de code) au-delà de laquelle un fichier est un « fichier dieu ». */
export const FILE_LENGTH_SMELL = 500;
/** Profondeur d'imbrication relative au-delà de laquelle le code est illisible. */
export const DEEP_NESTING = 4;
/** Au-delà de cette longueur, une ligne est difficile à lire d'un regard. */
export const LONG_LINE = 100;
/** Complexité cyclomatique par fonction : seuils Sonar par défaut. */
export const CC_WARN = 10;
export const CC_RED = 20;
/** Complexité cognitive par fonction : seuil Sonar par défaut. */
export const COGNITIVE_WARN = 15;
export const COGNITIVE_RED = 25;

/** Marqueurs de dette technique — **une seule** expression régulière. */
export const MARKER_RX = /\b(TODO|FIXME|XXX|HACK|BUG|WIP)\b/;

/* ------------------------------------------------------------------ */
/* Distribution d'une mesure                                           */
/* ------------------------------------------------------------------ */

/** Distribution d'une mesure sur un ensemble de valeurs. */
export function distribution(values: number[], red: number): Distribution {
  // L'ensemble vide se juge **après** filtrage : sur `[NaN]`, l'ancienne
  // version passait le garde, puis divisait par zéro pour la part de
  // rouges — un `NaN` qui remontait jusqu'à l'écran.
  const sorted = sortedCopy(values);
  if (!sorted.length) return { count: 0, mean: 0, p90: 0, max: 0, redShare: 0 };
  return {
    count: sorted.length,
    mean: meanOf(sorted),
    p90: percentile(sorted, 0.9),
    // `reduce` et non `Math.max(...valeurs)` : l'étalement d'un tableau de
    // 150 000 éléments dans une liste d'arguments fait planter le moteur
    // (`RangeError: Maximum call stack size exceeded`) sur un fichier
    // volumineux — exactement le fichier qu'on veut pouvoir noter.
    max: maxOf(sorted),
    redShare: sorted.filter((v) => v > red).length / sorted.length,
  };
}

/* ------------------------------------------------------------------ */
/* Fonctions                                                           */
/* ------------------------------------------------------------------ */

/** Un nom de fonction plausible (on écarte les mots-clés de contrôle). */
const NOT_A_CALL = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "new",
  "delete", "await", "yield", "function", "else", "do", "in", "of", "case",
  "const", "let", "var", "class", "elseif", "unless", "until", "def",
]);

const PY_FUNC = /^\s*(?:async\s+)?def\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(/u;
const C_FUNCTION = /\bfunction\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*\(/u;
const C_ARROW =
  /(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*(?::[^=]*?)?=\s*(?:async\s*)?(\([^)]*\)|[\p{L}_$][\p{L}\p{N}_$]*)\s*(?::[^=;]*?)?=>/u;
const C_FUNC_EXPR =
  /(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*(?::[^=]*?)?=\s*(?:async\s+)?function\s*\(/u;
const C_METHOD =
  /^\s*(?:public|private|protected|static|async|readonly|abstract|override|\*|\s)*([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:<[^>]*>)?\s*\(([^;{}]*)\)\s*(?::\s*(?:\{[^{}]*\}|[^{;]+))?\s*\{/u;

/**
 * Nombre de lignes au-delà desquelles on n'espère plus une signature.
 * Prettier casse rarement une signature en plus de six lignes ; au-delà,
 * c'est du code, et continuer reviendrait à joindre le fichier entier.
 */
const MAX_SIGNATURE_LINES = 10;

interface Signature {
  text: string;
  /** Ligne d'origine de la signature. */
  line: number;
  /** Dernière ligne consommée par la signature. */
  last: number;
}

interface Span {
  name: string;
  line: number;
  endLine: number;
  params: number;
  /** Index (0-based) de la ligne où s'ouvre le corps. */
  bodyLine: number;
  /** Colonne du `{` d'ouverture, ou -1 si le corps n'a pas d'accolade. */
  bodyCol: number;
  /** La déclaration porte `export` / `public`. */
  exported: boolean;
}

/** Parenthèses et crochets équilibrés (les accolades du corps ne comptent pas). */
function parensBalanced(text: string): boolean {
  let p = 0;
  let b = 0;
  for (const ch of text) {
    if (ch === "(") p++;
    else if (ch === ")") p--;
    else if (ch === "[") b++;
    else if (ch === "]") b--;
  }
  return p <= 0 && b <= 0;
}

/** La signature est-elle complète, c'est-à-dire prête à recevoir un corps ? */
function signatureComplete(text: string, family: LangFamily): boolean {
  const t = text.trimEnd();
  if (!parensBalanced(t)) return false;
  if (family === "hash") return t.endsWith(":");
  return t.endsWith("{") || t.endsWith(";") || t.endsWith("=>") || t.endsWith("}");
}

/**
 * Lit la signature d'une fonction à partir de la ligne `i`, en rejoignant
 * les lignes suivantes tant que les parenthèses ne sont pas refermées.
 *
 * C'est la correction du premier bug de détection : une signature coupée
 * sur plusieurs lignes — le style qu'impose Prettier dès qu'elle
 * dépasse — n'était pas vue du tout, parce que la version précédente
 * examinait chaque ligne **isolément**.
 */
function readSignature(lines: AnalysedLine[], i: number, family: LangFamily): Signature {
  const parts: string[] = [];
  let last = i;
  for (let k = i; k < lines.length && k - i < MAX_SIGNATURE_LINES; k++) {
    if (lines[k].kind !== "code") break;
    parts.push(lines[k].masked);
    last = k;
    if (signatureComplete(parts.join(" "), family)) break;
  }
  return { text: parts.join(" "), line: i, last };
}

/**
 * Nombre de paramètres d'une liste.
 *
 * Deux corrections par rapport à la version précédente :
 *
 * - les accolades comptent dans la profondeur, donc `{ a, b, c }` vaut
 *   **un** paramètre (un objet déstructuré), et non trois ;
 * - on compte les segments **non vides**, donc `(a, b,)` — la virgule
 *   finale que Prettier écrit en multi-ligne — vaut 2, pas 3.
 */
export function countParams(raw: string): number {
  const t = raw.trim().replace(/^\(/, "").replace(/\)$/, "");
  if (!t) return 0;

  let depth = 0;
  let params = 0;
  let segment = "";
  const flush = () => {
    if (segment.trim()) params++;
    segment = "";
  };

  for (const ch of t) {
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      segment += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
      segment += ch;
    } else if (ch === "," && depth === 0) {
      flush();
    } else {
      segment += ch;
    }
  }
  flush();
  return params;
}

/** Position (ligne, colonne) d'un décalage dans le texte joint d'une signature. */
function positionIn(sig: Signature, lines: AnalysedLine[], offset: number): { line: number; col: number } {
  let remaining = offset;
  for (let i = sig.line; i <= sig.last; i++) {
    const len = lines[i].masked.length;
    if (remaining < len) return { line: i, col: remaining };
    remaining -= len + 1; // +1 pour l'espace de jointure
  }
  return { line: sig.last, col: 0 };
}

/** Index de la parenthèse qui referme celle ouverte à `open`. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Index et colonne du `{` qui ouvre le **corps**, ou -1.
 *
 * On part de la parenthèse fermante de la liste de paramètres et on prend
 * le premier `{` **après** elle : celui du corps. Chercher naïvement la
 * dernière accolade de la signature se trompait sur un corps d'une seule
 * ligne (`function f() { … }`), et compter depuis le début de la ligne
 * faisait passer une déstructuration de paramètres (`{ a, b }`) pour
 * l'ouverture du corps — qui se serait alors refermé sur sa propre
 * signature, et la fonction aurait « contenu » tout ce qui suit.
 */
function bodyBrace(sig: Signature, lines: AnalysedLine[]): { line: number; col: number } {
  const openParen = sig.text.indexOf("(");
  if (openParen >= 0) {
    const close = matchingParen(sig.text, openParen);
    if (close >= 0) {
      const brace = sig.text.indexOf("{", close);
      if (brace >= 0) return positionIn(sig, lines, brace);
    }
  }
  const firstBrace = sig.text.indexOf("{");
  if (firstBrace >= 0) return positionIn(sig, lines, firstBrace);

  // `=>` en fin de signature : le corps commence à la ligne suivante.
  const next = sig.last + 1;
  if (next < lines.length) {
    const col = lines[next].masked.indexOf("{");
    if (col >= 0) return { line: next, col };
  }
  return { line: -1, col: -1 };
}

/**
 * Appariement des accolades du corps, **à partir** de la ligne et de la
 * colonne d'ouverture. Compter depuis le début de la ligne ferait passer
 * les accolades d'une déstructuration de paramètres (`{ a, b }`) pour
 * l'ouverture et la fermeture du corps — le corps se terminerait alors sur
 * sa propre signature.
 */
function matchBraces(lines: AnalysedLine[], startLine: number, startCol: number): number {
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    const m = lines[i].masked;
    const from = i === startLine ? Math.max(0, startCol) : 0;
    for (let k = from; k < m.length; k++) {
      if (m[k] === "{") depth++;
      else if (m[k] === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}

/** Intervalle de lignes occupé par une fonction. */
function spanRange(s: Span): { from: number; to: number } {
  return { from: s.line, to: s.endLine };
}

/**
 * Imbrication de chaque ligne, **relative à sa fonction**.
 *
 * Le corps d'une fonction commence à la profondeur zéro : c'est ce que
 * mesure Sonar, et ce qui rend un `if` en tête de méthode égal à un `if`
 * en tête de fonction. Une ligne hors de toute fonction garde la
 * profondeur du module (0 à la racine).
 *
 * Les fonctions imbriquées ont une base plus grande que leur enveloppe,
 * donc prendre le maximum donne la fonction la plus intérieure — celle à
 * laquelle la ligne appartient vraiment.
 */
function relativeNesting(
  lines: readonly AnalysedLine[],
  functions: readonly FunctionMetric[],
): number[] {
  const base = new Array<number>(lines.length).fill(0);
  for (const f of functions) {
    const b = (lines[f.bodyLine]?.depth ?? 0) + 1;
    for (let k = f.line - 1; k <= f.endLine - 1 && k < lines.length; k++) {
      if (k >= 0 && b > base[k]) base[k] = b;
    }
  }
  return lines.map((l, i) => Math.max(0, l.depth - base[i]));
}

/**
 * Trouve les fonctions d'un fichier, avec l'étendue de leur corps.
 *
 * Formes reconnues : `function f(...)`, `const f = (...) =>`, `const f =
 * (…): T =>`, une méthode de classe ou d'objet littéral `f(…) {`, et
 * `def f(...)` en Python. Le corps est apparié par accolades (famille C)
 * ou par indentation (Python). Une fonction imbriquée est une fonction à
 * part entière : elle est détectée, et ses lignes sont **retirées** du
 * calcul de sa fonction hôte (la complexité appartient au code qui la
 * contient, pas à son enveloppe).
 */
export function findFunctions(src: AnalysedSource): FunctionMetric[] {
  const { lines, family } = src;

  if (family === "hash") {
    const spans: Span[] = [];
    for (const l of lines) {
      if (l.kind !== "code") continue;
      const m = PY_FUNC.exec(l.masked);
      if (!m) continue;
      const sig = readSignature(lines, l.index, family);
      const raw = sig.text.slice(sig.text.indexOf("(") + 1);
      const base = l.indent;
      let end = l.index;
      for (let k = l.index + 1; k < lines.length; k++) {
        const nxt = lines[k];
        if (nxt.kind !== "code") { end = k; continue; }
        if (nxt.indent <= base) break;
        end = k;
      }
      spans.push({
        name: m[1],
        line: l.index,
        endLine: end,
        params: countParams(trimToClosingParen(raw)),
        bodyLine: l.index,
        bodyCol: -1,
        exported: !m[1].startsWith("_"),
      });
    }
    return spans.map((s) => toFunctionMetric(src, s, spans));
  }

  if (family !== "c") return [];

  const raw: Span[] = [];
  for (const l of lines) {
    if (l.kind !== "code") continue;
    const sig = readSignature(lines, l.index, family);

    let name: string | null = null;
    let params = "";

    const f = C_FUNCTION.exec(sig.text);
    if (f && !NOT_A_CALL.has(f[1])) { name = f[1]; params = parensFrom(sig.text, sig.text.indexOf("(", f.index ?? 0)); }

    if (!name) {
      const a = C_ARROW.exec(sig.text);
      if (a && !NOT_A_CALL.has(a[1])) {
        name = a[1];
        params = a[2].startsWith("(") ? trimToClosingParen(a[2].slice(1)) : a[2];
      }
    }

    if (!name) {
      const e = C_FUNC_EXPR.exec(sig.text);
      if (e && !NOT_A_CALL.has(e[1])) {
        name = e[1];
        params = parensFrom(sig.text, sig.text.indexOf("(", e.index ?? 0));
      }
    }

    if (!name) {
      const m = C_METHOD.exec(sig.text);
      if (m && !NOT_A_CALL.has(m[1]) && !isKeyword(m[1], family)) { name = m[1]; params = m[2]; }
    }

    if (!name) continue;

    const brace = bodyBrace(sig, lines);
    const endLine = brace.line >= 0
      ? matchBraces(lines, brace.line, brace.col)
      : sig.last;

    raw.push({
      name,
      line: l.index,
      endLine: Math.max(endLine, sig.last),
      params: countParams(params),
      bodyLine: brace.line >= 0 ? brace.line : sig.last,
      bodyCol: brace.col,
      exported: /\bexport\b/.test(lines[l.index].masked) ||
        /\bpublic\b/.test(lines[l.index].masked),
    });
  }

  return raw.map((s) => toFunctionMetric(src, s, raw));
}

/** Contenu de la parenthèse ouverte à `open`, jusqu'à sa fermeture. */
function parensFrom(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/** Tronque à la parenthèse fermante de même niveau. */
function trimToClosingParen(text: string): string {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      if (depth === 0) return text.slice(0, i);
      depth--;
    }
  }
  return text;
}

/** Transforme un intervalle de lignes en mesures de fonction. */
function toFunctionMetric(src: AnalysedSource, s: Span, all: Span[]): FunctionMetric {
  const { lines, family } = src;
  const { from, to } = spanRange(s);

  // Lignes des fonctions strictement imbriquées : elles appartiennent à
  // l'intérieure, pas à l'enveloppe.
  const nested = all.filter(
    (o) => o !== s && o.line >= from && o.line <= to && o.endLine <= to,
  );
  const isNested = (i: number) =>
    nested.some((o) => i >= o.line && i <= o.endLine);

  const slice = lines.slice(from, to + 1);
  const owned = slice.filter((l) => !isNested(l.index));

  const body = owned.filter((l) => l.kind === "code");
  const commentLines = owned.filter((l) => l.kind === "comment").length;

  // L'imbrication est mesurée **relativement au corps de la fonction** :
  // la profondeur du corps au premier niveau vaut zéro. C'est ce qui fait
  // qu'un `if` en tête de méthode de classe coûte 1, et non 3.
  const baseline = (lines[s.bodyLine]?.depth ?? 0) + 1;

  let decisions = 0;
  let cognitive = 0;
  let maxDepth = 0;
  const state = newDecisionState();
  const maskedParts: string[] = [];

  for (const l of owned) {
    if (isNested(l.index)) continue;
    decisions += decisionsIn(l.masked, family, state);
    if (l.kind !== "code") continue;
    const nesting = Math.max(0, l.depth - baseline);
    cognitive += cognitiveIn(l.masked, family, nesting);
    maxDepth = Math.max(maxDepth, nesting);
    maskedParts.push(l.masked);
  }

  const sloc = body.length;
  const cyclomatic = 1 + decisions;
  // Les chaînes littérales restent masquées au niveau de la fonction : leur
  // contribution au volume est marginale devant les identifiants et les
  // opérateurs, et les attribuer toutes à chaque fonction serait pire.
  const h = halsteadOf(maskedParts.join("\n"), [], family);

  return {
    name: s.name,
    line: from + 1,
    endLine: to + 1,
    length: slice.length,
    sloc,
    commentLines,
    params: s.params,
    cyclomatic,
    cognitive,
    maxDepth,
    bodyLine: s.bodyLine,
    maintainability: maintainabilityIndex(h.volume, cyclomatic, sloc),
    halstead: h,
    documented: isDocumented(src, s),
    exported: s.exported,
    isTestCallback: TEST_CALLBACK.has(s.name),
  };
}

/** Rappels des cadriciels de test : ce ne sont pas des fonctions de production. */
const TEST_CALLBACK = new Set([
  "test", "it", "describe", "beforeEach", "afterEach", "beforeAll",
  "afterAll", "setup", "teardown", "suite",
]);

/**
 * La fonction est-elle documentée ?
 *
 * Deux conventions, deux endroits : en famille C le commentaire précède la
 * déclaration (JSDoc) ; en Python la docstring est la **première
 * instruction du corps**. La version précédente ne connaissait que la
 * première et comptait donc tout Python documenté comme non documenté.
 */
function isDocumented(src: AnalysedSource, s: Span): boolean {
  const { lines, family } = src;

  if (family === "hash") {
    for (let k = s.line + 1; k <= Math.min(s.line + 2, lines.length - 1); k++) {
      if (lines[k].inString) return true;
    }
  }

  let skipped = 0;
  for (let k = s.line - 1; k >= 0; k--) {
    if (lines[k].kind === "blank") {
      if (++skipped > 1) break;
      continue;
    }
    return lines[k].kind === "comment";
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Extraction complète                                                 */
/* ------------------------------------------------------------------ */

export interface ExtractOptions {
  /** Le fichier est un test : les littéraux d'assertion ne sont pas des nombres magiques. */
  isTest?: boolean;
}

export function extractMetrics(src: AnalysedSource, opts: ExtractOptions = {}): FileMetrics {
  const { lines, family, masked } = src;
  const isTest = !!opts.isTest;

  const codeLines = lines.filter((l) => l.kind === "code");
  const sloc = codeLines.length;
  const comments = lines.filter((l) => l.kind === "comment").length;
  const blanks = lines.filter((l) => l.kind === "blank").length;
  const inlineComments = lines.filter((l) => l.kind === "code" && l.hasComment).length;

  const h = halstead(src);

  const decisionsState = newDecisionState();
  const decisionsPerLine = lines.map((l) => decisionsIn(l.masked, family, decisionsState));
  const cyclomatic = 1 + decisionsPerLine.reduce((a, b) => a + b, 0);

  // Le fichier n'a pas d'imbrication « absolue » unique : la nuance par
  // fonction vit dans `FunctionMetric`. On garde ici la somme pour
  // l'affichage, calculée comme la somme des fonctions — plus jamais comme
  // une profondeur absolue appliquée à des seuils par fonction.
  const functions = findFunctions(src);

  // La charge cognitive du fichier se mesure **ligne à ligne**, avec
  // l'imbrication relative à la fonction englobante — et 0 pour le code au
  // niveau du module. La version précédente appliquait la profondeur
  // absolue du fichier : un `if` au premier niveau d'une méthode de classe
  // coûtait 3, et un script Python sans fonction ne coûtait rien du tout.
  const nesting = relativeNesting(lines, functions);
  const cognitive = lines.reduce(
    (a, l, i) => a + (l.kind === "code" ? cognitiveIn(l.masked, family, nesting[i]) : 0),
    0,
  );

  const depths = codeLines.map((l) => l.depth);
  const maxDepth = maxOf(depths);
  const avgDepth = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;

  const cyclomaticDistribution = distribution(functions.map((f) => f.cyclomatic), CC_RED);
  const cognitiveDistribution = distribution(functions.map((f) => f.cognitive), COGNITIVE_RED);
  const lengthDistribution = distribution(functions.map((f) => f.length), FUNCTION_LENGTH_SMELL);

  const lengths = functions.map((f) => f.length);
  const avgFunctionLength = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const maxFunctionLength = maxOf(lengths);
  const longFunctions = functions.filter(
    (f) => f.length > FUNCTION_LENGTH_SMELL && !f.isTestCallback,
  ).length;
  const params = functions.map((f) => f.params);
  const avgParamsPerFunction = params.length ? params.reduce((a, b) => a + b, 0) / params.length : 0;

  // Indice de maintenabilité : par fonction, puis moyenne — la mesure de
  // l'article d'Oman. Un fichier de trente fonctions triviales ne doit pas
  // hériter du MI d'un fichier de trente lignes.
  const maintainability = functions.length
    ? functions.reduce((a, f) => a + f.maintainability, 0) / functions.length
    : null;

  // Identifiants : opérandes « mots », hors chaînes déjà retirées.
  const idsAll = [...masked.matchAll(cachedRx(IDENT_RX.source, "gu"))]
    .map((m) => m[0])
    .filter((w) => !isKeyword(w, family));
  const distinct = [...new Set(idsAll)];
  const loopCounters = new Set(["i", "j", "k", "n", "x", "y", "z"]);
  const poor = distinct.filter((w) => w.length === 1 && !loopCounters.has(w)).length;
  const avgLength = distinct.length
    ? distinct.reduce((a, w) => a + w.length, 0) / distinct.length
    : 0;
  const descriptiveRatio = distinct.length
    ? distinct.filter((w) => w.length >= 4).length / distinct.length
    : 1;

  const imports = countImports(src);
  const todos = lines.filter((l) => MARKER_RX.test(l.text)).length;

  const sourceLines = lines.filter((l) => l.kind !== "blank");
  const trailingWhitespace = sourceLines.filter((l) => /[ \t]+$/.test(l.text)).length;
  const longLines = lines.filter((l) => l.text.length > LONG_LINE).length;
  const lineLengths = lines.map((l) => l.text.length);
  const maxLineLength = maxOf(lineLengths);
  const avgLineLength = codeLines.length
    ? codeLines.reduce((a, l) => a + l.text.trimEnd().length, 0) / codeLines.length
    : 0;

  const magicNumbers = isTest ? 0 : countMagicNumbers(lines);
  const { duplicateLines, windowHashes } = duplication(codeLines);

  // L'indentation se juge sur le **code** : un JSDoc aligné à la tabulation
  // dans un fichier qui indente à l'espace n'est pas un fichier mixte.
  const indentChars = codeLines
    .map((l) => l.text[0])
    .filter((c) => c !== undefined);
  const mixedIndent = indentChars.includes("\t") && indentChars.includes(" ");

  const first = lines.find((l) => l.kind !== "blank");
  const hasHeaderComment = !!first && (first.kind === "comment" || first.hasComment);

  const apiFns = functions.filter((f) => f.exported && !f.isTestCallback);

  return {
    path: src.path,
    family,
    confidence: src.confidence,
    truncated: src.truncated,
    isTest,
    lines: lines.length,
    sloc,
    comments,
    blanks,
    inlineComments,
    commentRatio: lines.length ? (comments + inlineComments) / lines.length : 0,
    halstead: h,
    cyclomatic,
    decisionDensity: sloc ? decisionsPerLine.reduce((a, b) => a + b, 0) / sloc : 0,
    cognitive,
    maxDepth,
    avgDepth,
    functions,
    cyclomaticDistribution,
    cognitiveDistribution,
    lengthDistribution,
    avgFunctionLength,
    maxFunctionLength,
    longFunctions,
    avgParamsPerFunction,
    maintainability,
    naming: { total: idsAll.length, distinct: distinct.length, poor, avgLength, descriptiveRatio },
    imports,
    todos,
    trailingWhitespace,
    longLines,
    maxLineLength,
    avgLineLength,
    magicNumbers,
    duplicateLines,
    windowHashes,
    mixedIndent,
    hasHeaderComment,
    api: { total: apiFns.length, documented: apiFns.filter((f) => f.documented).length },
    assertions: isTest ? countAssertions(src) : 0,
  };
}

/**
 * Motifs d'assertion reconnus, tous cadriciels confondus.
 *
 * Les formes des cadriciels (`expect(`, `.toBe(`) **et** les aides
 * maison : un dépôt qui écrit `check(a === b)` teste autant qu'un dépôt
 * qui écrit `expect(a).toBe(b)`, et ne pas le voir faisait tomber la
 * dimension tests à zéro sur un projet qui en a trente.
 */
const ASSERTION_RX = /\.(toBe|toEqual|toStrictEqual|toThrow|toHaveBeenCalled|toContain|toMatch|toHaveLength|toMatchSnapshot)\b|\b(assert|expect|should|check|verify|ensure|isTrue|isFalse|expectReject)\w*\s*\(/;

function countAssertions(src: AnalysedSource): number {
  return src.lines.filter((l) => l.kind === "code" && ASSERTION_RX.test(l.masked)).length;
}

/**
 * Littéraux numériques « magiques ».
 *
 * Exclus, et pourquoi :
 *
 * - `0`, `1` et les puissances de dix s'écrivent pour ce qu'ils sont
 *   (compteur, facteur d'échelle) ;
 * - `const FUNCTION_LENGTH_SMELL = 40;` — une constante **nommée** est la
 *   correction du problème, pas le problème. La pénaliser revenait à
 *   punir le code bien écrit ;
 * - les valeurs d'un `enum` : elles sont nommées par leur clé ;
 * - un fichier de test, où `expect(n).toBe(6)` compare un littéral, ce qui
 *   est précisément le rôle d'un test.
 *
 * La version précédente laissait deux implémentations divergentes — l'une
 * sur le texte brut dans `scoreLine`, l'autre sur le texte masqué ici — et
 * ignorait les décimaux : `0.35` n'était jamais compté.
 */
function countMagicNumbers(lines: AnalysedLine[]): number {
  let n = 0;
  let enumDepth = 0;
  let pendingEnum = false;

  for (const l of lines) {
    if (l.kind !== "code") continue;

    if (enumDepth > 0) {
      for (const ch of l.masked) {
        if (ch === "{") enumDepth++;
        else if (ch === "}") enumDepth--;
      }
      continue;
    }
    if (/\benum\s+[\p{L}_$][\p{L}\p{N}_$]*\s*\{/u.test(l.masked)) {
      enumDepth = 1;
      continue;
    }
    if (pendingEnum && l.masked.trim().startsWith("{")) {
      enumDepth = 1;
      pendingEnum = false;
      continue;
    }
    pendingEnum = /\benum\s+[\p{L}_$][\p{L}\p{N}_$]*\s*$/u.test(l.masked);

    n += magicNumbersIn(l.masked);
  }
  return n;
}

/**
 * Littéraux « magiques » d'une **seule** ligne masquée.
 *
 * Une seule implémentation, partagée avec la note de ligne : la version
 * précédente en avait deux — l'une sur le texte brut dans `scoreLine`,
 * l'autre sur le texte masqué ici — et elles divergeaient déjà sur les
 * décimales, `0.35` n'étant compté par aucune des deux.
 */
export function magicNumbersIn(maskedLine: string): number {
  // Constante nommée : `const X = 40;` — le littéral y est déjà nommé, et
  // le pénaliser reviendrait à punir la correction du problème.
  if (NAMED_CONSTANT_RX.test(maskedLine)) return 0;

  let n = 0;
  for (const m of maskedLine.matchAll(NUMBER_RX)) {
    const raw = m[0];
    if (!/^\d[\d_]*(\.\d+)?([eE][-+]?\d+)?$/.test(raw)) continue;
    const v = Number(raw.replace(/_/g, ""));
    if (!Number.isFinite(v)) continue;
    // 0 et 1 s'écrivent pour ce qu'ils sont ; les puissances de dix sont
    // des facteurs d'échelle lisibles d'un coup d'œil.
    if (v === 0 || v === 1) continue;
    if (v === 10 || v === 100 || v === 1000 || v === 10000) continue;
    n++;
  }
  return n;
}

/**
 * Déclaration qui **nomme** un littéral : `const X = 40;`, `readonly X:
 * number = 40`, `val x = 40`. Le nom est la correction ; on ne la compte
 * pas comme faute.
 */
const NAMED_CONSTANT_RX =
  /^\s*(?:export\s+|public\s+|private\s+|protected\s+|static\s+|readonly\s+|final\s+)*(?:const|let|var|val)\s+[\p{L}_$][\p{L}\p{N}_$]*\s*(?::[^=]+)?=\s*[-+]?[\d.]+(?:[eE][-+]?\d+)?\s*;?\s*$/u;

/**
 * Duplication, par **fenêtres de quatre lignes consécutives**.
 *
 * La version précédente comparait des lignes isolées : `return null;`
 * écrit trois fois était de la « duplication », et un `}` aussi. Une
 * ligne seule ne prouve rien ; une suite de quatre lignes identiques,
 * oui. Toute répétition de 5, 6 ou 20 lignes contient au moins une
 * fenêtre de quatre lignes identique, donc ce grain suffit à les
 * détecter toutes, sans conserver le texte : on ne garde que des
 * empreintes FNV-1a, ce qui rend la comparaison inter-fichiers possible
 * sans doubler la mémoire.
 */
const WINDOW_LINES = 4;
/** Contenu minimal d'une fenêtre : `}` ×4 n'est pas de la duplication. */
const WINDOW_MIN_CHARS = 24;

/**
 * Ce qui est comparé, et pourquoi c'est le texte **réel**.
 *
 * Cette fonction lisait `l.masked` — la ligne où commentaires et chaînes ont
 * été remplacés par des espaces. C'était faux, et de façon spectaculaire :
 * le masquage efface précisément ce qui distingue deux lignes. Le corpus
 * réel l'a mis en évidence dès sa première exécution — `case "a": break;`
 * et `case "b": break;` se normalisaient tous deux en `case : break;`, donc
 * deux cas **différents** comptaient comme une copie. Zod sortait à 100 % de
 * fenêtres dupliquées, ESLint à 95 %, Ajv à 100 % : trois bases de code
 * mûres accusées d'être des copier-coller.
 *
 * Pour la complexité, masquer est juste : le contenu d'une chaîne ne
 * décide de rien. Pour la duplication, c'est l'inverse — **le contenu est
 * la preuve**. `const a = 1;` et `const b = 2;` ne sont pas une copie.
 *
 * On garde donc le commentaire en place : une copie qui conserve ses
 * commentaires reste une copie, et une copie qui les réécrit n'est plus
 * exactement la même ligne — le grain de quatre lignes absorbe cette
 * différence, et sous-compter vaut mieux que d'accuser à tort.
 */
function normalizeForDuplication(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function duplication(codeLines: AnalysedLine[]): { duplicateLines: number; windowHashes: number[] } {
  const normalized = codeLines.map((l) => normalizeForDuplication(l.text));
  const firstSeen = new Map<number, number>();
  const hashes: number[] = [];
  const repeated = new Set<number>();

  for (let i = 0; i + WINDOW_LINES <= normalized.length; i++) {
    const window = normalized.slice(i, i + WINDOW_LINES);
    const joined = window.join("\n");
    if (joined.replace(/\n/g, "").length < WINDOW_MIN_CHARS) continue;
    const hash = fnv1a(joined);
    hashes.push(hash);
    const previous = firstSeen.get(hash);
    if (previous === undefined) {
      firstSeen.set(hash, i);
    } else {
      // On ne compte que la **copie**, pas la première occurrence : « 4
      // lignes dupliquées » veut dire quatre lignes recopiées, et le ratio
      // garde alors le sens de « part du fichier qui est une copie ».
      for (let k = 0; k < WINDOW_LINES; k++) repeated.add(i + k);
    }
  }

  return { duplicateLines: repeated.size, windowHashes: hashes };
}

const IMPORT_RX = /^\s*(?:import\s|from\s+\S+\s+import|#include\s|require\s*\(|use\s+\S+\s*;|using\s|require_relative\s)/;
function countImports(src: AnalysedSource): number {
  return src.lines.filter((l) => IMPORT_RX.test(l.masked)).length;
}

/* ------------------------------------------------------------------ */
/* Indice de maintenabilité (Coleman-Oman)                             */
/* ------------------------------------------------------------------ */

/**
 * `MI = max(0, (171 − 5,2·ln(V) − 0,23·G − 16,2·ln(L)) × 100 / 171)`
 *
 * `V` volume de Halstead, `G` complexité cyclomatique, `L` lignes de code
 * — les trois entrées de la forme publiée par Oman & Hagemeister (1992),
 * et celle qu'implémente Visual Studio.
 *
 * Deux corrections assumées :
 *
 * - **pas de terme de commentaires.** La version précédente ajoutait
 *   `50·sin(√(2,4·C))` puis affirmait faire « comme Visual Studio ».
 *   Visual Studio n'a pas ce terme ; il vient d'une variante ultérieure du
 *   SEI. Le garder était une affirmation fausse dans un commentaire, ce
 *   qu'un jury sanctionne à juste titre — et il rendait la mesure
 *   manipulable en écrivant des commentaires ;
 * - **calcul par fonction**, puis moyenne (voir `extractMetrics`).
 */
export function maintainabilityIndex(volume: number, cyclomatic: number, sloc: number): number {
  const V = Math.max(volume, 1);
  const L = Math.max(sloc, 1);
  const raw = 171 - 5.2 * Math.log(V) - 0.23 * cyclomatic - 16.2 * Math.log(L);
  return clamp(raw * 100 / 171, 0, 100);
}

/**
 * Le classement visuel d'un indice de maintenabilité.
 *
 * Seuils **Visual Studio** : 0-9 rouge, 10-19 jaune, 20-100 vert. La
 * version précédente utilisait 65 et 40 « de mémoire » — ces valeurs
 * viennent de l'article IEEE de 1994 (85 et 65), pas de l'outil, et elles
 * n'ont pas de sens sur l'échelle normalisée à 100.
 */
export function maintainabilityBand(mi: number): { label: string; tone: "ok" | "warn" | "danger" } {
  if (mi >= 20) return { label: "maintenable", tone: "ok" };
  if (mi >= 10) return { label: "fragile", tone: "warn" };
  return { label: "difficile à maintenir", tone: "danger" };
}
