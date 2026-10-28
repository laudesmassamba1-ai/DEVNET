/**
 * L'exécution, noyau pur.
 *
 * Ce module ne connaît ni le navigateur, ni le réseau, ni le worker : il
 * ne fait que calculer. C'est ce qui permet de le tester en Node, sans
 * rien télécharger (voir `scripts/test-execution.ts`).
 *
 * ## Une seule source, deux mondes
 *
 * Le worker ne peut pas importer ce module : on le construit à partir
 * d'une **chaîne**. Recopier les helpers dans cette chaîne par
 * `fonction.toString()` est tentant, mais faux en pratique : les
 * compilateurs (esbuild, SWC) renomment les fonctions, injectent des
 * appels `__name(...)` et transforment parfois une fonction en
 * expression anonyme — autant de choses qui cassent la chaîne après un
 * build, jamais en développement.
 *
 * Les helpers sont donc écrits **une fois**, dans `ENGINE_SOURCE`, du
 * JavaScript autonome. Le fil principal l'évalue avec `new Function` pour
 * obtenir ses fonctions ; le worker reçoit la même chaîne. Il ne peut pas
 * y avoir de dérive entre les deux : c'est le même texte.
 *
 * `ENGINE_SOURCE` est un `String.raw` : les antislashs (`\s`, `\\`, `\n`
 * littéraux) sont conservés tels quels. Le corps n'utilise ni gabarit
 * inversé ni interpolation, pour ne pas interférer avec le gabarit qui le
 * porte.
 */

/** Une sortie capturée : le texte, et s'il a été coupé. */
export type ConsoleSink = {
  log: (text: string) => void;
  warn: (text: string) => void;
  error: (text: string) => void;
};

/** Un fichier du dépôt, par son chemin. */
export type FileMap = Record<string, string>;

