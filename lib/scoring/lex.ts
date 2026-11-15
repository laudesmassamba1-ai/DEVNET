/**
 * Analyse lexicale du moteur de score.
 *
 * ## Pourquoi une couche lexicale à part
 *
 * Toutes les mesures classiques de qualité logicielle — Halstead, McCabe,
 * l'indice de maintenabilité — travaillent sur les **opérateurs** et les
 * **opérandes** du code, pas sur le texte brut. Or le texte brut contient
 * des pièges : `if` dans un commentaire, `for` dans une chaîne, un `//`
 * dans une URL. Compter naïvement ces occurrences gonflerait la
 * complexité d'un fichier **mieux** commenté que d'un autre — exactement
 * l'inverse de ce qu'on veut mesurer.
 *
 * Cette couche remplace donc, avant toute mesure, le contenu des
 * commentaires et des chaînes par des espaces (en conservant la longueur,
 * donc les colonnes et les numéros de ligne), et retient à part le texte
 * des chaînes pour que Halstead puisse les compter comme opérandes.
 *
 * ## Deux moteurs, et une confiance affichée
 *
 * Une seule heuristique ne peut pas masquer correctement du TypeScript :
 * `/https?:\/\//` ou `/'/g` ressemblent à des commentaires, une apostrophe
 * française (`Aujourd'hui`) ouvre une fausse chaîne, et une expression
 * ternaire se cache dans du JSX. La version précédente masquait le reste
 * de la ligne et faisait disparaître des décisions — c'est une **erreur de
 * mesure**, pas un détail cosmétique.
 *
 * Deux moteurs cohabitent donc :
 *
 * - `maskC`, un **tokeniseur de la famille C** (JS/TS/JSX, C, Java, Go,
 *   Rust, CSS…) qui implémente les règles lexicales qui comptent :
 *   commentaires, chaînes, **expressions régulières** (décidées par le
 *   jeton précédent), **gabarits** avec leurs substitutions `${…}` — qui
 *   restent du code —, balises JSX, et l'apostrophe qui ne commence une
 *   chaîne que si elle n'est pas entre deux lettres ;
 * - `maskHeuristic`, pour les familles `#`, SQL, HTML et texte, où la
 *   syntaxe est trop variée pour une règle unique.
 *
 * `confidence` porte cette distinction jusqu'à l'écran : `"lexer"` pour
 * la famille C, `"heuristic"` sinon. Un score calculé sur du texte mal
 * masqué est faux ; l'annoncer est la seule façon honnête de l'exposer.
 *
 * ## Ce que cette couche est — et n'est pas
 *
 * Ce n'est **pas** un analyseur syntaxique : il ne construit pas d'arbre,
 * il ne résout pas les symboles, il ne sait pas qu'un identifiant est un
 * paramètre. Il ne prétend donc pas au même titre qu'un AST, et c'est
 * pourquoi `confidence` existe plutôt qu'une revendication. En échange, il
 * n'embarque aucune dépendance : le moteur tourne aussi bien dans le
 * navigateur (`ScorePanel`) que dans les tests Node, sur **tous** les
 * langages du catalogue, sans embarquer le compilateur TypeScript dans le
 * bundle client. `scripts/test-scoring.ts` vérifie ce tokeniseur **contre**
 * `ts.createScanner` : la référence est l'AST, l'exécution est la nôtre.
 *
 * Aucun accès réseau, aucun DOM : c'est du texte pur, testable en Node.
 */

import { extname } from "../git/paths";

/* ------------------------------------------------------------------ */
/* Plafonds                                                            */
/* ------------------------------------------------------------------ */

/**
 * Nombre de lignes au-delà duquel un fichier n'est plus analysé.
 *
 * Le moteur note des dépôts d'utilisateurs : un fichier de 150 000 lignes
 * ne doit pas faire tomber le navigateur, et une réponse en O(octets) vaut
 * mieux qu'un score exact sur un fichier qui n'est de toute façon plus
 * relu par personne. Le dépassement est **signalé** (`truncated`), pas
 * silencieux.
 */
