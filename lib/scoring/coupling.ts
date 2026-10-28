/**
 * Couplage : le **graphe** des imports, pas leur nombre.
 *
 * ## Pourquoi remplacer un compteur
 *
 * La version précédente comptait les lignes d'import : `0.6·rampDown(moyenne,
 * 6, 30)`. Le commentaire invoquait Chidamber & Kemerer (1994) — or CK
 * mesure le couplage **entre classes** (CBO), pas le nombre d'imports d'un
 * fichier. Une affirmation fausse dans un commentaire se retourne contre
 * celui qui la signe ; et un compteur de lignes dit surtout qu'un fichier
 * est gros.
 *
 * Ce qui décide si un module est facile à changer n'est pas *combien* il
 * importe, mais **où il se situe dans le graphe** :
 *
 * - un module importé par tout le monde et qui importe peu de choses est
 *   stable — on peut le modifier, sa surface est maîtrisée ;
 * - un module qui importe beaucoup et n'est importé par personne est
 *   **instable** : chaque changement de ses dépendances le casse, et
 *   personne ne le tient. C'est l'**instabilité de Martin**,
 *   `I = Ce / (Ce + Ca)` ;
 * - un **cycle** interdit de compiler, de tester ou de comprendre un
 *   module isolément : c'est le seul défaut de couplage qui soit une faute
 *   franche, et le seul que le compteur ne voyait pas ;
 * - un fichier que **personne n'importe** est du code mort à terme.
 *
 * ## Ce que la résolution fait, et ses limites
 *
 * Seuls les spécifieurs **relatifs** (`./x`, `../y`) sont résolus, contre
 * l'ensemble des fichiers du dépôt, avec les extensions courantes et les
 * `index`. Les paquets externes sont comptés comme externes : on ne note
 * pas la qualité des dépendances d'autrui. Un `require` calculé
 * (`require(dir + "/" + name)`) échappe à l'analyse — c'est dit, plutôt
 * que deviné.
 */

import type { AnalysedSource } from "./lex";
import { maxOf } from "./stats";

/**
 * Alias de chemins, par convention de cadriciel.
 *
 * `@/lib/x` est un chemin **relatif à la racine** du projet. Sans cette
 * table, tout module importé par alias paraissait ne jamais être importé :
 * sur un dépôt Next.js réel, la mesure comptait 147 « fichiers jamais
 * importés » sur 269 — un chiffre qui n'apprenait rien sur le code et tout
 * sur la limite de l'analyse. Les alias sont une convention, donc ils se
 * déclarent : `@/` et `~/` pour Next, Vite et Nuxt.
 */
export const DEFAULT_ALIASES: Record<string, string> = { "@/": "", "~/": "" };

/** Remplace un alias de tête par sa cible, ou renvoie `null`. */
function applyAlias(specifier: string, aliases: Record<string, string>): string | null {
  for (const [prefix, target] of Object.entries(aliases)) {
    if (!specifier.startsWith(prefix)) continue;
    const rest = specifier.slice(prefix.length);
    return target ? `${target}${rest}` : rest;
  }
  return null;
}

/** Référence d'import telle qu'écrite dans le fichier. */
export interface ImportRef {
  /** Spécifieur brut (`./utils`, `react`). */
  specifier: string;
  /** Ligne 1-based. */
  line: number;
}

/**
 * Extrait les spécifieurs d'import d'un fichier.
 *
 * On lit la ligne **d'origine** et non la ligne masquée : le spécifieur est
 * justement dans une chaîne, donc masqué. Le risque — compter un import
 * commenté — est écarté en exigeant que la ligne masquée contienne encore
 * un mot-clé d'import, et que la ligne soit du code.
 */
