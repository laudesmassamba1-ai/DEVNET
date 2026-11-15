import type { FileMap } from "./engine";

/**
 * La compilation TypeScript, côté interface.
 *
 * ## Pourquoi un vrai compilateur, et pas un stripper
 *
 * `const x: string = "a"` est une erreur de syntaxe pour un navigateur.
 * La tentation est de retirer les annotations avec une expression
 * régulière : c'est rapide, ça tient en dix lignes, et c'est faux. Une
 * suppression naïve casse les génériques (`Array<T>`), les `as`, les
 * `enum` (qui ont un **rendu runtime**), les membres de classe et les
 * imports de types — et produit un programme qui *paraît* tourner puis
 * se trompe, ce que le projet refuse ailleurs.
 *
 * On utilise donc le compilateur `typescript` déjà installé, chargé par
 * `import()` dynamique : il ne pèse sur personne tant qu'on n'exécute pas
 * de TypeScript, et il fonctionne **hors ligne** puisque le chunk est
 * servi par l'application elle-même.
 *
 * `transpileModule` ne vérifie pas les types : il compile fichier par
 * fichier, vite, sans projet ni `tsconfig`. C'est exactement ce qu'on
 * veut ici — un exécuteur ne doit pas reprocher un `string | number` mal
 * placé avant même d'avoir montré la première ligne de sortie.
 */

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/** Ce chemin est-il du TypeScript ? */
export function isTypeScriptPath(path: string): boolean {
  const lower = path.toLowerCase();
  return TS_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Faut-il transpiler pour exécuter ce fichier ?
 *
 * Oui si le fichier visé est du TypeScript, mais aussi si un voisin
 * l'est : un `main.js` qui importe `./outils` où vit `outils.ts` a
 * besoin que `outils.ts` soit compilé, sinon le chargeur du worker ne
 * trouverait que du TypeScript impossible à évaluer.
 */
export function projectNeedsTranspile(path: string, files?: FileMap): boolean {
  if (isTypeScriptPath(path)) return true;
  if (!files) return false;
  return Object.keys(files).some(isTypeScriptPath);
}

export interface Transpiled {
  /** Le fichier visé, compilé. */
  code: string;
  /** Le projet entier, avec chaque fichier TypeScript compilé. */
  files: FileMap | undefined;
}

/**
 * Compile le fichier visé et tout le projet.
 *
 * Les options visent le **navigateur**, pas Node :
 *
 * - `module: CommonJS` — le chargeur du worker implémente `require`,
 *   donc `import`/`export` doivent produire `require`/`exports` ;
 * - `target: ES2020` — assez récent pour ne pas alourdir la sortie,
 *   assez sûr pour les navigateurs visés ;
 * - `esModuleInterop` — pour qu'un `import x from "…"` d'un module
 *   CommonJS se comporte comme on l'attend ;
 * - `jsx: React` — un `.tsx` compile, et échoue honnêtement à
 *   l'exécution si `React` n'est pas dans la portée, plutôt que de
 *   laisser du JSX que le navigateur ne comprend pas.
 */
export async function transpileForRun(
  path: string,
  code: string,
  files?: FileMap,
): Promise<Transpiled> {
  const ts = await import("typescript");

  const compilerOptions: import("typescript").CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    jsx: ts.JsxEmit.React,
    sourceMap: false,
    inlineSourceMap: false,
    removeComments: false,
  };

  const compile = (name: string, source: string): string => {
    if (!isTypeScriptPath(name)) return source;
    return ts.transpileModule(source, {
      compilerOptions,
      fileName: name,
      reportDiagnostics: false,
    }).outputText;
  };

  const nextCode = compile(path, code);

  let nextFiles = files;
  if (files) {
    nextFiles = {};
    for (const [name, source] of Object.entries(files)) {
      nextFiles[name] = compile(name, source);
    }
  }

  return { code: nextCode, files: nextFiles };
}