export const MAX_ANALYSED_LINES = 20_000;
/** Taille au-delà de laquelle le fichier est tronqué à la dernière ligne entière. */
export const MAX_ANALYSED_CHARS = 1_000_000;

/* ------------------------------------------------------------------ */
/* Familles de langages                                                */
/* ------------------------------------------------------------------ */

/**
 * Une famille = une façon de commenter et de délimiter les chaînes.
 * Quatre familles couvrent tout le catalogue que DevNet sait afficher.
 */
export type LangFamily = "c" | "hash" | "sql" | "html" | "text";

/**
 * Fiabilité du masquage. `"lexer"` : un tokeniseur qui connaît la syntaxe
 * des chaînes et des commentaires (famille C). `"heuristic"` : des règles
 * de surface, suffisantes pour mesurer mais pas pour trancher un cas
 * limite.
 */
export type LexConfidence = "lexer" | "heuristic";

export interface LexRules {
  family: LangFamily;
  /** Marqueurs de commentaire de fin de ligne. */
  line: string[];
  /** Couples (ouverture, fermeture) de commentaires de bloc. */
  block: [string, string][];
  /** Délimiteurs de chaînes sur une ligne. */
  strings: string[];
  /**
   * Délimiteurs de chaînes multi-lignes. On les met à part car une chaîne
   * ordinaire non refermée s'arrête au bout de la ligne (sinon un guillemet
   * oublié avalerait tout le fichier), alors qu'un `` ` `` JavaScript ou un
   * `"""` Python traversent légitimement les lignes.
   */
  multiline: string[];
}

const C_LIKE: LexRules = {
  family: "c",
  line: ["//"],
  block: [["/*", "*/"]],
  strings: ["'", "\""],
  multiline: ["`"],
};

/**
 * CSS : `/* *​/` est le seul commentaire. `//` **n'en est pas un** : sans
 * cette distinction, `background: url(https://…)` serait masqué à partir
 * de `//` et la déclaration disparaîtrait de la mesure.
 */
const CSS: LexRules = {
  family: "c",
  line: [],
  block: [["/*", "*/"]],
  strings: ["'", "\""],
  multiline: [],
};

const HASH: LexRules = {
  family: "hash",
  line: ["#"],
  block: [],
  strings: ["'", "\""],
  multiline: ["\"\"\"", "'''"],
};

const SQL: LexRules = {
  family: "sql",
  line: ["--"],
  block: [["/*", "*/"]],
  strings: ["'", "\""],
  multiline: [],
};

const HTML: LexRules = {
  family: "html",
  line: [],
  block: [["<!--", "-->"]],
  strings: ["'", "\""],
  multiline: [],
};

/** Aucune syntaxe connue : on ne masque rien, on mesure le texte tel quel. */
const TEXT: LexRules = {
  family: "text",
  line: [],
  block: [],
  strings: [],
  multiline: [],
};

const FAMILY_BY_EXT: Record<string, LexRules> = {
  // C et descendants
  c: C_LIKE, h: C_LIKE, hpp: C_LIKE, cpp: C_LIKE, cc: C_LIKE, cxx: C_LIKE, cs: C_LIKE,
  java: C_LIKE, go: C_LIKE, rs: C_LIKE, swift: C_LIKE, kt: C_LIKE, kts: C_LIKE, dart: C_LIKE,
  js: C_LIKE, mjs: C_LIKE, cjs: C_LIKE, jsx: C_LIKE, ts: C_LIKE, tsx: C_LIKE,
  scss: C_LIKE, less: C_LIKE, sass: C_LIKE, php: C_LIKE, scala: C_LIKE,
  json: C_LIKE, jsonc: C_LIKE, proto: C_LIKE, graphql: C_LIKE, gql: C_LIKE,
  css: CSS,
  // Commentaires `#`
  py: HASH, rb: HASH, sh: HASH, bash: HASH, zsh: HASH,
  fish: HASH, pl: HASH, pm: HASH, r: HASH, ps1: HASH,
  yml: HASH, yaml: HASH, toml: HASH, ini: HASH, cfg: HASH,
  conf: HASH, env: HASH, mk: HASH, dockerfile: HASH, tf: HASH,
  // SQL et cousins
  sql: SQL, lua: SQL, hs: SQL,
  // Balisage
  html: HTML, htm: HTML, xml: HTML, svg: HTML, vue: HTML, svelte: HTML,
  // Texte
  md: TEXT, markdown: TEXT, mdx: TEXT, txt: TEXT, rst: TEXT,
};

