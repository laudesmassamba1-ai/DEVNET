/**
 * Tokenizer de coloration syntaxique.
 *
 * Maison, volontairement : `shiki` et `prism-react-renderer` pèsent ~120 ko
 * gzip pour huit langages, alors que DevNet n'en affiche que quelques-uns et
 * n'a pas besoin des grammaires de langages qu'on ne voit jamais ici.
 *
 * Le contrat est volontairement minimal : on produit une liste de jetons
 * `{ type, value }`. Le rendu en spans se fait dans `<CodeBlock>`, ce qui
 * permet de changer de palette (papier / terminal) sans re-coloriser —
 * les couleurs viennent de variables CSS.
 */

/** Familles de jetons, alignées sur les classes `.tok-*`. */
export type TokenType =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "function"
  | "type"
  | "punct"
  | "plain";

export interface Token {
  type: TokenType;
  value: string;
}

interface LangSpec {
  /** Début de commentaire de fin de ligne. */
  lineComment?: string[];
  /** Paire de délimiteurs de commentaire multi-lignes. */
  blockComment?: [string, string];
  /** Chaînes délimitées par un caractère simple (`"` ou `'`). */
  quotes: string[];
  /** Chaîne multi-lignes (Python `"""`), à tester avant `quotes`. */
  tripleQuotes?: string[];
  keywords: Set<string>;
  /** Fonctions natives du langage : coloriées comme des appels. */
  builtins?: Set<string>;
  /** Mots qui introduisent un type : le mot suivant est colorié `type`. */
  typeIntroducers: string[];
}

const PY = [
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
  "match", "case", "self",
];

const TS = [
  "abstract", "any", "as", "async", "await", "boolean", "break", "case",
  "catch", "class", "const", "continue", "debugger", "declare", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally",
  "for", "from", "function", "if", "implements", "import", "in", "instanceof",
  "interface", "is", "let", "new", "null", "number", "of", "private",
  "protected", "public", "readonly", "return", "static", "string", "super",
  "switch", "this", "throw", "true", "try", "type", "typeof", "undefined",
  "var", "void", "while", "yield", "satisfies", "keyof", "infer", "never",
  "unknown", "readonly",
];

const SQL = [
  "select", "from", "where", "insert", "into", "values", "update", "set",
  "delete", "create", "table", "drop", "alter", "add", "column", "primary",
  "key", "foreign", "references", "index", "on", "and", "or", "not", "null",
  "default", "unique", "check", "constraint", "join", "inner", "left", "right",
  "full", "outer", "group", "by", "order", "having", "limit", "offset",
  "union", "all", "distinct", "as", "case", "when", "then", "else", "end",
  "with", "insert", "returning", "asc", "desc", "cascade", "if", "exists",
  "true", "false", "begin", "commit", "rollback", "grant", "policy", "role",
  "auth", "public", "security", "definer", "stable", "language", "plpgsql",
];

const GO = [
  "break", "case", "chan", "const", "continue", "default", "defer", "else",
  "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
  "map", "package", "range", "return", "select", "struct", "switch", "type",
  "var", "nil", "true", "false", "string", "int", "int64", "error", "bool",
  "byte", "rune", "float64", "make", "new", "len", "cap", "append",
];

const RUST = [
  "as", "async", "await", "break", "const", "continue", "crate", "dyn",
  "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let",
  "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self",
  "Self", "static", "struct", "super", "trait", "true", "type", "unsafe",
  "use", "where", "while", "async", "await", "String", "Vec", "Option",
  "Result", "Box",
];

const PHP = [
  "abstract", "and", "array", "as", "break", "callable", "case", "catch",
  "class", "clone", "const", "continue", "declare", "default", "do", "echo",
  "else", "elseif", "empty", "enddeclare", "endfor", "endforeach", "endif",
  "endswitch", "endwhile", "extends", "final", "finally", "fn", "for",
  "foreach", "function", "global", "if", "implements", "include", "instanceof",
  "interface", "isset", "list", "namespace", "new", "or", "private",
  "protected", "public", "require", "return", "static", "switch", "throw",
  "trait", "try", "unset", "use", "var", "while", "true", "false", "null",
];

const JVM = [
  "abstract", "boolean", "break", "byte", "case", "catch", "char", "class",
  "const", "continue", "default", "do", "double", "else", "enum", "extends",
  "final", "finally", "float", "for", "if", "implements", "import",
  "instanceof", "int", "interface", "long", "native", "new", "package",
  "private", "protected", "public", "return", "short", "static", "super",
  "switch", "this", "throw", "throws", "try", "void", "while", "true",
  "false", "null", "val", "var", "fun",
];

