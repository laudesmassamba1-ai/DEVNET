/**
 * Exécution du code — choix du moteur et garde-fous.
 *
 * ## Pourquoi dans le navigateur
 *
 * Un exécuteur distant, c'est un serveur à provisionser, à payer et à
 * durcir : chaque projet de coding club devient un conteneur à sandboxer,
 * donc une surface d'attaque permanente, gérée par une équipe qui n'a pas
 * le métier. Exécuter sur l'appareil retire le problème *entièrement* :
 *
 * - aucun code d'un membre ne s'exécute chez nous, donc rien à isoler ;
 * - aucun coût par exécution, donc rien à freiner ;
 * - ça marche hors ligne, ce qui compte quand la connexion est le premier
 *   obstacle à l'apprentissage ;
 * - les erreurs restent locales : une boucle infinie est un onglet bloqué, pas
 *   un service en production.
 *
 * ## Plusieurs moteurs, un seul choix automatique
 *
 * On ne peut pas exécuter « tous les langages » avec un seul runtime. On
 * en a donc plusieurs, et `runtimeForPath` choisit **automatiquement**
 * celui qui sait faire tourner le fichier ouvert :
 *
 * - **Pyodide** — Python, compilé en WebAssembly, avec sa bibliothèque
 *   standard et l'entrée standard ;
 * - **Sandpack** — le moteur JavaScript/TypeScript historique (évaluation
 *   `require` multi-fichiers) ;
 * - **WASI** — un interpréteur WebAssembly WASI par langage (C, C++, Ruby,
 *   PHP, SQL, QuickJS), chargé à la demande (voir `wasi.ts`).
 *
 * Ajouter un langage ne coûte alors qu'une entrée dans le catalogue.
 */

/** Les moteurs disponibles. `aucun` n'en est pas un : c'est « rien à faire ». */
export type Runtime = "pyodide" | "sandpack" | "wasi" | "aucun";

/**
 * Les programmes WASI réellement disponibles auprès de Runno.
 *
 * `clang` compile **et** lie le C ; `clangpp` fait de même pour le C++ ;
 * `php-cgi` exécute du PHP ; `ruby` du Ruby ; `sqlite` du SQL ; `quickjs`
 * du JavaScript isolé (utilisé comme secours).
 */
export type WasiRuntime =
  | "quickjs"
  | "sqlite"
  | "ruby"
  | "php-cgi"
  | "clang"
  | "clangpp";

export interface RuntimeSpec {
  id: Runtime;
  label: string;
  extension: string;
  /**
   * Fichiers bootstrap — pour la création d'un nouveau fichier.
   *
   * Volontairement minimal : un « ça marche » exécutable, pas un cours.
   */
  bootstrap: string;
  /** Exécution réelle ou simple rendu ? */
  executes: boolean;
  /** Moteur WASI : le programme Runno à lancer (absent sinon). */
  wasi?: WasiRuntime;
  /** Nom de fichier d'entrée caractéristique, pour « exécuter le projet ». */
  entry: string;
}

/**
 * Catalogue des runtimes, **par langage**.
 *
 * Les clés sont les noms canoniques (`python`, `javascript`, `c`…). La
 * correspondance extension → langage vit dans `KNOWN`, plus bas : plusieurs
 * extensions pointent souvent vers le même langage (`js`, `jsx`, `mjs`).
 */
export const RUNTIMES: Record<string, RuntimeSpec> = {
  python: {
    id: "pyodide",
    label: "Python",
    extension: "py",
    executes: true,
    entry: "main.py",
    bootstrap:
      "# Installe les paquets avec : await pyodide.loadPackage('micropip')\nprint(\"ça marche\")\n",
  },
  javascript: {
    id: "sandpack",
    label: "JavaScript",
    extension: "js",
    executes: true,
    entry: "main.js",
    bootstrap: "// F12 → Console pour voir la sortie\nconsole.log(\"ça marche\");\n",
  },
  typescript: {
    id: "sandpack",
    label: "TypeScript",
    extension: "ts",
    executes: true,
    entry: "main.ts",
    bootstrap: "const message: string = \"ça marche\";\nconsole.log(message);\n",
  },
  c: {
    id: "wasi",
    wasi: "clang",
    label: "C",
    extension: "c",
    executes: true,
    entry: "main.c",
    bootstrap:
      "#include <stdio.h>\n\nint main(void) {\n    printf(\"ça marche\\n\");\n    return 0;\n}\n",
  },
  cpp: {
    id: "wasi",
    wasi: "clangpp",
    label: "C++",
    extension: "cpp",
    executes: true,
    entry: "main.cpp",
    bootstrap:
      "#include <iostream>\n\nint main() {\n    std::cout << \"ça marche\\n\";\n    return 0;\n}\n",
  },
  ruby: {
    id: "wasi",
    wasi: "ruby",
    label: "Ruby",
    extension: "rb",
    executes: true,
    entry: "main.rb",
    bootstrap: "puts \"ça marche\"\n",
  },
  php: {
    id: "wasi",
    wasi: "php-cgi",
    label: "PHP",
    extension: "php",
    executes: true,
    entry: "main.php",
    bootstrap: "<?php\n\necho \"ça marche\\n\";\n",
  },
  sql: {
    id: "wasi",
    wasi: "sqlite",
    label: "SQL",
    extension: "sql",
    executes: true,
    entry: "main.sql",
    bootstrap:
      "create table notes(valeur);\ninsert into notes values ('ça marche');\nselect valeur from notes;\n",
  },
};

