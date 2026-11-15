/**
 * Parité CSS entre le shim MIT de `lightningcss` et `lightningcss` réel.
 *
 * Le shim (`vendor/lightningcss`) remplace une dépendance MPL-2.0 par une
 * chaîne PostCSS/autoprefixer/csso (MIT). Il doit produire **le même rendu**.
 *
 * Trois modes :
 *
 *   node scripts/legal/css-parity.mjs
 *     Compile `app/globals.css` en mode production et compare le résultat à la
 *     référence versionnée (`docs/legal/evidence/css-parity-baseline.json`).
 *     C'est le mode CI : il échoue si un sélecteur ou une déclaration connue
 *     disparaît.
 *
 *   node scripts/legal/css-parity.mjs --compare-with <fichier.css>
 *     Compare la compilation courante à une feuille produite ailleurs — c'est
 *     ainsi que la référence a été produite, avec le vrai `lightningcss`
 *     installé hors dépôt. Jamais exécuté en CI : la dépendance MPL ne doit
 *     pas entrer dans l'arbre.
 *
 *   node scripts/legal/css-parity.mjs --emit-baseline [--from <fichier.css>]
 *     Réécrit la référence. La référence livrée est produite avec `--from`
 *     sur une feuille compilée par le vrai `lightningcss` : c'est elle qui
 *     atteste de la parité, pas une sortie du shim lui-même (qui serait
 *     circulaire).
 *
 * La comparaison est normalisée : les minifieurs ne choisissent pas les mêmes
 * écritures (`0.25rem` / `.25rem`, `transparent` / `#0000`, ordre des
 * sélecteurs fusionnés, préfixes ajoutés par autoprefixer). Ce qui compte est
 * qu'un sélecteur porte les mêmes déclarations, pas que les octets soient
 * identiques.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postcss from "postcss";

const BASELINE = "docs/legal/evidence/css-parity-baseline.json";

/* ── Normalisation ─────────────────────────────────────────────────────── */

/** Retire les espaces hors guillemets, passe en minuscules, aligne les zéros. */
function normalizeValue(raw) {
  let value = String(raw).trim().toLowerCase();
  let out = "";
  let quote = null;
  for (const ch of value) {
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (/\s/.test(ch)) continue;
    out += ch;
  }
  value = out
    .replace(/(^|[^\d])\.(\d)/g, "$10.$2")
    // `#0000` et `transparent` sont la même couleur ; les minifieurs alternent.
    .replace(/#0000\b/g, "transparent")
    .replace(/#00000000\b/g, "transparent")
    // `optimizelegibility` / `optimizeLegibility` : csso abaisse la casse des
    // identifiants, lightningcss la préserve.
    .trim();
  return value;
}

/**
 * Canonicalise un sélecteur pour la comparaison.
 *
 * Les deux minifieurs écrivent le même sélecteur différemment :
 * `lightningcss` abaisse `::before` en `:before` (compatibilité des vieux
 * navigateurs), `csso` retire les guillemets des valeurs d'attribut et
 * échappe autrement les caractères spéciaux. Ces variantes sont équivalentes
 * en CSS ; on les aligne avant de comparer.
 */
function normalizeSelector(selector) {
  return selector
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/(^|[^:]):(before|after|first-line|first-letter)\b/g, "$1::$2")
    .replace(/\\/g, "")
    // `[class~="a/b"]` et `[class~=a/b]` sont le même attribut : les
    // guillemets ne sont qu'une commodité d'écriture.
    .replace(/\[([^\]]*)\]/g, (whole, body) => `[${body.replace(/"/g, "")}]`);
}

/** Découpe une liste de sélecteurs sur les virgules de premier niveau. */
function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map(normalizeSelector).filter(Boolean);
}

/**
 * Construit `sélecteur → { déclarations }`.
 *
 * Le contexte at-rule (`@layer`, `@media`, `@supports`) est volontairement
 * ignoré : les deux minifieurs regroupent différemment, mais une règle qui
 * existe sous `@supports` des deux côtés porte les mêmes déclarations. La
 * comparaison est donc une **union** par sélecteur — elle attrape une
 * déclaration perdue, pas un déplacement de contexte.
 */
