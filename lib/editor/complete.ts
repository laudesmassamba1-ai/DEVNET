/**
 * L'aide à la saisie de l'éditeur : complétion, indentation, paires.
 *
 * Ces fonctions sont **pures** : elles prennent un texte, un curseur, un
 * langage, et rendent une édition. Aucune ne touche au DOM. C'est ce qui
 * permet de les tester en Node (`scripts/test-editor.ts`) — un éditeur
 * qui « a l'air de marcher » à l'écran mais qui décale le curseur d'un
 * caractère est un éditeur qu'on ne peut pas relire.
 *
 * On ne prétend pas remplacer un serveur de langage : pas de types, pas
 * de résolution de symboles. On propose ce qu'un débutant cherche —
 * les mots-clés du langage et les noms déjà écrits dans le fichier —
 * ce qui couvre la majorité des fautes de frappe sans rien télécharger.
 */

/** Une édition à appliquer : le nouveau texte et la position du curseur. */
export interface Edit {
  text: string;
  caret: number;
}

/** Le mot en cours d'écriture, et où il commence. */
export interface Word {
  prefix: string;
  start: number;
}

/** Ce que la complétion propose. */
export interface Completion {
  prefix: string;
  start: number;
  items: string[];
}

/**
 * Mots-clés et fonctions courantes par langage.
 *
 * Listes volontairement courtes : la complétion puise surtout dans le
 * fichier lui-même. Une liste exhaustive de la bibliothèque standard
 * serait fausse dès la première version et donnerait l'illusion d'un
 * serveur de langage qu'on n'a pas.
 */
const KEYWORDS: Record<string, string[]> = {
  Python: [
    "False", "None", "True", "and", "as", "assert", "async", "await", "break",
    "class", "continue", "def", "del", "elif", "else", "except", "finally",
    "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
    "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
    "print", "input", "len", "range", "enumerate", "zip", "int", "str",
    "float", "bool", "list", "dict", "set", "tuple", "sum", "min", "max",
    "abs", "round", "sorted", "reversed", "open",
  ],
  JavaScript: [
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "do", "switch", "case", "default", "break", "continue", "class", "extends",
    "super", "new", "this", "typeof", "instanceof", "in", "of", "try", "catch",
    "finally", "throw", "async", "await", "yield", "import", "export", "from",
    "console", "document", "window", "Math", "JSON", "Object", "Array", "Promise",
    "Map", "Set", "Number", "String", "Boolean",
  ],
  TypeScript: [
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "class", "interface", "type", "enum", "extends", "implements", "new", "this",
    "public", "private", "protected", "readonly", "static", "as", "keyof",
    "typeof", "in", "of", "try", "catch", "finally", "throw", "async", "await",
    "import", "export", "from", "number", "string", "boolean", "any", "unknown",
    "never", "void", "null", "undefined", "console", "Promise", "Record", "Array",
  ],
};

/** Le préfixe alphanumérique qui se termine au curseur. */
export function wordBeforeCaret(text: string, caret: number): Word {
  const before = text.slice(0, caret);
  const match = /[A-Za-z_$][\w$]*$/.exec(before);
  if (!match) return { prefix: "", start: caret };
  return { prefix: match[0], start: caret - match[0].length };
}

/** Tous les identifiants distincts présents dans le texte. */
export function identifiersIn(text: string): string[] {
  const seen = new Set<string>();
  const pattern = /[A-Za-z_$][\w$]*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) seen.add(match[0]);
  return [...seen];
}

/**
 * Les suggestions pour la position courante.
 *
 * Les mots du langage passent avant ceux du fichier : `for` est plus
 * utile que `format_number_2` quand on tape `fo`. Le dédoublonnage se
 * fait sur le mot entier, pas sur le préfixe, pour ne pas voir `for`
 * deux fois — une fois du langage, une fois du fichier.
 */
export function complete(
  language: string,
  text: string,
  caret: number,
  limit = 8,
): Completion | null {
  const { prefix, start } = wordBeforeCaret(text, caret);
  if (prefix.length === 0) return null;

  const seen = new Set<string>([prefix]);
  const items: string[] = [];

  const consider = (word: string) => {
    if (seen.has(word)) return;
    if (!word.startsWith(prefix)) return;
    seen.add(word);
    items.push(word);
  };

  for (const word of KEYWORDS[language] ?? []) consider(word);
  for (const word of identifiersIn(text)) consider(word);

  if (items.length === 0) return null;
  return { prefix, start, items: items.slice(0, limit) };
}

/**
 * La nouvelle ligne, indentée comme la précédente.
 *
 * En Python, une ligne qui finit par `:` ouvre un bloc : on ajoute un
 * cran, sinon on désaligne le corps du bloc — la cause la plus banale
 * d'`IndentationError` chez un débutant. Même logique pour une accolade
 * ou un crochet ouvert en JavaScript/TypeScript.
 */
export function newlineIndent(
  text: string,
  caret: number,
): Edit {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const line = text.slice(lineStart, caret);
  const trimmed = line.trimEnd();

  let indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  if (/[:([{]$/.test(trimmed)) indent += "  ";

  const insert = `\n${indent}`;
  return {
    text: text.slice(0, caret) + insert + text.slice(caret),
    caret: caret + insert.length,
  };
}

/** Les paires ouvrantes/fermantes qu'on referme automatiquement. */
const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};

/**
 * La frappe d'un caractère ouvrant.
 *
 * Renvoie `null` si le caractère n'ouvre rien. Trois cas :
 *
 * · une sélection est **encadrée** (`(mot)`) plutôt que remplacée ;
 * · le caractère fermant est déjà là — on **saute** par-dessus au lieu
 *   d'écrire un doublon ;
 * · sinon, la paire est insérée et le curseur se place au milieu.
 */
export function typePair(
  text: string,
  start: number,
  end: number,
  char: string,
): Edit | null {
  const close = PAIRS[char];
  if (!close) return null;

  if (start !== end) {
    const wrapped = `${char}${text.slice(start, end)}${close}`;
    return {
      text: text.slice(0, start) + wrapped + text.slice(end),
      caret: start + wrapped.length,
    };
  }

  if (text[start] === close) {
    return { text, caret: start + 1 };
  }

  const inserted = `${char}${close}`;
  return {
    text: text.slice(0, start) + inserted + text.slice(start),
    caret: start + 1,
  };
}

/**
 * Retour arrière entre deux caractères d'une paire : on efface les deux,
 * sinon la moitié de la paire reste orpheline — la plaie de tous les
 * éditeurs qui referment sans savoir défaire.
 */
export function backspacePair(
  text: string,
  start: number,
  end: number,
): Edit | null {
  if (start !== end || start === 0) return null;
  const before = text[start - 1];
  const after = text[start];
  if (PAIRS[before] !== after) return null;
  return {
    text: text.slice(0, start - 1) + text.slice(start + 1),
    caret: start - 1,
  };
}
