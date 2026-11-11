/**
 * Scanner statique d'UI/UX — l'analyse **syntaxique** du §1 du protocole.
 *
 *     node scripts/ux-scan.mjs                                   # bilan humain
 *     node scripts/ux-scan.mjs --json m.json --details d.json    # mesures + preuves
 *     node scripts/ux-scan.mjs --baseline ratchet.json           # fige la référence
 *     node scripts/ux-scan.mjs --check ratchet.json              # cliquet : sort en 1 si dégradé
 *
 * ## Pourquoi passer par l'AST et pas par des expressions régulières
 *
 * Une recherche de texte sur du JSX multi-lignes sous-compte : elle ne voit
 * ni les attributs répartis sur plusieurs lignes, ni ce qu'un composant rend
 * sans le dire. `typescript` est déjà une dépendance du projet : on analyse
 * donc les fichiers comme le compilateur, et chaque mesure porte un numéro de
 * ligne vérifiable.
 *
 * ## Ce que le scanner ne sait pas faire
 *
 * Il est **statique** : pas de rendu, donc pas de contraste réel, pas de
 * taille de cible calculée, pas d'ordre de focus, pas de piège au clavier.
 * Ces mesures-là se font au navigateur (`scripts/ux-measure.py`), et le
 * registre dit lesquelles sont ✅ mesurées et ⚠️ à confirmer.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import ts from "typescript";

const ROOT = process.cwd();
const SOURCES = ["app", "components", "hooks"];
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".git"]);

/* ------------------------------------------------------------------ */
/* Parcours des fichiers                                               */
/* ------------------------------------------------------------------ */

function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    if (SKIP.has(entry)) continue;
    const rel = join(dir, entry);
    const full = join(ROOT, rel);
    const st = statSync(full);
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(rel);
  }
  return out;
}

function allFilesUnder(dir, suffix) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      if (SKIP.has(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (entry === suffix) out.push(relative(ROOT, full));
    }
  };
  visit(abs);
  return out;
}

/* ------------------------------------------------------------------ */
/* Utilitaires AST                                                     */
/* ------------------------------------------------------------------ */

const sourceOf = new Map();

function parse(file) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  sourceOf.set(file, sf);
  return { sf, text };
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Les textes littéraux sous un nœud — un `className` peut passer par `cn(...)`. */
function literalsIn(node) {
  const out = [];
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function jsxAttrs(node) {
  // Accepte l'élément complet comme son élément ouvrant.
  const element = ts.isJsxElement(node) ? node.openingElement : node;
  const attrs = new Map();
  for (const attr of element.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    const name = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText();
    attrs.set(name, attr);
  }
  return attrs;
}

function tagNameOf(node) {
  const tag = node.tagName;
  while (ts.isPropertyAccessExpression(tag)) return tag.getText();
  return ts.isIdentifier(tag) ? tag.text : tag.getText();
}

/** Chaîne d'un attribut, si c'est un littéral (direct ou dans une expression). */
function attrText(attr) {
  if (!attr?.initializer) return null;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
    const lits = literalsIn(attr.initializer.expression);
    return lits.length ? lits.join("") : null;
  }
  return null;
}

const hasAttr = (attrs, name) => attrs.has(name);

/** Texte visible d'un élément : JSXText et expressions chaînes, récursivement. */
function textOf(children) {
  let text = "";
  const visit = (n) => {
    if (ts.isJsxText(n)) text += n.containsOnlyTriviaWhiteSpaces ? "" : n.text;
    else if (ts.isStringLiteral(n)) text += n.text;
    else if (ts.isJsxExpression(n)) {
      if (n.expression) ts.forEachChild(n.expression, visit);
    } else if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      // Un enfant composant peut porter son propre texte : on le parcourt aussi,
      // mais ses attributs ne sont pas du texte.
      if (ts.isJsxElement(n)) n.children.forEach(visit);
    }
  };
  for (const c of children ?? []) visit(c);
  return text.replace(/\s+/g, " ").trim();
}

/** Balises qui ne portent jamais de texte lisible (icônes, traits de SVG). */
const SILENT_TAGS = /^(Icon|Spinner|svg|path|circle|rect|line|polyline|polygon|g|defs)$/i;