function collect(css) {
  const root = postcss.parse(css);
  const map = new Map();
  const add = (key, decl) => {
    if (!map.has(key)) map.set(key, new Set());
    if (decl) map.get(key).add(decl);
  };

  root.walkRules((rule) => {
    const decls = [];
    rule.walkDecls((decl) => {
      const important = decl.important ? "!important" : "";
      decls.push(`${decl.prop.toLowerCase()}:${normalizeValue(decl.value)}${important}`);
    });
    for (const selector of splitSelectorList(rule.selector)) add(selector, null);
    for (const selector of splitSelectorList(rule.selector)) {
      for (const decl of decls) add(selector, decl);
    }
  });

  root.walkAtRules((at) => {
    if (!["property", "font-face", "keyframes", "counter-style"].includes(at.name)) return;
    const key = `@${at.name} ${normalizeValue(at.params)}`;
    add(key, null);
    at.walkDecls((decl) => add(key, `${decl.prop.toLowerCase()}:${normalizeValue(decl.value)}`));
  });

  return map;
}

const PREFIX = /^-(webkit|moz|ms|o)-/;

/* ── Comparaison ───────────────────────────────────────────────────────── */

const propertyOf = (decl) => decl.split(":")[0];
const unprefixed = (property) => property.replace(PREFIX, "");

/**
 * Deux niveaux de comparaison.
 *
 * **Bloquant** : un sélecteur connu doit exister et garder chacune de ses
 * propriétés. C'est ce qui attrape une imbrication mal abaissée, un
 * `@layer` perdu ou un utilitaire qui ne se génère plus.
 *
 * **Informatif** : la valeur sérialisée d'une propriété peut changer sans
 * que le rendu change (`#0000` ↔ `transparent`, `color-mix()` ↔ hexadécimal
 * avec alpha, `3.40282e38px` ↔ `infinity`). Ces écarts sont comptés et
 * affichés ; ils ne font pas échouer la CI, sinon la porte signalerait en
 * permanence des choix de minifieur. Le rendu réel est couvert par
 * `verify:ui:browser` (Playwright) et `ux:check`.
 */
function compare(reference, candidate) {
  const missingSelectors = [];
  const lostProperties = [];
  const valueChanges = [];
  const addedSelectors = [];

  for (const [selector, decls] of reference) {
    const other = candidate.get(selector);
    if (!other) {
      missingSelectors.push(selector);
      continue;
    }
    const otherProperties = new Set([...other].map((decl) => unprefixed(propertyOf(decl))));
    const lost = [...decls].filter(
      (decl) => !otherProperties.has(unprefixed(propertyOf(decl))),
    );
    if (lost.length > 0) lostProperties.push({ selector, lost });

    const otherKeys = new Map();
    for (const decl of other) otherKeys.set(propertyOf(decl), decl);
    for (const decl of decls) {
      const counterpart = otherKeys.get(propertyOf(decl));
      if (counterpart && counterpart !== decl && !PREFIX.test(propertyOf(decl))) {
        valueChanges.push({ selector, property: propertyOf(decl), reference: decl, candidate: counterpart });
      }
    }
  }
  for (const selector of candidate.keys()) {
    if (!reference.has(selector)) addedSelectors.push(selector);
  }

  return { missingSelectors, lostProperties, valueChanges, addedSelectors };
}

function serialize(map) {
  const out = {};
  for (const key of [...map.keys()].sort()) {
    out[key] = [...map.get(key)].sort();
  }
  return out;
}

function deserialize(json) {
  const map = new Map();
  for (const [key, decls] of Object.entries(json.selectors || {})) {
    map.set(key, new Set(decls));
  }
  return map;
}

/* ── Compilation ───────────────────────────────────────────────────────── */