/** Règles lexicales déduites d'un chemin. */
export function rulesForPath(path: string): LexRules {
  return FAMILY_BY_EXT[extname(path)] ?? TEXT;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Nature d'une ligne. Un seul type pour tout le moteur : la version
 * précédente en avait deux (`LineKind` ici, `LineKindLabel` dans
 * `score.ts`) qui disaient la même chose — deux définitions d'un même
 * concept finissent par diverger.
 */
export type LineKind = "blank" | "comment" | "code";

export interface AnalysedLine {
  /** Index 0-based dans le fichier. */
  index: number;
  /** Ligne d'origine, telle qu'affichée. */
  text: string;
  /** Ligne où commentaires et chaînes sont remplacés par des espaces. */
  masked: string;
  kind: LineKind;
  /** La ligne contient un commentaire (même après du code). */
  hasComment: boolean;
  /**
   * La ligne est **entièrement** à l'intérieur d'une chaîne multi-lignes :
   * docstring Python, gabarit JS, requête SQL littérale. Ce ne sont ni des
   * lignes de code ni des lignes vides — les compter comme vides faisait
   * tomber le ratio de documentation à zéro sur du Python documenté.
   */
  inString: boolean;
  /** Colonnes d'indentation en tête. */
  indent: number;
  /**
   * Profondeur d'imbrication au premier token de code.
   * 0 = racine du fichier ; 3 = trois blocs imbriqués.
   */
  depth: number;
}

export interface AnalysedSource {
  path: string;
  family: LangFamily;
  rules: LexRules;
  confidence: LexConfidence;
  lines: AnalysedLine[];
  /**
   * Fichier entier où commentaires et chaînes sont des espaces.
   * C'est ce texte que parcourent les compteurs de Halstead et de McCabe.
   */
  masked: string;
  /** Contenu des chaînes littérales rencontrées, dans l'ordre. */
  literals: string[];
  /** Le fichier a dépassé un plafond : la mesure porte sur un préfixe. */
  truncated: boolean;
  /** Lignes non analysées à cause du plafond. */
  skippedLines: number;
}

/* ------------------------------------------------------------------ */
/* Masquage — famille C (tokeniseur)                                   */
/* ------------------------------------------------------------------ */

interface Masked {
  masked: string;
  commentFlags: boolean[];
  stringFlags: boolean[];
  literals: string[];
}

/** Une lettre, un chiffre, `_` ou `$` : les caractères d'un identifiant. */
const WORD_CHAR = /[\p{L}\p{N}_$]/u;

/**
 * Caractères après lesquels un `/` ouvre une **expression régulière**
 * plutôt qu'une division. `}` en fait partie : après une accolade fermante
 * on est plus souvent en position d'instruction qu'au milieu d'un
 * quotient. `<` en est exclu : en JSX, `</div>` doit rester une balise.
 */
const REGEX_AFTER_SYMBOL = new Set("(,=:[!&|?{};+-*%~^>".split(""));

/** Mots-clés après lesquels un `/` ouvre une expression régulière. */
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await", "throw",
]);