export function importSpecifiers(src: AnalysedSource): ImportRef[] {
  const out: ImportRef[] = [];
  for (const l of src.lines) {
    if (l.kind !== "code") continue;
    const masked = l.masked;
    const isImport =
      /\bimport\b|\brequire\s*\(|\bfrom\b|\buse\b|#include/.test(masked);
    if (!isImport) continue;

    const patterns: RegExp[] = [
      /\bfrom\s*["']([^"']+)["']/,
      /\bimport\s*\(\s*["']([^"']+)["']/,
      /\brequire\s*\(\s*["']([^"']+)["']/,
      /\bimport\s*["']([^"']+)["']/,
      /#include\s*["']([^"']+)["']/,
      /\buse\s+([\w:]+)\s*;/,
    ];
    for (const rx of patterns) {
      const m = rx.exec(l.text);
      if (m) {
        out.push({ specifier: m[1], line: l.index + 1 });
        break;
      }
    }
    // `from x import y` en Python : le module est un chemin pointé.
    const py = /\bfrom\s+([\w.]+)\s+import\b/.exec(masked);
    if (py) out.push({ specifier: py[1], line: l.index + 1 });
  }
  return out;
}

/** Extensions testées à la résolution, dans l'ordre où TS les essaie. */
const RESOLVE_EXTENSIONS = [
  "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
  ".json", ".py", ".css", ".scss", ".rb", ".php",
];

/** Concatène deux segments de chemin de dépôt (`/`), sans sortir du dépôt. */
function joinPath(dir: string, specifier: string): string {
  const parts = (dir ? dir.split("/") : []).concat(specifier.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") { out.pop(); continue; }
    out.push(p);
  }
  return out.join("/");
}

const dirOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
};

/**
 * Résout un spécifieur vers un fichier du dépôt, ou `null` si c'est un
 * paquet externe. On essaie le chemin tel quel, puis avec chaque extension,
 * puis en `index` — et aussi **sans** son extension d'origine, ce que
 * TypeScript autorise (`import "./x.js"` désignant `x.ts`).
 */
export function resolveImport(
  specifier: string,
  fromPath: string,
  known: ReadonlySet<string>,
  aliases: Record<string, string> = DEFAULT_ALIASES,
): string | null {
  // Un alias se résout depuis la racine du dépôt ; un chemin relatif depuis
  // le fichier. Tout le reste est un paquet externe, qu'on ne juge pas.
  const aliased = applyAlias(specifier, aliases);
  if (aliased === null && !specifier.startsWith(".")) return null;
  const base = aliased !== null
    ? joinPath("", aliased)
    : joinPath(dirOf(fromPath), specifier);

  const withoutExt = base.replace(/\.[^./]+$/, "");
  const candidates = [base, withoutExt];
  for (const stem of [base, withoutExt]) {
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(stem + ext);
    for (const ext of RESOLVE_EXTENSIONS) {
      if (ext) candidates.push(`${stem}/index${ext}`);
    }
  }
  for (const c of candidates) if (known.has(c)) return c;
  return null;
}

export interface CouplingReport {
  /** Arêtes internes (fichier du dépôt → fichier du dépôt). */
  edges: number;
  /** Nombre de fichiers du graphe. */
  nodes: number;
  /** Fichiers pris dans un cycle d'imports. */
  cyclicFiles: number;
  /** Taille du plus grand cycle (0 = graphe acyclique). */
  largestCycle: number;
  /** Instabilité maximale de Martin, parmi les fichiers liés. */
  maxInstability: number;
  /** Instabilité moyenne des fichiers liés (0 si aucun lien). */
  avgInstability: number;
  /** Fichiers de code que **personne** n'importe. */
  orphans: string[];
}

/**
 * Construit le graphe et le résume.
 *
 * Les fichiers sans aucun lien sont exclus du calcul d'instabilité : un
 * module isolé n'est ni stable ni instable, il est hors du graphe, et
 * l'inclure à 0 ferait mécaniquement baisser le maximum.
 */
export function analyseCoupling(
  files: readonly { path: string; source: AnalysedSource }[],
  aliases: Record<string, string> = DEFAULT_ALIASES,
): CouplingReport {
  const known = new Set(files.map((f) => f.path));
  const out = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const f of files) {
    out.set(f.path, new Set());
    incoming.set(f.path, new Set());
  }

  let edges = 0;
  for (const f of files) {
    for (const ref of importSpecifiers(f.source)) {
      const target = resolveImport(ref.specifier, f.path, known, aliases);
      if (!target || target === f.path) continue;
      if (out.get(f.path)!.has(target)) continue;
      out.get(f.path)!.add(target);
      incoming.get(target)!.add(f.path);
      edges++;
    }
  }

  const cyclic = tarjanCycles([...known], out);
  // L'instabilité ne se juge que sur un module dont **quelqu'un dépend**
  // (Ca > 0). Un point d'entrée importe beaucoup et n'est importé par
  // personne : il est à `I = 1` par construction, et c'est correct — le
  // compter reviendrait à reprocher à un `main` d'être un `main`.
  const linked = [...known].filter((p) => incoming.get(p)!.size > 0);
  const instabilities = linked.map((p) => {
    const ce = out.get(p)!.size;
    const ca = incoming.get(p)!.size;
    return ce + ca === 0 ? 0 : ce / (ce + ca);
  });

  // Orphelins : personne ne l'importe **et** ce n'est pas une porte
  // d'entrée. Deux familles de faux positifs sont exclues, délibérément :
  //
  // - les noms de fichier qui sont des points d'entrée par convention
  //   (`index`, `main`, `page`, `route`, `layout`, `__init__`…) ;
  // - les arborescences à **routage par fichiers** (`app/`, `pages/`,
  //   `src/routes/`) : dans un cadriciel, ces fichiers sont chargés par le
  //   routeur, pas par un `import`. Les compter comme jamais importés
  //   reviendrait à reprocher à une page d'être une page.
  const ENTRY_NAME = /(^|\/)(index|main|app|page|layout|route|template|not-found|error|loading|__init__|mod|lib|server|cli|worker)\.[\w]+$/i;
  const FRAMEWORK_ROOT = /^(app|src\/app|pages|src\/pages|routes|src\/routes)\//;
  const orphans = [...known].filter(
    (p) => incoming.get(p)!.size === 0 && !ENTRY_NAME.test(p) && !FRAMEWORK_ROOT.test(p),
  );

  return {
    edges,
    nodes: known.size,
    cyclicFiles: cyclic.files.size,
    largestCycle: cyclic.largest,
    maxInstability: maxOf(instabilities),
    avgInstability: instabilities.length
      ? instabilities.reduce((a, b) => a + b, 0) / instabilities.length
      : 0,
    orphans,
  };
}

/**
 * Composantes fortement connexes (Tarjan), itératif — pas de récursion :
 * un graphe de mille fichiers dépasserait la pile d'appels, exactement le
 * genre de limite silencieuse qui ne se voit qu'en production.
 */
function tarjanCycles(
  nodes: string[],
  out: Map<string, Set<string>>,
): { files: Set<string>; largest: number } {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const files = new Set<string>();
  let counter = 0;
  let largest = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;

    type Frame = { node: string; edges: string[]; cursor: number };
    const frames: Frame[] = [{ node: root, edges: [...(out.get(root) ?? [])], cursor: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);

    while (frames.length) {
      const frame = frames[frames.length - 1];

      if (frame.cursor < frame.edges.length) {
        const next = frame.edges[frame.cursor++];
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter++);
          stack.push(next);
          onStack.add(next);
          frames.push({ node: next, edges: [...(out.get(next) ?? [])], cursor: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }

      // Tous les voisins sont visités : on referme le nœud.
      frames.pop();
      if (frames.length) {
        const parent = frames[frames.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }

      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        const selfLoop =
          component.length === 1 && out.get(component[0])?.has(component[0]);
        if (component.length > 1 || selfLoop) {
          for (const n of component) files.add(n);
          largest = Math.max(largest, component.length);
        }
      }
    }
  }

  return { files, largest };
}
