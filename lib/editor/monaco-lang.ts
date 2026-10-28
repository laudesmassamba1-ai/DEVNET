/**
 * Monaco : langage déduit d'un chemin, et thème DevNet.
 *
 * ## Pourquoi un fichier séparé
 *
 * `components/MonacoCodeEditor.tsx` est un composant client : il ne peut
 * pas tourner en Node, donc il ne peut pas être testé par une suite de
 * `scripts/`. La table de correspondance chemin → langage, elle, est
 * **pure** : une extension, une chaîne. La garder ici, c'est pouvoir
 * prouver que `.tsx` donne bien `typescript` sans ouvrir un navigateur —
 * un langage mal reconnu ne lève aucune erreur, il colorie simplement
 * faux, et c'est exactement le genre de régression qui ne se voit pas.
 *
 * ## Une seconde table, et pourquoi
 *
 * `lib/highlight.ts` a déjà sa propre table, orientée **coloration
 * maison** (13 langages, libellés humains « C / C++ »). Monaco attend des
 * **identifiants** (`cpp`, `plaintext`) et connaît une centaine de
 * langages. Réutiliser `guessLanguage` produirait « C / C++ », que Monaco
 * ne reconnaît pas — d'où une table distincte, orientée identifiants.
 */

/** Extension (sans point, en minuscules) → identifiant de langage Monaco. */
const BY_EXT: Record<string, string> = {
  py: "python",
  pyw: "python",
  pyi: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  vue: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  sql: "sql",
  psql: "sql",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  dart: "dart",
  swift: "swift",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  xml: "xml",
  svg: "xml",
  lua: "lua",
  r: "r",
  pl: "perl",
  txt: "plaintext",
  log: "plaintext",
};

/**
 * L'identifiant Monaco d'un chemin de fichier.
 *
 * `plaintext` plutôt que `""` : Monaco retombe de toute façon sur du texte
 * brut, mais un identifiant explicite se lit et se teste ; une chaîne vide
 * donnerait un « langage vide » qui ne dit pas la même chose.
 */
export function monacoLanguage(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  return BY_EXT[name.slice(dot + 1).toLowerCase()] ?? "plaintext";
}

/** Langages pour lesquels Monaco offre une **vraie** analyse (pas qu'une coloration). */
const INTELLISENSE = new Set([
  "javascript",
  "typescript",
  "json",
  "html",
  "css",
  "scss",
  "less",
]);

/**
 * Monaco a-t-il un service de langage pour ce fichier ?
 *
 * L'information sert à annoncer ce qu'on tient : un fichier TypeScript
 * bénéficie de la complétion, des erreurs et du survol **du vrai
 * compilateur TypeScript** (embarqué par Monaco), tandis qu'un fichier Go
 * ne reçoit que de la coloration et une complétion de mots. Promettre
 * l'analyse partout serait faux.
 */
export function hasIntelliSense(path: string): boolean {
  return INTELLISENSE.has(monacoLanguage(path));
}

/**
 * Le nom du thème DevNet dans Monaco.
 *
 * Il est défini dans `MonacoCodeEditor` (avant le premier rendu de
 * l'éditeur) à partir des couleurs de `globals.css`, transposées en
 * littéraux — Monaco ne sait pas lire une variable CSS. Garder la table
 * ici permet à un test de vérifier que chaque couleur attendue y est.
 */
export const DEVNET_THEME_NAME = "devnet-liquid";

/**
 * Le thème, en données pures.
 *
 * `base` reste `vs-dark` et `inherit: true` : on ne redéfinit que ce qui
 * porte l'identité DevNet (fond encre, ambre/vert/rose des jetons), et on
 * hérite du reste — réécrire chaque règle de Monaco à la main donnerait
 * un thème qui dérive à chaque version de l'éditeur.
 */
export const DEVNET_THEME = {
  base: "vs-dark" as const,
  inherit: true,
  rules: [
    { token: "", foreground: "E9EDF8", background: "0A0E1A" },
    { token: "comment", foreground: "96A0AB", fontStyle: "italic" },
    { token: "keyword", foreground: "FF9E64" },
    { token: "keyword.control", foreground: "FF9E64" },
    { token: "string", foreground: "8FF25C" },
    { token: "number", foreground: "FFC46B" },
    { token: "type", foreground: "FFD166" },
    { token: "type.identifier", foreground: "FFD166" },
    { token: "identifier", foreground: "E9EDF8" },
    { token: "function", foreground: "C9A0E8" },
    { token: "delimiter", foreground: "A8B1BA" },
    { token: "operator", foreground: "A8B1BA" },
    { token: "tag", foreground: "FF9E64" },
    { token: "attribute.name", foreground: "FFD166" },
    { token: "attribute.value", foreground: "8FF25C" },
    { token: "variable", foreground: "E9EDF8" },
    { token: "constant", foreground: "FFC46B" },
  ],
  colors: {
    "editor.background": "#0A0E1A",
    "editor.foreground": "#E9EDF8",
    "editorCursor.foreground": "#16A34A",
    "editor.lineHighlightBackground": "#12182B",
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": "#16A34A55",
    "editor.inactiveSelectionBackground": "#16A34A33",
    "editor.selectionHighlightBackground": "#16A34A22",
    "editorLineNumber.foreground": "#4A5568",
    "editorLineNumber.activeForeground": "#8FF25C",
    "editorIndentGuide.background1": "#1E2536",
    "editorIndentGuide.activeBackground1": "#2E3A52",
    "editorBracketHighlight.foreground1": "#FF9E64",
    "editorBracketHighlight.foreground2": "#8FF25C",
    "editorBracketHighlight.foreground3": "#C9A0E8",
    "editorBracketHighlight.unexpectedBracket.foreground": "#DC2626",
    "editorGutter.background": "#0A0E1A",
    "editorGutter.modifiedBackground": "#16A34A",
    "editorWidget.background": "#101828",
    "editorWidget.border": "#2E3A52",
    "editorSuggestWidget.background": "#101828",
    "editorSuggestWidget.selectedBackground": "#1E2B45",
    "editorSuggestWidget.highlightForeground": "#8FF25C",
    "editorHoverWidget.background": "#101828",
    "editorHoverWidget.border": "#2E3A52",
    "editorError.foreground": "#DC2626",
    "editorWarning.foreground": "#FFC46B",
    "editorInfo.foreground": "#3B8CFF",
    "editorOverviewRuler.border": "#00000000",
    "scrollbarSlider.background": "#2E3A5288",
    "scrollbarSlider.hoverBackground": "#3B8CFF88",
    "scrollbarSlider.activeBackground": "#16A34A99",
    "minimap.background": "#0A0E1A",
  },
};