/**
 * Un bouton a-t-il un contenu visible ? `textOf` ne voyait ni `{c.name}`,
 * ni `{cond ? <span>A</span> : "B"}` : il ne collectait que les nœuds de
 * texte. Résultat : des boutons « Canal #debogage » étaient comptés comme
 * boutons-icônes sans nom — 11 faux positifs sur 16. Ici, une expression
 * rend du texte, sauf si elle ne contient que des icônes, `null` ou `false`.
 */
function hasAnyIcon(children) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = tagNameOf(ts.isJsxElement(n) ? n.openingElement : n);
      if (/^(Icon|Spinner)$/i.test(tag)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, walk);
  };
  for (const c of children ?? []) walk(c);
  return found;
}

function hasVisibleContent(children) {
  let found = false;

  const visit = (n) => {
    if (found || !n) return;
    if (ts.isJsxText(n)) {
      if (!n.containsOnlyTriviaWhiteSpaces && n.text.trim()) found = true;
      return;
    }
    if (ts.isJsxExpression(n)) {
      visit(n.expression);
      return;
    }
    if (ts.isJsxFragment(n)) {
      n.children.forEach(visit);
      return;
    }
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const opening = ts.isJsxElement(n) ? n.openingElement : n;
      if (SILENT_TAGS.test(tagNameOf(opening))) return;
      if (ts.isJsxElement(n)) n.children.forEach(visit);
      // <img>, <input>, <br>… : visibles, sans texte.
      else found = true;
      return;
    }
    if (ts.isStringLiteralLike(n)) {
      if (n.text.trim()) found = true;
      return;
    }
    if (ts.isNumericLiteral(n)) {
      found = true;
      return;
    }
    if (
      n.kind === ts.SyntaxKind.NullKeyword ||
      n.kind === ts.SyntaxKind.TrueKeyword ||
      n.kind === ts.SyntaxKind.FalseKeyword ||
      n.kind === ts.SyntaxKind.UndefinedKeyword
    ) {
      return;
    }
    if (ts.isConditionalExpression(n)) {
      visit(n.whenTrue);
      visit(n.whenFalse);
      return;
    }
    if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      visit(n.left);
      visit(n.right);
      return;
    }
    if (
      ts.isIdentifier(n) ||
      ts.isPropertyAccessExpression(n) ||
      ts.isElementAccessExpression(n) ||
      ts.isTemplateExpression(n) ||
      ts.isCallExpression(n) ||
      ts.isParenthesizedExpression(n)
    ) {
      // `{c.name}`, `{`${x} messages`}`, `{fmt(date)}` : du texte probable.
      if (ts.isParenthesizedExpression(n)) visit(n.expression);
      else found = true;
      return;
    }
    // Reste (opérateurs, littéraux) : on ne conclut pas.
  };

  for (const c of children ?? []) visit(c);
  return found;
}

/* ------------------------------------------------------------------ */
/* Mesures                                                             */
/* ------------------------------------------------------------------ */

const TINY = /\btext-\[(?:9|10|11)px\]/;
const TINY_G = /\btext-\[(?:9|10|11)px\]/g;
const ARBITRARY_G = /\[[^\]\s]+\]/g;
const CSS_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/;
const CSS_COLOR_G = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g;

const METRICS = {
  iconButtonsWithoutLabel: 0,
  fieldsWithoutLabelAssociation: 0,
  buttonsWithoutType: 0,
  nonSemanticClickHandlers: 0,
  blankLinksWithoutRel: 0,
  positiveTabIndex: 0,
  autoFocusUses: 0,
  tinyTextUses: 0,
  hardcodedColors: 0,
  arbitraryValues: 0,
  outlineNone: 0,
  focusVisibleUses: 0,
  errorBoundaries: 0,
  notFoundPages: 0,
  loadingBoundaries: 0,
  globalErrorBoundaries: 0,
  pagesWithMetadata: 0,
  totalPages: 0,
  filesOver800Lines: 0,
  // Compteurs de contexte : ils ne sont pas des défauts, ils disent sur quoi
  // porte un ratio (« 60 champs sans étiquette » sur combien ?).
  fieldsTotal: 0,
  iconButtonsTotal: 0,
  ariaInvalid: 0,
  ariaDescribedBy: 0,
  dialogElements: 0,
};

const details = [];
const offenders = new Map();