/**
 * Le `/` à `at` ouvre-t-il une expression régulière ?
 *
 * C'est la règle dite « du jeton précédent », celle qu'utilisent les
 * colories syntaxiques : une regex ne peut apparaître qu'en position
 * d'opérande. Après un identifiant, un nombre, `)` ou `]`, c'est une
 * division. L'ambiguïté est levée par le premier caractère non blanc qui
 * précède.
 */
function regexStartsAt(chars: string[], at: number): boolean {
  let k = at - 1;
  while (k >= 0 && /\s/.test(chars[k])) k--;
  if (k < 0) return true;

  const c = chars[k];
  if (WORD_CHAR.test(c)) {
    let start = k;
    while (start >= 0 && WORD_CHAR.test(chars[start])) start--;
    return REGEX_AFTER_WORD.has(chars.slice(start + 1, k + 1).join(""));
  }
  if (c === ")" || c === "]") return false;
  return REGEX_AFTER_SYMBOL.has(c);
}

/** Fin d'une expression régulière partant de `at`, ou `null` si ce n'en est pas une. */
function regexEnd(chars: string[], at: number, n: number): number | null {
  let i = at + 1;
  let inClass = false;
  while (i < n) {
    const c = chars[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "\n") return null;
    if (inClass) {
      if (c === "]") inClass = false;
      i++;
      continue;
    }
    if (c === "[") { inClass = true; i++; continue; }
    if (c === "/") {
      let j = i + 1;
      while (j < n && WORD_CHAR.test(chars[j])) j++;
      return j;
    }
    i++;
  }
  return null;
}

/**
 * Masque commentaires et chaînes de la famille C.
 *
 * Le point délicat est le **gabarit** : `` `Bonjour ${nom}` `` n'est pas
 * une chaîne opaque. Son texte est une donnée, mais l'expression entre
 * `${…}` est du **code**, et les décisions qu'elle contient doivent être
 * comptées. On récursive donc dans la substitution au lieu de tout
 * aplatir — sans quoi un ternaire dans un gabarit disparaîtrait, comme
 * dans la version précédente.
 */