const DART = [
  "abstract", "as", "assert", "async", "await", "break", "case", "catch",
  "class", "const", "continue", "covariant", "default", "deferred", "do",
  "dynamic", "else", "enum", "export", "extends", "extension", "external",
  "factory", "false", "final", "finally", "for", "get", "if", "implements",
  "import", "in", "is", "late", "library", "mixin", "new", "null", "on",
  "operator", "part", "required", "rethrow", "return", "set", "show", "static",
  "super", "switch", "sync", "this", "throw", "true", "try", "typedef", "var",
  "void", "while", "with", "yield",
];

const C_FAMILY = [
  "auto", "break", "case", "char", "const", "continue", "default", "do",
  "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline",
  "int", "long", "register", "restrict", "return", "short", "signed", "sizeof",
  "static", "struct", "switch", "typedef", "union", "unsigned", "void",
  "volatile", "while", "class", "public", "private", "protected", "template",
  "namespace", "using", "new", "delete", "true", "false", "nullptr", "this",
  "std", "vector", "string", "int32_t", "uint32_t", "size_t", "bool",
];

/** Les mots-clés sont écrits en tableau ici, convertis en Set une seule fois. */
function spec(
  s: Omit<Partial<LangSpec>, "keywords" | "builtins"> & {
    quotes: string[];
    keywords: string[];
    builtins?: string[];
  },
): LangSpec {
  return {
    ...s,
    keywords: new Set(s.keywords),
    builtins: new Set(s.builtins ?? []),
    typeIntroducers: s.typeIntroducers ?? [],
  };
}

/**
 * Fonctions natives, partagées quand elles ont le même nom.
 *
 * Indispensable : sans elles `COUNT`, `len`, `print` ou `console` seraient
 * coloriés comme des types capitalisés ou du texte neutre — alors que ce sont
 * des appels, et qu'on s'attend à les voir ressortir.
 */
const BUILTIN_PY = [
  "print", "len", "range", "str", "int", "float", "bool", "list", "dict",
  "set", "tuple", "sum", "min", "max", "abs", "sorted", "enumerate", "zip",
  "map", "filter", "open", "isinstance", "super", "type", "repr", "round",
];

const BUILTIN_JS = [
  "console", "Math", "JSON", "Object", "Array", "String", "Number", "Boolean",
  "Promise", "Set", "Map", "Date", "RegExp", "Error", "parseInt", "parseFloat",
  "isNaN", "fetch", "require", "setTimeout", "setInterval", "document",
  "window", "localStorage", "navigator",
];

const BUILTIN_SQL = [
  "count", "sum", "avg", "min", "max", "coalesce", "nullif", "greatest",
  "least", "now", "current_timestamp", "current_date", "like", "ilike",
  "unnest", "gen_random_uuid", "auth", "floor", "ceil", "round", "length",
  "lower", "upper", "concat", "substring", "array_length", "random",
];

const BUILTIN_GO = [
  "fmt", "len", "cap", "make", "new", "append", "copy", "delete", "panic",
  "recover", "print", "println",
];

const BUILTIN_RUST = [
  "println", "print", "format", "vec", "push", "len", "clone", "unwrap",
  "expect", "Some", "None", "Ok", "Err", "into", "from", "to_string",
];

const BUILTIN_C = [
  "printf", "scanf", "malloc", "calloc", "free", "memcpy", "strlen", "strcmp",
  "printf", "puts", "realloc", "memset",
];

/**
 * Table des langages. La clé est normalisée en minuscules : les posts
 * écrivent «C++ », «c# », «JS »… et on ne veut pas rater une coloration.
 */