function hit(metric, file, sf, node, snippet) {
  METRICS[metric] += 1;
  details.push({ metric, file, line: lineOf(sf, node), snippet: String(snippet).slice(0, 160) });
  if (!offenders.has(metric)) offenders.set(metric, new Map());
  const byFile = offenders.get(metric);
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
}

const LABEL_TAGS = new Set(["input", "textarea", "select"]);
const CLICK_DIVS = new Set(["div", "span", "p", "li", "section", "article", "td", "tr"]);

function scanFile(file) {
  const { sf, text } = parse(file);
  const lines = text.split("\n");
  if (lines.length > 800) METRICS.filesOver800Lines += 1;

  // Les `id` et les `htmlFor` d'un fichier : utile pour l'association étiquette/champ.
  const labelFor = new Set();
  const ids = new Set();
  const buttons = [];

  const visit = (node, ancestors, parentJsx) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      // `ts.forEachChild` descend aussi dans l'élément ouvrant : on ne traite
      // donc que l'élément complet (ou auto-fermant), jamais l'ouvrant seul.
      const el = ts.isJsxElement(node) ? node.openingElement : node;
      const attrs = jsxAttrs(el);
      const tag = tagNameOf(el).toLowerCase();

      for (const attr of el.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const name = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText();
        const value = attrText(attr);
        if (name === "id" && value) ids.add(value);
        if (name === "htmlFor" && value) labelFor.add(value);
      }

      // Les chaînes de classes et de styles de **cet** élément.
      for (const name of ["className", "style"]) {
        const attr = attrs.get(name);
        if (!attr) continue;
        for (const lit of literalsIn(attr)) {
          const tiny = lit.match(TINY_G)?.length ?? 0;
          for (let i = 0; i < tiny; i += 1) hit("tinyTextUses", file, sf, attr, lit);
          const colors = lit.match(CSS_COLOR_G)?.length ?? 0;
          for (let i = 0; i < colors; i += 1) hit("hardcodedColors", file, sf, attr, lit);
          const arbitrary = lit.match(ARBITRARY_G)?.length ?? 0;
          for (let i = 0; i < arbitrary; i += 1) hit("arbitraryValues", file, sf, attr, lit);
          if (/\boutline-none\b/.test(lit)) hit("outlineNone", file, sf, attr, lit);
          const fv = lit.match(/focus-visible:/g)?.length ?? 0;
          for (let i = 0; i < fv; i += 1) hit("focusVisibleUses", file, sf, attr, lit);
        }
      }

      if (hasAttr(attrs, "autoFocus")) hit("autoFocusUses", file, sf, node, tag);

      const tabIndex = attrText(attrs.get("tabIndex"));
      if (tabIndex !== null && Number(tabIndex) > 0) {
        hit("positiveTabIndex", file, sf, node, `<${tag} tabIndex={${tabIndex}}>`);
      }
      const tabIndexExpr = attrs.get("tabIndex")?.initializer;
      if (
        tabIndexExpr &&
        ts.isJsxExpression(tabIndexExpr) &&
        tabIndexExpr.expression &&
        ts.isNumericLiteral(tabIndexExpr.expression) &&
        Number(tabIndexExpr.expression.text) > 0
      ) {
        hit("positiveTabIndex", file, sf, node, `<${tag} tabIndex={${tabIndexExpr.expression.text}}>`);
      }

      if (tag === "button" && !hasAttr(attrs, "type")) hit("buttonsWithoutType", file, sf, node, tag);

      if (hasAttr(attrs, "aria-invalid")) METRICS.ariaInvalid += 1;
      if (hasAttr(attrs, "aria-describedby")) METRICS.ariaDescribedBy += 1;
      if (hasAttr(attrs, "role") && attrText(attrs.get("role")) === "dialog") {
        METRICS.dialogElements += 1;
      }

      // `Link` de Next rend un `<a>` : il compte comme un lien.
      if ((tag === "a" || tag === "link") && attrText(attrs.get("target")) === "_blank") {
        const rel = attrText(attrs.get("rel")) ?? "";
        if (!/noopener|noreferrer/.test(rel)) {
          hit("blankLinksWithoutRel", file, sf, node, text.slice(node.getStart(sf), node.getEnd()).slice(0, 120));
        }
      }

      if (CLICK_DIVS.has(tag) && hasAttr(attrs, "onClick") && !hasAttr(attrs, "role")) {
        hit("nonSemanticClickHandlers", file, sf, node, tag);
      }

      if (LABEL_TAGS.has(tag)) {
        const type = attrText(attrs.get("type"));
        const hidden = type === "hidden";
        if (!hidden) METRICS.fieldsTotal += 1;
        // `<Field>` (components/Field.tsx) pose lui-même `id` + `htmlFor`
        // via `useId` : un champ enfant direct y est donc étiqueté. Le
        // scanner ne peut pas voir le rendu, la mesure navigateur
        // (`fieldsWithoutName`) reste l'arbitre.
        const parentEl = parentJsx
          ? ts.isJsxElement(parentJsx)
            ? parentJsx.openingElement
            : parentJsx
          : null;
        const inField = !!parentEl && !!parentEl.tagName && tagNameOf(parentEl).toLowerCase() === "field";
        const named =
          hasAttr(attrs, "aria-label") ||
          hasAttr(attrs, "aria-labelledby") ||
          hasAttr(attrs, "id") ||
          inField ||
          ancestors.some((a) => a.toLowerCase() === "label") ||
          (parentJsx && jsxAttrs(parentJsx).has("htmlFor"));
        if (!hidden && !named) {
          hit("fieldsWithoutLabelAssociation", file, sf, node, tag);
        }
      }

      if (tag === "button") {
        const label = hasAttr(attrs, "aria-label");
        const labelledBy = hasAttr(attrs, "aria-labelledby");
        const title = hasAttr(attrs, "title");
        const inlineText = ts.isJsxElement(node) ? hasVisibleContent(node.children) : false;
        const iconOnly = !inlineText &&
          (ts.isJsxElement(node)
            ? hasAnyIcon(node.children)
            : false);
        if (iconOnly) METRICS.iconButtonsTotal += 1;
        if (!label && !labelledBy && !title && !inlineText) {
          hit("iconButtonsWithoutLabel", file, sf, node, text.slice(node.getStart(sf), node.getEnd()).slice(0, 120));
        }
        buttons.push(node);
      }
    }

    const nextAncestors = ts.isJsxElement(node)
      ? [...ancestors, tagNameOf(node.openingElement).toLowerCase()]
      : ancestors;
    ts.forEachChild(node, (child) =>
      visit(child, nextAncestors, ts.isJsxElement(node) ? node : parentJsx),
    );
  };

  // On démarre sur les éléments JSX racines.
  const walkTop = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) visit(node, [], null);
    else ts.forEachChild(node, walkTop);
  };
  walkTop(sf);

  return { sf, text };
}