function maskC(text: string, rules: LexRules): Masked {
  const chars = text.split("");
  const n = chars.length;
  const commentFlags = new Array<boolean>(n).fill(false);
  const stringFlags = new Array<boolean>(n).fill(false);
  const literals: string[] = [];

  const blank = (from: number, to: number, comment: boolean, isString: boolean) => {
    for (let k = from; k < Math.min(to, n); k++) {
      if (chars[k] === "\n") {
        if (comment) commentFlags[k] = true;
        continue;
      }
      chars[k] = " ";
      if (comment) commentFlags[k] = true;
      if (isString) stringFlags[k] = true;
    }
  };

  /**
   * Parcourt du code dans `[from, end)`. Si `stopAtBrace` est vrai, la
   * fonction s'arrête au `}` qui ferme le bloc courant (substitution de
   * gabarit) et renvoie son index ; sinon elle va jusqu'à `end`.
   */
  const scan = (from: number, end: number, stopAtBrace: boolean): number => {
    let i = from;
    let brace = 0;
    while (i < end) {
      // 1. Commentaire de bloc — testé avant la ligne, sinon `/*` serait vu
      //    comme deux `/` par la règle de commentaire de ligne.
      let open: string | null = null;
      let close = "";
      for (const [o, c] of rules.block) {
        if (text.startsWith(o, i)) { open = o; close = c; break; }
      }
      if (open) {
        let j = i + open.length;
        while (j < end && !text.startsWith(close, j)) j++;
        const stop = j < end ? Math.min(end, j + close.length) : end;
        blank(i, stop, true, false);
        i = stop;
        continue;
      }

      // 2. Commentaire de fin de ligne. `rules.line` et non `//` en dur :
      //    en CSS, `//` n'est pas un commentaire, et `url(https://…)` doit
      //    rester visible.
      const lineMark = rules.line.find((m) => text.startsWith(m, i));
      if (lineMark) {
        let j = i;
        while (j < end && chars[j] !== "\n") j++;
        blank(i, j, true, false);
        i = j;
        continue;
      }

      const c = chars[i];

      // 3. Expression régulière. `//` et `/*` ont déjà été traités : ce qui
      //    reste et commence par `/` en position d'opérande est une regex.
      if (c === "/" && regexStartsAt(chars, i)) {
        const stop = regexEnd(chars, i, end);
        if (stop !== null) {
          literals.push(chars.slice(i, stop).join(""));
          blank(i, stop, false, true);
          i = stop;
          continue;
        }
      }

      // 4. Gabarit : texte masqué, substitutions laissées au code.
      if (c === "`") {
        blank(i, i + 1, false, true);
        i++;
        let buf = "";
        while (i < end) {
          const d = chars[i];
          if (d === "\\") {
            buf += chars[i + 1] ?? "";
            blank(i, i + 2, false, true);
            i += 2;
            continue;
          }
          if (d === "`") {
            blank(i, i + 1, false, true);
            i++;
            break;
          }
          if (d === "$" && chars[i + 1] === "{") {
            blank(i, i + 2, false, true);
            const stop = scan(i + 2, end, true);
            // L'accolade fermante est masquée elle aussi : c'est une
            // ponctuation de gabarit, pas un `}` du programme — la laisser
            // visible fausserait la profondeur et le volume de Halstead.
            if (stop < end) blank(stop, stop + 1, false, true);
            i = stop < end ? stop + 1 : end;
            continue;
          }
          if (d === "\n") { i++; continue; }
          buf += d;
          blank(i, i + 1, false, true);
          i++;
        }
        literals.push(buf);
        continue;
      }

      // 5. Chaîne ordinaire. L'apostrophe entre deux lettres n'en ouvre
      //    pas une : `Aujourd'hui` est un mot, pas une chaîne qui avale la
      //    fin de la ligne. C'est ce qui rend la mesure utilisable sur une
      //    interface en français (`Il n'y a pas d'erreur`).
      if (c === "'" || c === "\"") {
        const prev = i > 0 ? chars[i - 1] : "";
        if (prev && WORD_CHAR.test(prev)) {
          i++;
          continue;
        }
        let j = i + 1;
        let buf = "";
        while (j < end) {
          const d = chars[j];
          if (d === "\\") { buf += chars[j + 1] ?? ""; j += 2; continue; }
          if (d === "\n" || d === c) break;
          buf += d;
          j++;
        }
        const stop = j < end && chars[j] === c ? j + 1 : Math.min(j, end);
        literals.push(buf);
        blank(i, stop, false, true);
        i = stop;
        continue;
      }

      if (stopAtBrace) {
        if (c === "{") brace++;
        else if (c === "}") {
          if (brace === 0) return i;
          brace--;
        }
      }

      i++;
    }
    return end;
  };

  scan(0, n, false);
  return { masked: chars.join(""), commentFlags, stringFlags, literals };
}

/* ------------------------------------------------------------------ */
/* Masquage — heuristique (les autres familles)                        */
/* ------------------------------------------------------------------ */

/**
 * Masque commentaires et chaînes des familles `#`, SQL, HTML et texte.
 *
 * Règles de surface : une chaîne non refermée s'arrête au bout de la
 * ligne, un bloc non refermé va jusqu'à la fin du fichier, et — comme pour
 * la famille C — une apostrophe entre deux lettres reste une apostrophe.
 * C'est ce qui permet à du HTML français (`Aujourd'hui`) et à du SQL
 * (`l'utilisateur`) de ne pas perdre la fin de leur ligne.
 */