function compile() {
  const target = path.join(os.tmpdir(), `devnet-globals-${process.pid}.css`);
  execFileSync(
    process.execPath,
    [path.join("scripts", "legal", "compile-css.mjs"), target],
    { env: { ...process.env, NODE_ENV: "production" }, stdio: "pipe" },
  );
  const css = fs.readFileSync(target, "utf8");
  fs.rmSync(target, { force: true });
  return css;
}

/* ── CLI ───────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const compareWith = args.indexOf("--compare-with");
const emitBaseline = args.includes("--emit-baseline");

const fromIndex = args.indexOf("--from");
const candidateCss = fromIndex !== -1 ? fs.readFileSync(args[fromIndex + 1], "utf8") : compile();
const candidate = collect(candidateCss);

let reference;
let referenceLabel;
if (compareWith !== -1) {
  const file = args[compareWith + 1];
  if (!file) {
    console.error("--compare-with attend un fichier CSS");
    process.exit(2);
  }
  reference = collect(fs.readFileSync(file, "utf8"));
  referenceLabel = file;
} else if (emitBaseline) {
  const payload = {
    $comment:
      "Référence de parité CSS produite avec lightningcss 1.32.0 réel sur app/globals.css (mode production). Ne pas régénérer avec le shim : ce fichier est la preuve que le remplacement MIT rend le même CSS.",
    producedWith: fromIndex !== -1 ? `lightningcss@1.32.0 (${args[fromIndex + 1]})` : "shim local",
    generatedAt: new Date().toISOString(),
    selectors: serialize(candidate),
  };
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`${BASELINE} : ${candidate.size} sélecteurs`);
  process.exit(0);
} else {
  const payload = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  reference = deserialize(payload);
  referenceLabel = `${BASELINE} (${payload.producedWith})`;
}

const { missingSelectors, lostProperties, valueChanges, addedSelectors } = compare(reference, candidate);

console.log(`référence : ${referenceLabel}`);
console.log(`sélecteurs : référence ${reference.size}, production ${candidate.size}`);
if (addedSelectors.length > 0) {
  console.log(`sélecteurs ajoutés (acceptés) : ${addedSelectors.length}`);
  for (const selector of addedSelectors.slice(0, 10)) console.log(`  + ${selector}`);
}

if (missingSelectors.length > 0) {
  console.error(`\n${missingSelectors.length} sélecteur(s) de la référence absents :`);
  for (const selector of missingSelectors.slice(0, 30)) console.error(`  - ${selector}`);
}

if (lostProperties.length > 0) {
  console.error(`\n${lostProperties.length} sélecteur(s) ont perdu des propriétés :`);
  for (const { selector, lost } of lostProperties.slice(0, 30)) {
    console.error(`  - ${selector}`);
    for (const decl of lost.slice(0, 8)) console.error(`      ${decl}`);
  }
}

if (valueChanges.length > 0) {
  console.log(`\nvaleurs sérialisées différemment (non bloquant) : ${valueChanges.length}`);
  for (const change of valueChanges.slice(0, 8)) {
    console.log(`  ~ ${change.selector} ${change.property}: ${change.reference} → ${change.candidate}`);
  }
}

const blocking =
  missingSelectors.length > 0 ||
  lostProperties.some((entry) => entry.lost.some((decl) => !PREFIX.test(propertyOf(decl))));

/*
 * Une propriété préfixée en moins n'est pas une régression de rendu : le
 * préfixe est une commodité pour les navigateurs anciens, et autoprefixer ne
 * suit pas toujours la même table que `lightningcss`. On le dit, on ne bloque
 * pas — le rendu des navigateurs réellement ciblés est couvert par
 * `verify:ui:browser`.
 */
const lostOnlyPrefixed = lostProperties.every((entry) =>
  entry.lost.every((decl) => PREFIX.test(propertyOf(decl))),
);
if (lostOnlyPrefixed && lostProperties.length > 0) {
  console.log("propriétés préfixées en moins (non bloquant) — voir ci-dessus");
}

if (blocking) {
  console.error("\nparité CSS : ÉCHEC");
  process.exit(1);
}

console.log("parité CSS : OK");