const LANGS: Record<string, LangSpec> = {
  python: spec({
    lineComment: ["#"],
    tripleQuotes: ['"""', "'''"],
    quotes: ['"', "'"],
    keywords: PY,
    builtins: BUILTIN_PY,
    typeIntroducers: ["class"],
  }),
  javascript: spec({
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    keywords: TS,
    builtins: BUILTIN_JS,
    typeIntroducers: ["class", "interface", "extends", "implements"],
  }),
  typescript: spec({
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    keywords: TS,
    builtins: BUILTIN_JS,
    typeIntroducers: ["class", "interface", "enum", "extends", "implements", "type"],
  }),
  sql: spec({
    lineComment: ["--"],
    quotes: ["'", '"'],
    keywords: SQL,
    builtins: BUILTIN_SQL,
    typeIntroducers: [],
  }),
  go: spec({
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "`"],
    keywords: GO,
    builtins: BUILTIN_GO,
    typeIntroducers: ["type", "struct", "interface"],
  }),
  rust: spec({
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
    keywords: RUST,
    builtins: BUILTIN_RUST,
    typeIntroducers: ["struct", "enum", "trait", "type", "impl"],
  }),
  php: spec({
    lineComment: ["//", "#"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: PHP,
    builtins: ["echo", "print_r", "var_dump", "count", "strlen", "array_map"],
    typeIntroducers: ["class", "interface", "trait"],
  }),
  kotlin: spec({
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
    keywords: JVM,
    builtins: ["println", "print", "listOf", "mutableListOf", "mapOf", "run"],
    typeIntroducers: ["class", "interface", "object", "enum class"],
  }),
  java: spec({
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
    keywords: JVM,
    builtins: ["println", "print", "printf", "String", "System", "Arrays", "List", "Map"],
    typeIntroducers: ["class", "interface", "enum"],
  }),
  dart: spec({
    lineComment: ["//", "///"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: DART,
    builtins: ["print", "listOf", "mapOf", "setOf", "Future", "Stream"],
    typeIntroducers: ["class", "mixin", "enum", "extension"],
  }),
  swift: spec({
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
    keywords: [
      "associatedtype", "class", "deinit", "enum", "extension", "func", "import",
      "init", "inout", "internal", "let", "open", "operator", "private",
      "protocol", "public", "static", "struct", "subscript", "typealias",
      "var", "where", "guard", "if", "else", "for", "while", "return", "true",
      "false", "nil", "self", "case", "switch", "default", "break", "continue",
    ],
    builtins: ["print", "map", "filter", "reduce", "append", "count", "String", "Int", "Array"],
    typeIntroducers: ["class", "struct", "enum", "protocol", "extension"],
  }),
  c: spec({
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: C_FAMILY,
    builtins: BUILTIN_C,
    typeIntroducers: ["struct", "union", "enum", "class"],
  }),
  cpp: spec({
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: [...C_FAMILY, "template", "typename", "using", "namespace", "public", "private"],
    builtins: [...BUILTIN_C, "std", "cout", "cin", "endl", "string", "vector", "unique_ptr"],
    typeIntroducers: ["class", "struct", "enum"],
  }),
};

/**
 * Normalise un libellé de langage écrit par un humain.
 *
 * `C / C++`, `C++`, `JS`, `TypeScript`, `c#`… tombent tous sur une clé connue.
 */
export function normalizeLang(input: string | null | undefined): string {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return "text";

  // « C / C++ » et assimilés : on prend le premier langage nommé.
  const first = raw.split("/")[0].trim();
  const cleaned = first.replace(/^\w#/, "").replace(/\s*\(.*\)$/, "").trim();

  if (LANGS[cleaned]) return cleaned;

  const aliases: Record<string, string> = {
    py: "python", python3: "python", ipython: "python",
    js: "javascript", node: "javascript", jsx: "javascript", mjs: "javascript",
    ts: "typescript", tsx: "typescript",
    postgres: "sql", postgresql: "sql", psql: "sql", mysql: "sql",
    golang: "go",
    rs: "rust",
    kt: "kotlin",
    "c++": "cpp", "c#": "cpp", cs: "cpp", "objective-c": "cpp",
    htm: "html", html: "text", css: "text", scss: "text", json: "text",
    bash: "text", sh: "text", shell: "text", zsh: "text",
    text: "text", plaintext: "text", "": "text",
  };

  return aliases[cleaned] ?? "text";
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const OPERATORS = "+-*/%=<>!&|^~?:.,;()[]{}@#";

/** Mots réservés de SQL : insensibles à la casse (SELECT = select). */
const SQL_UPPER = new Set(SQL.map((k) => k.toUpperCase()));
const SQL_BUILTIN_UPPER = new Set(BUILTIN_SQL.map((k) => k.toUpperCase()));

/**
 * Un jeton lu : le scanner avance **à chaque tour**.
 *
 * Une lecture qui n'aboutit pas renvoie `null` et le lecteur suivant est
 * essayé ; jamais on ne reste bloqué sur une position, puisque le dernier
 * repli avance d'un caractère.
 */
interface Step {
  token: Token;
  /** Position qui suit le jeton. */
  next: number;
}

/**
 * Un lecteur, par famille de jetons.
 *
 * Les lecteurs ne prennent **que** ce dont ils ont besoin : une fonction
 * qui ignore un argument n'en déclare pas, et l'affectation au tableau
 * reste valable. L'ordre, lui — qui **est** la priorité de reconnaissance —
 * tient en une seule ligne.
 */
type Reader = (code: string, i: number, s: LangSpec, isSql: boolean) => Step | null;

function step(type: TokenType, value: string, next: number): Step {
  return { token: { type, value }, next };
}

/** Un identifiant commence-t-il par une majuscule ? Convention de type. */
function looksLikeType(word: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(word) && word.length > 1;
}

/** Commentaire de fin de ligne : il s'arrête au saut, ou à la fin du fichier. */
function readLineComment(code: string, i: number, s: LangSpec): Step | null {
  const marker = s.lineComment?.find((c) => code.startsWith(c, i));
  if (!marker) return null;
  const end = code.indexOf("\n", i);
  const stop = end === -1 ? code.length : end;
  return step("comment", code.slice(i, stop), stop);
}

/** Commentaire multi-lignes : fermé ou non, jamais tronqué au hasard. */
function readBlockComment(code: string, i: number, s: LangSpec): Step | null {
  if (!s.blockComment || !code.startsWith(s.blockComment[0], i)) return null;
  const [open, close] = s.blockComment;
  const at = code.indexOf(close, i + open.length);
  const stop = at === -1 ? code.length : at + close.length;
  return step("comment", code.slice(i, stop), stop);
}

/** Chaîne multi-lignes Python : testée **avant** les guillemets simples. */
function readTriple(code: string, i: number, s: LangSpec): Step | null {
  const q = s.tripleQuotes?.find((t) => code.startsWith(t, i));
  if (!q) return null;
  const at = code.indexOf(q, i + q.length);
  const stop = at === -1 ? code.length : at + q.length;
  return step("string", code.slice(i, stop), stop);
}

/** Chaîne simple : échappements traités, mais pas de retour à la ligne. */
function readString(code: string, i: number, s: LangSpec): Step | null {
  const ch = code[i];
  if (!s.quotes.includes(ch)) return null;

  let j = i + 1;
  while (j < code.length) {
    if (code[j] === "\\") { j += 2; continue; }
    if (code[j] === ch) { j++; break; }
    // Une chaîne ne traverse pas la fin de ligne (sauf template JS).
    if (code[j] === "\n" && ch !== "`") break;
    j++;
  }
  return step("string", code.slice(i, j), j);
}

/** Avance tant que chaque caractère satisfait `test`. */
function takeWhile(code: string, start: number, test: (ch: string) => boolean): number {
  let j = start;
  while (j < code.length && test(code[j])) j++;
  return j;
}

/** Nombres décimaux : entière, puis partie fractionnaire, puis exposant. */
function readDecimal(code: string, start: number): number {
  let j = takeWhile(code, start, (ch) => /[0-9_]/.test(ch));
  if (code[j] === "." && DIGIT.test(code[j + 1] ?? "")) {
    j = takeWhile(code, j + 1, (ch) => /[0-9_]/.test(ch));
  }
  if (/[eE]/.test(code[j] ?? "") && /[0-9+-]/.test(code[j + 1] ?? "")) {
    j = takeWhile(code, j + 2, (ch) => DIGIT.test(ch));
  }
  return j;
}

/** Nombre hexadécimal, binaire ou octal : `0x…`, `0b…`, `0o…`. */
function readRadix(code: string, start: number): number {
  return takeWhile(code, start, (ch) => /[0-9a-fA-F_]/.test(ch));
}

/** Nombre : décimal, radices, séparateurs `_`, décimale, exposant. */
function readNumber(code: string, i: number): Step | null {
  const ch = code[i];
  if (!DIGIT.test(ch)) return null;

  const radix = ch === "0" && /[xXbBoO]/.test(code[i + 1] ?? "");
  const j = radix ? readRadix(code, i + 2) : readDecimal(code, i);
  return step("number", code.slice(i, j), j);
}

/**
 * La famille du mot, et non sa lecture.
 *
 * Extraite parce qu'elle répond **quatre** questions distinctes — mot-clé,
 * fonction native, type, nom ordinaire — et que leur ordre est un choix : les
 * natives passent avant la convention « majuscule = type », sinon `COUNT` et
 * `List` seraient coloriées comme des classes alors qu'elles sont des
 * fonctions.
 */
function wordType(word: string, following: string, s: LangSpec, isSql: boolean): TokenType {
  if (isSql ? SQL_UPPER.has(word.toUpperCase()) : s.keywords.has(word)) return "keyword";

  if (isSql ? SQL_BUILTIN_UPPER.has(word.toUpperCase()) : (s.builtins?.has(word) ?? false)) {
    return "function";
  }

  // Le mot suivant peut-il être un type ? `class Foo`, `struct Bar`…
  if (s.typeIntroducers.some((t) => following.startsWith(t + " ")) || looksLikeType(word)) {
    return "type";
  }

  if (following.startsWith("(")) return "function";
  return "plain";
}

/** Identifiant ou mot-clé, à partir de la position courante. */
function readWord(code: string, i: number, s: LangSpec, isSql: boolean): Step | null {
  if (!IDENT_START.test(code[i])) return null;

  let j = i;
  while (j < code.length && IDENT_PART.test(code[j])) j++;

  // Le mot qui suit, sans les espaces : c'est lui qui dit si l'on est
  // devant un type ou devant un appel.
  let k = j;
  while (k < code.length && (code[k] === " " || code[k] === "\t")) k++;

  const word = code.slice(i, j);
  return step(wordType(word, code.slice(k), s, isSql), word, j);
}

/** Ponctuation et opérateurs : un caractère, sans ambiguïté. */
function readPunct(code: string, i: number): Step | null {
  if (!OPERATORS.includes(code[i])) return null;
  return step("punct", code[i], i + 1);
}

/**
 * Espaces : regroupés, pour qu'un fichier de mille lignes ne produise pas
 * un jeton par caractère d'indentation.
 */
function readSpace(code: string, i: number): Step | null {
  const ch = code[i];
  if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") return null;

  let j = i;
  while (j < code.length && /[ \t\r]/.test(code[j])) j++;
  if (code[j] === "\n") return step("plain", code.slice(i, j + 1), j + 1);
  return step("plain", code.slice(i, j), j);
}

/**
 * L'ordre **est** la priorité de reconnaissance : commentaire avant chaîne
 * (un `//` à l'intérieur d'une expression rationnelle), chaîne multi-lignes
 * avant guillemet simple (`"""`), mot avant ponctuation (`_`), etc.
 * Déplacer une entrée change le coloriage, jamais l'architecture.
 */
const READERS: Reader[] = [
  readLineComment,
  readBlockComment,
  readTriple,
  readString,
  readNumber,
  readWord,
  readPunct,
  readSpace,
];

/**
 * Découpe `code` en jetons pour le langage donné.
 *
 * Le scanner est linéaire et ne cherche jamais en arrière : à chaque
 * position, les lecteurs sont essayés dans l'ordre jusqu'au premier qui
 * reconnaît quelque chose, puis on avance. C'est suffisant pour de la
 * coloration — un coloriage imparfait reste un coloriage, alors qu'une
 * régression casse l'affichage.
 *
 * Ce n'est pas une liste `if/else if` : c'est un tableau de fonctions de
 * quelques lignes chacune. Un scanner en une seule fonction atteignait une
 * complexité cyclomatique de 59 — les huit cas, leurs variantes SQL, leurs
 * sous-cas numériques et leurs terminaisons s'additionnaient dans un même
 * corps, impossible à relire ou à tester à part. Découpé ainsi, chaque
 * lecteur se lit seul, et `test:highlight` vérifie l'ensemble inchangé.
 */
export function highlight(code: string, lang: string): Token[] {
  const key = normalizeLang(lang);
  const s = LANGS[key];
  const tokens: Token[] = [];

  if (!s) {
    return code ? [{ type: "plain", value: code }] : [];
  }

  const isSql = key === "sql";

  for (let i = 0; i < code.length; ) {
    let read: Step | null = null;
    for (const reader of READERS) {
      read = reader(code, i, s, isSql);
      if (read) break;
    }

    // Rien n'a reconnu la position : on émet le caractère en clair et on
    // avance. C'est la garantie de ne jamais rester bloqué dessus — sans
    // elle, un caractère inconnu transformerait la boucle en boucle
    // infinie.
    if (!read) {
      if (code[i]) tokens.push({ type: "plain", value: code[i] });
      i++;
      continue;
    }

    if (read.token.value) tokens.push(read.token);
    i = read.next;
  }

  return tokens;
}

/**
 * Regroupe les jetons en lignes, en conservant les sauts de ligne.
 * Le rendu a besoin de cette segmentation pour les numéros de ligne et pour
 * colorer chaque ligne indépendamment.
 */
export function toLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];

  for (const tk of tokens) {
    const parts = tk.value.split("\n");
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ type: tk.type, value: part });
    });
  }

  return lines;
}