function maskHeuristic(text: string, rules: LexRules): Masked {
  const chars = text.split("");
  const n = chars.length;
  const commentFlags = new Array<boolean>(n).fill(false);
  const stringFlags = new Array<boolean>(n).fill(false);
  const literals: string[] = [];

  const blank = (from: number, to: number, comment: boolean, isString: boolean) => {
    for (let k = from; k < Math.min(to, n); k++) {
      if (chars[k] === "\n") {
        if (comment) commentFlags[k] = true;
        continue;
      }
      chars[k] = " ";
      if (comment) commentFlags[k] = true;
      if (isString) stringFlags[k] = true;
    }
  };

  const startsWithAny = (at: number, markers: string[]): string | null => {
    for (const m of markers) if (text.startsWith(m, at)) return m;
    return null;
  };

  let i = 0;
  while (i < n) {
    // 1. Commentaire de bloc, avant la règle de ligne (`/*` vs `/`).
    const open = startsWithAny(i, rules.block.map(([o]) => o));
    if (open) {
      const close = rules.block.find(([o]) => o === open)![1];
      let j = i + open.length;
      while (j < n && !text.startsWith(close, j)) j++;
      const stop = j < n ? j + close.length : n;
      blank(i, stop, true, false);
      i = stop;
      continue;
    }

    // 2. Commentaire de fin de ligne.
    const lineMark = startsWithAny(i, rules.line);
    if (lineMark) {
      let j = i;
      while (j < n && chars[j] !== "\n") j++;
      blank(i, j, true, false);
      i = j;
      continue;
    }

    // 3. Chaîne multi-lignes : backtick JS, `"""` Python, `'''` Ruby.
    const multi = startsWithAny(i, rules.multiline);
    if (multi) {
      let j = i + multi.length;
      let buf = "";
      while (j < n && !text.startsWith(multi, j)) {
        if (chars[j] === "\\") { buf += chars[j + 1] ?? ""; j += 2; continue; }
        buf += chars[j];
        j++;
      }
      const stop = j < n ? j + multi.length : n;
      blank(i, stop, false, true);
      literals.push(buf);
      i = stop;
      continue;
    }

    // 4. Chaîne ordinaire.
    const c = chars[i];
    if (rules.strings.includes(c)) {
      const prev = i > 0 ? chars[i - 1] : "";
      if (prev && WORD_CHAR.test(prev)) {
        i++;
        continue;
      }
      let j = i + 1;
      let buf = "";
      while (j < n) {
        const d = chars[j];
        if (d === "\\") { buf += chars[j + 1] ?? ""; j += 2; continue; }
        if (d === "\n" || d === c) break;
        buf += d;
        j++;
      }
      const stop = j < n && chars[j] === c ? j + 1 : Math.min(j, n);
      literals.push(buf);
      blank(i, stop, false, true);
      i = stop;
      continue;
    }

    i++;
  }

  return { masked: chars.join(""), commentFlags, stringFlags, literals };
}

/* ------------------------------------------------------------------ */
/* Profondeur d'imbrication                                            */
/* ------------------------------------------------------------------ */

/**
 * Profondeur de chaque ligne, au premier token.
 *
 * Deux modèles, parce que deux façons de dire « bloc » :
 *
 * - **accolades** (familles C et SQL) : la profondeur est le nombre
 *   d'accolades ouvertes non refermées ;
 * - **indentation** (familles #, HTML, texte) : la profondeur est la
 *   position de l'indentation dans une pile d'indentations décroissantes —
 *   c'est le modèle de Python, où `def` puis `if` puis `for` donnent trois
 *   niveaux.
 */
function computeDepths(
  maskedLines: string[],
  kinds: LineKind[],
  family: LangFamily,
): number[] {
  const depths = new Array<number>(maskedLines.length).fill(0);

  if (family === "c" || family === "sql") {
    let depth = 0;
    for (let i = 0; i < maskedLines.length; i++) {
      depths[i] = depth;
      for (const ch of maskedLines[i]) {
        if (ch === "{") depth++;
        else if (ch === "}") depth = Math.max(0, depth - 1);
      }
    }
    return depths;
  }

  // Indentation : pile d'indentations. On ne descend jamais sous zéro.
  const stack: number[] = [0];
  for (let i = 0; i < maskedLines.length; i++) {
    if (kinds[i] !== "code") {
      depths[i] = stack.length - 1;
      continue;
    }
    const indent = indentWidth(maskedLines[i]);
    while (stack.length > 1 && indent < stack[stack.length - 1]) stack.pop();
    if (indent > stack[stack.length - 1]) stack.push(indent);
    depths[i] = stack.length - 1;
  }
  return depths;
}