/**
 * Extensions et alias → langage canonique.
 *
 * Sert à la fois à `runtimeFor` (nom de langage) et à `runtimeForPath`
 * (extension). Une extension absente ici n'a **pas** de moteur : c'est ce
 * qui fait que `README.md` ou une image ne proposent pas « exécuter ».
 */
const KNOWN: Record<string, string> = {
  py: "python",
  python: "python",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  "c++": "cpp",
  hpp: "cpp",
  hxx: "cpp",
  hh: "cpp",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  sql: "sql",
  sqlite: "sql",
};

/** Le moteur d'un langage, ou `null` s'il n'y en a pas. */
export function runtimeFor(language: string): RuntimeSpec | null {
  const key = language.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(RUNTIMES, key)) return RUNTIMES[key];

  const canonical = KNOWN[key];
  if (!canonical) return null;
  return RUNTIMES[canonical] ?? null;
}

/** Le moteur déduit d'un chemin de fichier. */
export function runtimeForPath(path: string): RuntimeSpec | null {
  const i = path.lastIndexOf(".");
  if (i === -1) return null;
  return runtimeFor(path.slice(i + 1));
}

/**
 * Le code source consomme-t-il l'entrée standard ?
 *
 * On ne se fie pas au seul langage : un fichier Python sans `input()`, un
 * Ruby sans `gets` ne demandent rien, et leur champ « entrées » serait un
 * formulaire sans objet. Le champ n'apparaît donc que si le **texte** lu
 * utilise vraiment l'entrée.
 *
 * Détection volontairement grossière — une expression régulière par langage,
 * sans analyse syntaxique. Un motif cité dans un commentaire ou une chaîne
 * déclencherait le champ à tort, au pire : un champ de trop se ferme, une
 * saisie manquante bloque. SQL fait exception : son programme *est* le
 * fichier, la saisie n'y a aucun effet.
 */
export function codeReadsStdin(spec: RuntimeSpec | null, code: string): boolean {
  if (!spec) return false;

  if (spec.id === "pyodide") {
    // Même détection que `pythonUsesInput` (lib/execution/engine.ts).
    return /(^|[^\w.])input\s*\(/.test(code);
  }

  if (spec.id === "wasi") {
    switch (spec.wasi) {
      case "ruby":
        return /(\bgets\b|\bSTDIN\b|\breadline\b|\$stdin\b|\bARGF\b)/.test(code);
      case "php-cgi":
        return /(\bSTDIN\b|\bfgets\s*\(|\bfgetc\s*\(|\breadline\s*\(|php:\/\/stdin)/i.test(code);
      case "clang":
      case "clangpp":
        return /(\bscanf\b|\bgetchar\b|\bfgets\b|\bgets\b|\bgetline\b|\bcin\b|\bstdin\b)/.test(code);
      default:
        // quickjs (JS isolé) et sqlite : aucune saisie interactive.
        return false;
    }
  }

  // Sandpack (JavaScript/TypeScript) : pas de terminal, pas d'entrée standard.
  return false;
}

export interface Limits {
  /** Temps d'exécution maximal. */
  timeoutMs: number;
  /** Sortie tronquée au-delà de ce nombre de caractères. */
  maxOutput: number;
  /** Taille maximale d'un fichier enregistrable, en octets. */
  maxFileBytes: number;
  /** Nombre maximal de fichiers dans un projet. */
  maxFiles: number;
}

/**
 * Garde-fous.
 *
 * Sur un navigateur, « runaway » ne veut pas dire « coût pour le serveur »
 * mais « onglet gelé ». D'où des limites volontairement basses : mieux vaut
 * un message clair qu'une page unresponsive qu'on doit recharger.
 */
export const LIMITS: Limits = {
  timeoutMs: 10_000,
  maxOutput: 200_000,
  maxFileBytes: 512 * 1024,
  maxFiles: 200,
};

/** Message affiché quand une sortie dépasse la limite. */
export function truncationNotice(output: string): string | null {
  return output.length > LIMITS.maxOutput
    ? `Sortie tronquée à ${LIMITS.maxOutput.toLocaleString("fr-FR")} caractères.`
    : null;
}

/** LANGAGES proposés dans l'UI : ceux qui s'exécutent, d'abord. */
export const EXECUTABLE_LANGUAGES = [
  "Python",
  "JavaScript",
  "TypeScript",
  "C",
  "C++",
  "Ruby",
  "PHP",
  "SQL",
] as const;

/**
 * L'étiquette lisible d'un moteur.
 *
 * `pyodide`, `sandpack` et `wasi` sont des noms d'implémentation : les
 * afficher tels quels parlerait de la plomberie, pas du langage que la
 * personne a écrit.
 */
const ENGINE_LABELS: Record<Runtime, string> = {
  pyodide: "Python",
  sandpack: "JavaScript",
  wasi: "WASI",
  aucun: "aucun",
};

export function engineLabel(engine: Runtime): string {
  return ENGINE_LABELS[engine] ?? engine;
}

/**
 * Les langages WASI que le worker sait construire.
 *
 * Sert aux tests et à l'UI pour savoir si un runtime WASI est demandé sans
 * importer tout l'adaptateur.
 */
export function isWasiLanguage(value: unknown): value is WasiRuntime {
  return (
    value === "quickjs" ||
    value === "sqlite" ||
    value === "ruby" ||
    value === "php-cgi" ||
    value === "clang" ||
    value === "clangpp"
  );
}
