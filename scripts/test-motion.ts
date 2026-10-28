/**
 * Non-régression du système de mouvement.
 *
 * Exécuter avec :  npx tsx scripts/test-motion.ts
 *
 * Le projet a une règle simple et stricte : **aucun mouvement ne vit dans
 * un composant**. Les durées et les courbes passent par les jetons de
 * `globals.css`. La raison n'est pas l'esthétique : c'est que
 * `prefers-reduced-motion` ne peut arrêter que ce qu'il peut atteindre.
 * Un `animate-spin` écrit dans un composant fait tourner une animation
 * pour un lecteur qui a demandé l'arrêt du mouvement, et rien ne le
 * signalera.
 *
 * Une deuxième règle, moins visible : une classe d'animation qui n'est
 * *pas définie* ne produit **aucune erreur**. Elle fait simplement
 * rien. C'est le pire genre de bug — silencieux, invisible en
 * relecture, et impossible à rattraper sans le chercher. Ça s'est déjà
 * produit cinq fois d'affilée lors d'une migration vers les jetons
 * (`animate-post-in`, `animate-pane-in`, `animate-msg-in`,
 * `animate-auth-in` et une cinquième).
 *
 * Ce test rend ces deux erreurs impossibles à réintroduire.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

/** Tous les fichiers d'une arborescence, extension filtrée. */
function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

/**
 * Retire les commentaires.
 *
 * Indispensable : `animate-spin` apparaît dans un commentaire d'`Avatar`
 * qui explique précisément pourquoi on lui préfère `mo-spin`. Un audit
 * naïf le signalerait comme une classe morte, et l'audit deviendrait
 * lui-même un faux positif — c'est-à-dire quelque chose qu'on finit par
 * ignorer.
 */
function stripComments(source: string, kind: "tsx" | "css"): string {
  let s = source;
  if (kind === "css") return s.replace(/\/\*[\s\S]*?\*\//g, " ");

  // Commentaires de bloc /* */ puis de ligne //.
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Une URL dans une chaîne (`http://`) contient `//` : on ne coupe que
  // sur un `//` suivi d'un espace ou en fin de ligne, jamais suivi de `/`.
  s = s.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
  return s;
}

const ANIM_CLASS = /\b((?:animate|mo|mode)-[a-z0-9-]+)\b/g;
/** Durées écrites en dur, comme `420ms` ou `0.3s`. */
const HARDCODED_MS = /(?<![\w-])(\d{2,4})\s?ms\b/g;
const HARDCODED_S = /(?<![\w-])(\.\d+|\d\.\d+)\s?s\b/g;

function main() {
  const tsx = [...walk("app", ".tsx"), ...walk("components", ".tsx")].map((p) => ({
    path: p,
    code: stripComments(readFileSync(p, "utf-8"), "tsx"),
  }));

  const cssRaw = readFileSync(join("app", "globals.css"), "utf-8");
  const css = stripComments(cssRaw, "css");

  /* ── 1. Aucune classe d'animation morte ──────────────────────── */

  const defined = new Set<string>();
  for (const m of css.matchAll(/@utility\s+((?:animate|mo|mode)-[a-z0-9-]+)/g)) defined.add(m[1]);
  for (const m of css.matchAll(/\.((?:animate|mo|mode)-[a-z0-9-]+)\s*[,{:[]/g)) defined.add(m[1]);

  const orphans: Record<string, string[]> = {};
  const employees = new Set<string>();

  for (const file of tsx) {
    for (const m of file.code.matchAll(ANIM_CLASS)) {
      const cls = m[1];
      employees.add(cls);
      // Une classe définie dans une feuille Tailwind importée par une
      // autre feuille reste légitime ; on ne juge que ce que le moteur de
      // mouvement du projet définit.
      if (defined.has(cls)) continue;
      (orphans[cls] ??= []).push(file.path);
    }
  }

  check(
    "aucune classe d'animation utilisée sans être définie",
    Object.keys(orphans).length === 0,
    orphans,
  );

  /* ── 1b. Aucune classe d'animation définie sans être employée ── */

  // Le symétrique du contrôle précédent, et il compte autant.
  //
  // Une classe morte ne casse rien : elle ne fait rien, silencieusement.
  // Mais elle laisse croire qu'une grammaire existe — donc qu'un effet
  // est disponible — alors qu'il faudrait l'écrire. C'est ainsi que
  // naissent lesutils « presque finies » qu'on retrouve trois mois plus
  // tard, à moitié utilisées, avec une durée et une courbe déjà choisies
  // et jamais testées.
  //
  // On exclut les classes de mise en forme pures (`pre`, qui est un état
  // interne de `useInView`).
  const exclues = new Set(["mo-pre"]);

  const mortes = [...defined].filter((c) => !employees.has(c) && !exclues.has(c));

  check(
    "aucune classe d'animation définie sans être employée",
    mortes.length === 0,
    mortes,
  );

  /* ── 2. Aucune durée écrite en dur dans un composant ────────── */

  // On tolère les durées qui passent par un jeton : `duration-[var(--d-fast)]`
  // est le motif attendu. Ce qu'on cherche, c'est un nombre seul.
  const hardcoded: Record<string, string[]> = {};
  for (const file of tsx) {
    for (const m of file.code.matchAll(HARDCODED_MS)) {
      // `0ms` et les valeurs résiduelles d'un arrondi ne sont pas des
      // animations ; seuls les deux chiffres d'une durée comptent.
      if (Number(m[1]) < 50) continue;
      (hardcoded[file.path] ??= []).push(m[0]);
    }
    for (const m of file.code.matchAll(HARDCODED_S)) {
      (hardcoded[file.path] ??= []).push(m[0]);
    }
  }

  check(
    "aucune durée d'animation écrite en dur dans un composant",
    Object.keys(hardcoded).length === 0,
    hardcoded,
  );

  /* ── 3. `animate-spin` de Tailwind ne doit pas revenir ────────── */

  const spin: string[] = [];
  for (const file of tsx) {
    // `animate-spin` existe dans Tailwind et ferait tourner un spinner
    // avec sa propre durée, hors des jetons : exactement ce que la règle
    // interdit, et ce que `prefers-reduced-motion` ne peut pas arrêter.
    if (/\banimate-spin\b/.test(file.code)) spin.push(file.path);
  }
  check("pas de animate-spin de Tailwind hors du système de jetons",
    spin.length === 0, spin);

  /* ── 4. Tout mouvement continu est coupé par le reduced-motion ── */

  const reduced = css.slice(css.indexOf("prefers-reduced-motion"));
  check("le fichier CSS déclare une règle prefers-reduced-motion",
    reduced.length > 0);

  // Les classes d'animation infinie doivent figurer dans le bloc qui
  // les coupe. On les prend à la source : `infinite` dans le CSS.
  const continuous = new Set<string>();
  for (const m of css.matchAll(/@utility\s+([a-z0-9-]+)\s*\{[^}]*infinite[^}]*\}/g)) {
    continuous.add(m[1]);
  }

  const notCut = [...continuous].filter((cls) => !reduced.includes(`.${cls}`));
  check("tout mouvement continu est nommé dans prefers-reduced-motion",
    notCut.length === 0, notCut);

  /* ── Rapport ────────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`  ✓ Le mouvement reste dans les jetons — ${defined.size} classes définies et employées\n`);
}

main();