/** Largeur d'indentation, tabulation = 4 colonnes (une convention, assumée). */
export function indentWidth(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w++;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

/* ------------------------------------------------------------------ */
/* Point d'entrée                                                      */
/* ------------------------------------------------------------------ */

/** Tronque le texte au plafond, sans couper une ligne au milieu. */
function capText(text: string): { text: string; truncated: boolean; skipped: number } {
  const lines = text.split("\n");
  if (lines.length > MAX_ANALYSED_LINES) {
    return {
      text: lines.slice(0, MAX_ANALYSED_LINES).join("\n"),
      truncated: true,
      skipped: lines.length - MAX_ANALYSED_LINES,
    };
  }
  if (text.length > MAX_ANALYSED_CHARS) {
    const cut = text.lastIndexOf("\n", MAX_ANALYSED_CHARS);
    const at = cut > 0 ? cut : MAX_ANALYSED_CHARS;
    return { text: text.slice(0, at), truncated: true, skipped: lines.length };
  }
  return { text, truncated: false, skipped: 0 };
}

/**
 * Analyse un fichier : masquage, classification des lignes, profondeur.
 *
 * Les lignes sont rendues telles quelles (tableau de longueur
 * `text.split("\n").length`) : un fichier vide donne **une** ligne, pas
 * zéro, ce qui évite tous les cas particuliers dans les mesures en aval.
 */
export function analyse(text: string, path: string): AnalysedSource {
  const rules = rulesForPath(path);
  const capped = capText(text);
  const source = capped.text;

  const maskedText = rules.family === "c"
    ? maskC(source, rules)
    : maskHeuristic(source, rules);
  const { masked, commentFlags, stringFlags, literals } = maskedText;

  const rawLines = source.split("\n");
  const maskedLines = masked.split("\n");

  const lineStart: number[] = [];
  {
    let at = 0;
    for (const l of rawLines) {
      lineStart.push(at);
      at += l.length + 1; // +1 pour le `\n` consommé par split
    }
  }

  const kinds: LineKind[] = [];
  const lines: AnalysedLine[] = rawLines.map((raw, i) => {
    const m = maskedLines[i] ?? "";
    const trimmed = m.trim();
    const start = lineStart[i];
    const hasComment = commentFlags.slice(start, start + raw.length).some(Boolean);
    const inString = trimmed === "" &&
      stringFlags.slice(start, start + raw.length).some(Boolean);

    // Une ligne entièrement prise dans une chaîne multi-lignes est une
    // ligne de documentation (docstring Python, gabarit JS), pas une ligne
    // vide : la compter comme vide ramenait le ratio de documentation à
    // zéro sur du Python correctement documenté.
    const kind: LineKind = trimmed !== ""
      ? "code"
      : hasComment || inString
        ? "comment"
        : "blank";
    kinds.push(kind);

    return {
      index: i,
      text: raw,
      masked: m,
      kind,
      hasComment,
      inString,
      indent: indentWidth(raw),
      depth: 0,
    };
  });

  const depths = computeDepths(maskedLines, kinds, rules.family);
  for (let i = 0; i < lines.length; i++) lines[i].depth = depths[i];

  return {
    path,
    family: rules.family,
    rules,
    confidence: rules.family === "c" ? "lexer" : "heuristic",
    lines,
    masked,
    literals,
    truncated: capped.truncated,
    skippedLines: capped.skipped,
  };
}