/* ------------------------------------------------------------------ */
/* Pages, métadonnées, fichiers d'état                                 */
/* ------------------------------------------------------------------ */

function measureApp() {
  const pages = allFilesUnder("app", "page.tsx");
  METRICS.totalPages = pages.length;
  for (const page of pages) {
    const text = readFileSync(join(ROOT, page), "utf8");
    if (/export\s+const\s+metadata\b|export\s+(async\s+)?function\s+generateMetadata\b|export\s+const\s+generateMetadata\b/.test(text)) {
      METRICS.pagesWithMetadata += 1;
    }
  }
  METRICS.errorBoundaries = allFilesUnder("app", "error.tsx").length;
  METRICS.notFoundPages = allFilesUnder("app", "not-found.tsx").length;
  METRICS.loadingBoundaries = allFilesUnder("app", "loading.tsx").length;
  METRICS.globalErrorBoundaries = existsSync(join(ROOT, "app/global-error.tsx")) ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Direction du cliquet                                                */
/* ------------------------------------------------------------------ */

/** `down` : la valeur doit décroître. `up` : elle doit croître. */
const DIRECTION = {
  iconButtonsWithoutLabel: "down",
  fieldsWithoutLabelAssociation: "down",
  buttonsWithoutType: "down",
  nonSemanticClickHandlers: "down",
  blankLinksWithoutRel: "down",
  positiveTabIndex: "down",
  autoFocusUses: "down",
  tinyTextUses: "down",
  hardcodedColors: "down",
  arbitraryValues: "down",
  outlineNone: "down",
  filesOver800Lines: "down",
  errorBoundaries: "up",
  notFoundPages: "up",
  loadingBoundaries: "up",
  globalErrorBoundaries: "up",
  pagesWithMetadata: "up",
  totalPages: "up",
};

const LABELS = {
  iconButtonsWithoutLabel: "boutons-icônes sans nom accessible",
  fieldsWithoutLabelAssociation: "champs sans étiquette associée",
  buttonsWithoutType: "boutons sans type",
  nonSemanticClickHandlers: "clics sur éléments non sémantiques",
  blankLinksWithoutRel: "liens _blank sans rel",
  positiveTabIndex: "tabIndex positifs",
  autoFocusUses: "autoFocus",
  tinyTextUses: "usages de texte < 12 px",
  hardcodedColors: "couleurs en dur",
  arbitraryValues: "valeurs Tailwind arbitraires",
  outlineNone: "outline-none",
  focusVisibleUses: "focus-visible explicites",
  errorBoundaries: "error.tsx",
  notFoundPages: "not-found.tsx",
  loadingBoundaries: "loading.tsx",
  globalErrorBoundaries: "global-error.tsx",
  pagesWithMetadata: "pages avec métadonnées",
  totalPages: "pages",
  filesOver800Lines: "fichiers > 800 lignes",
  fieldsTotal: "champs (total, contexte)",
  iconButtonsTotal: "boutons-icônes (total, contexte)",
  ariaInvalid: "aria-invalid (contexte)",
  ariaDescribedBy: "aria-describedby (contexte)",
  dialogElements: "surcouches role=dialog (contexte)",
};

/* ------------------------------------------------------------------ */
/* Programme                                                           */
/* ------------------------------------------------------------------ */

function arg(name) {
  // Les deux formes : `--json=f.json` et `--json f.json` (celle des scripts npm).
  const withEq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  const next = index >= 0 ? process.argv[index + 1] : null;
  return next && !next.startsWith("--") ? next : null;
}

const files = SOURCES.flatMap((dir) => walk(dir));
for (const file of files) scanFile(file);
measureApp();

const metrics = { ...METRICS, generatedFrom: files.length };

if (process.argv.includes("--json")) {
  const path = arg("json");
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), files: files.length, metrics }, null, 2)}\n`);
    console.log(`mesures écrites : ${path}`);
  }
}

if (process.argv.includes("--details")) {
  const path = arg("details");
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), details }, null, 2)}\n`);
    console.log(`preuves écrites : ${path}`);
  }
}