/** La forme des helpers, pour typer ce que `new Function` renvoie. */
type Engine = {
  createBuffer: () => { text: string; truncated: boolean };
  appendOutput: (
    buffer: { text: string; truncated: boolean },
    text: string,
    maxOutput: number,
  ) => { text: string; truncated: boolean };
  formatArgs: (args: unknown[]) => string;
  normaliseError: (error: unknown) => string;
  consoleFor: (sink: ConsoleSink) => {
    log: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  normalizeModulePath: (path: string) => string;
  resolveModule: (spec: string, fromPath: string, files: FileMap) => string | null;
  runSource: (code: string, sink: ConsoleSink) => void;
  runModules: (entry: string, files: FileMap, sink: ConsoleSink) => void;
};

/**
 * Le code des helpers, tel quel.
 *
 * Aucun de ces helpers ne référence un symbole du module extérieur : ils
 * ne s'appuient que sur des globales (`Map`, `Object`, `JSON`, `Error`,
 * `Function`). C'est la condition pour que la chaîne reste valide une
 * fois recopiée dans le worker.
 */
export const ENGINE_SOURCE = String.raw`
function createBuffer() {
  return { text: "", truncated: false };
}

function appendOutput(buffer, text, maxOutput) {
  if (buffer.truncated) return buffer;
  // On ajoute un retour à la ligne comme un vrai print, mais on ne le
  // compte pas dans le plafond : un tampon pile à la limite n'est pas coupé.
  const combined = buffer.text + text + "\n";
  if (combined.trimEnd().length <= maxOutput) {
    return { text: combined, truncated: false };
  }
  return { text: combined.slice(0, maxOutput), truncated: true };
}

function formatArgs(args) {
  return args
    .map(function (arg) {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.name + ": " + arg.message;
      if (arg === undefined) return "undefined";
      if (arg === null) return "null";
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch (error) {
        return String(arg);
      }
    })
    .join(" ");
}

function normaliseError(error) {
  let text =
    error instanceof Error ? error.name + ": " + error.message : String(error);
  for (let i = 0; i < 4; i += 1) {
    const stripped = text.replace(/^(?:PythonError|Error):\s*/i, "");
    if (stripped === text) break;
    text = stripped;
  }
  return text;
}

function consoleFor(sink) {
  return {
    log: function () {
      sink.log(formatArgs([].slice.call(arguments)));
    },
    info: function () {
      sink.log(formatArgs([].slice.call(arguments)));
    },
    debug: function () {
      sink.log(formatArgs([].slice.call(arguments)));
    },
    warn: function () {
      sink.warn(formatArgs([].slice.call(arguments)));
    },
    error: function () {
      sink.error(formatArgs([].slice.call(arguments)));
    },
  };
}

function normalizeModulePath(path) {
  const out = [];
  const parts = path.replace(/\\/g, "/").split("/");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function resolveModule(spec, fromPath, files) {
  let base = spec;
  if (spec.charAt(0) === ".") {
    const slash = fromPath.lastIndexOf("/");
    const dir = slash === -1 ? "" : fromPath.slice(0, slash);
    base = dir ? dir + "/" + spec : spec;
  } else if (spec.charAt(0) === "/") {
    base = spec.slice(1);
  }
  const norm = normalizeModulePath(base);
  const candidates = [
    norm,
    norm + ".js",
    norm + ".mjs",
    norm + ".cjs",
    norm + ".jsx",
    norm + ".ts",
    norm + ".tsx",
    norm + "/index.js",
    norm + "/index.mjs",
    norm + "/index.cjs",
    norm + "/index.jsx",
    norm + "/index.ts",
    norm + "/index.tsx",
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    if (Object.prototype.hasOwnProperty.call(files, candidates[i])) {
      return candidates[i];
    }
  }
  return null;
}

function runSource(code, sink) {
  const fn = new Function("console", '"use strict";\n' + code);
  fn(consoleFor(sink));
}

function runModules(entry, files, sink) {
  const cache = new Map();

  function load(path) {
    const key = normalizeModulePath(path);
    const cached = cache.get(key);
    if (cached) return cached.exports;

    const source = files[key];
    if (source === undefined) {
      throw new Error("Module introuvable : « " + path + " ».");
    }

    const mod = { exports: {} };
    // Le cache est posé avant l'exécution : deux fichiers qui s'appellent
    // mutuellement voient un exports encore partiel, comme dans Node.
    cache.set(key, mod);

    function requireFrom(spec) {
      const resolved = resolveModule(spec, key, files);
      if (resolved === null) {
        const disponibles = Object.keys(files).sort().join(", ");
        throw new Error(
          "Module introuvable : « " + spec + " » demandé depuis « " + key + " ». " +
            "Fichiers du projet : " + disponibles + ".",
        );
      }
      return load(resolved);
    }

    try {
      const fn = new Function(
        "console",
        "require",
        "module",
        "exports",
        '"use strict";\n' + source,
      );
      fn(consoleFor(sink), requireFrom, mod, mod.exports);
    } catch (cause) {
      cache.delete(key);
      throw cause;
    }

    return mod.exports;
  }

  load(entry);
}
`;

/**
 * Les fonctions du fil principal.
 *
 * On évalue la même source que le worker recevra : impossible que les
 * deux divergent, puisqu'il n'y a qu'un texte.
 */
function evaluateEngine(): Engine {
  return new Function(
    ENGINE_SOURCE +
      "\nreturn { createBuffer, appendOutput, formatArgs, normaliseError, " +
      "consoleFor, normalizeModulePath, resolveModule, runSource, runModules };",
  )() as Engine;
}

const engine = evaluateEngine();

export const createBuffer = engine.createBuffer;
export const appendOutput = engine.appendOutput;
export const formatArgs = engine.formatArgs;
export const normaliseError = engine.normaliseError;
export const consoleFor = engine.consoleFor;
export const normalizeModulePath = engine.normalizeModulePath;
export const resolveModule = engine.resolveModule;
export const runSource = engine.runSource;
export const runModules = engine.runModules;

/**
 * Le programme Python qui monte le dépôt avant d'exécuter un fichier.
 *
 * Pyodide démarre avec un système de fichiers vide : sans ça, un
 * `import` vers un fichier voisin échoue alors que le fichier existe.
 * On écrit donc tout le dépôt, et on ajoute chaque dossier à `sys.path`,
 * comme le ferait `python` lancé à la racine du projet.
 *
 * Pure : elle produit une chaîne, donc testable sans navigateur. Les
 * littéraux JSON sont, ici, du Python valide — d'où l'absence d'import
 * de `json`.
 */
export function pythonBootstrap(files: FileMap): string {
  const dirs = new Set<string>();
  dirs.add("");
  for (const raw of Object.keys(files)) {
    const norm = normalizeModulePath(raw);
    let cut = norm.lastIndexOf("/");
    while (cut !== -1) {
      const parent = norm.slice(0, cut);
      dirs.add(parent);
      cut = parent.lastIndexOf("/");
    }
  }

  return [
    "import os, sys",
    `_devnet_files = ${JSON.stringify(files)}`,
    `_devnet_paths = ${JSON.stringify([...dirs])}`,
    "for _p, _c in _devnet_files.items():",
    "    _f = os.path.join('.', _p)",
    "    _d = os.path.dirname(_f)",
    "    if _d:",
    "        os.makedirs(_d, exist_ok=True)",
    "    with open(_f, 'w', encoding='utf-8') as _fh:",
    "        _fh.write(_c)",
    "for _p in _devnet_paths:",
    "    if _p and _p not in sys.path:",
    "        sys.path.insert(0, _p)",
  ].join("\n");
}

/**
 * Prépare `input()` pour une exécution sans terminal.
 *
 * Pyodide n'a pas de clavier : sans prise en charge, `input()` lève
 * `OSError: [Errno 29] I/O error`, un message qui ne dit rien à qui
 * apprend. On remplace donc `builtins.input` par une fonction qui puise
 * dans les valeurs fournies par l'utilisateur (une par ligne, dans la
 * bulle de saisie). Le prompt est recopié dans la sortie, comme le
 * ferait un terminal.
 *
 * Si les valeurs sont épuisées, on lève une erreur **qui explique quoi
 * faire** — pas une erreur d'entrée/sortie que personne ne peut relier à
 * un formulaire vide.
 *
 * `print(prompt)` : le prompt s'affiche sur sa **propre ligne**. Un vrai
 * terminal le laisse sans saut de ligne, la frappe se collant à lui
 * (« ton age14 ») — mais ici la saisie est fournie à l'avance, rien n'est
 * recopié à l'écran, et la valeur n'apparaîtrait alors que si le programme
 * la réaffiche. La ligne sépare donc la question de sa réponse.
 */
/**
 * Le code Python appelle-t-il `input()` ?
 *
 * Sert **uniquement** à prévenir : si le champ « Entrées » est vide et que
 * le code attend une saisie, on peut l'annoncer *avant* de lancer, au lieu
 * de laisser l'erreur le faire après coup. L'erreur reste correcte, mais une
 * erreur qu'on peut éviter est une erreur qu'on ne devrait pas avoir à lire.
 *
 * Détection volontairement grossière (une expression régulière, sans
 * analyser les chaînes ni les commentaires) : un `# input()` dans un
 * commentaire déclencherait un avertissement inutile, au pire. Faire mieux
 * demanderait un analyseur Python, pour une décoration d'interface — le
 * rapport n'y est pas.
 */
export function pythonUsesInput(code: string): boolean {
  return /(^|[^\w.])input\s*\(/.test(code);
}

export function pythonStdin(input: string | undefined): string {
  const lines = (input ?? "").replace(/\r\n?/g, "\n").split("\n");
  // Un textarea se termine presque toujours par un saut de ligne : sans ce
  // retrait, chaque saisie gagnerait une ligne vide, qui consommerait un
  // `input()` de trop.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  // Champ laissé vide : aucune valeur, et surtout pas une ligne vide qui
  // ferait croire à un `input()` satisfait.
  if (lines.length === 1 && lines[0] === "") lines.length = 0;
  // Champ vide : on installe quand même le remplacement. Le premier
  // `input()` échouera, mais avec le message qui dit quoi faire, jamais
  // avec l'`OSError` d'origine.

  return [
    "import builtins as _devnet_builtins",
    "_devnet_inputs = " + JSON.stringify(lines),
    "_devnet_index = 0",
    "",
    'def _devnet_input(prompt=""):',
    "    global _devnet_index",
    "    if prompt:",
    "        print(prompt, flush=True)",
    "    if _devnet_index >= len(_devnet_inputs):",
    '        raise RuntimeError("input() attend une saisie : donne les valeurs dans la bulle de saisie (une par ligne).")',
    "    value = _devnet_inputs[_devnet_index]",
    "    _devnet_index += 1",
    "    return value",
    "",
    "_devnet_builtins.input = _devnet_input",
  ].join("\n");
}