if (process.argv.includes("--baseline")) {
  const path = arg("baseline");
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(metrics, null, 2)}\n`);
    console.log(`référence figée : ${path}`);
  }
}

console.log(`\nscanner UI/UX — ${files.length} fichier(s) analysé(s), ${metrics.totalPages} page(s)\n`);
console.log("-".repeat(78));
for (const [metric, label] of Object.entries(LABELS)) {
  const value = metrics[metric];
  const direction = DIRECTION[metric];
  const arrow = direction === "down" ? "↓" : direction === "up" ? "↑" : " ";
  console.log(`${label.padEnd(40)} ${String(value).padStart(6)}  ${arrow}`);
}

const worst = [...offenders.entries()]
  .map(([metric, byFile]) => ({ metric, total: [...byFile.values()].reduce((a, b) => a + b, 0), byFile }))
  .sort((a, b) => b.total - a.total);

for (const { metric, byFile } of worst.slice(0, 5)) {
  const top = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`\n  ${LABELS[metric]} :`);
  for (const [file, count] of top) console.log(`    ${String(count).padStart(4)}  ${file}`);
}
console.log("");

if (process.argv.includes("--check")) {
  const path = arg("check");
  if (!path || !existsSync(path)) {
    console.error(`cliquet introuvable : ${path ?? "(--check=… manquant)"}`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  const breaks = [];
  for (const [metric, direction] of Object.entries(DIRECTION)) {
    const before = baseline[metric];
    const now = metrics[metric];
    if (typeof before !== "number" || typeof now !== "number") continue;
    if (direction === "down" && now > before) breaks.push(`${metric} : ${before} → ${now} (doit décroître)`);
    if (direction === "up" && now < before) breaks.push(`${metric} : ${before} → ${now} (doit croître)`);
  }
  if (breaks.length) {
    console.log("cliquet : régression");
    for (const line of breaks) console.log(`  ✗ ${line}`);
    process.exit(1);
  }
  console.log(`cliquet : tenu (${Object.keys(DIRECTION).length} indicateurs)`);
}
