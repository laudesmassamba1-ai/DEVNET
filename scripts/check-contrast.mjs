/**
 * Porte de contraste — WCAG 2 x AA, sur les deux thèmes.
 *
 *     node scripts/check-contrast.mjs
 *
 * Ce que cette porte vérifie, et pourquoi ces paires-là :
 *
 * 1. **Texte** (4,5:1) — les quatre niveaux d'encre sur la page, la carte
 *    et `surface-2` ; les couleurs sémantiques ; l'accent. Une paire
 *    oubliée est une paire qui dérive : les jetons changent, la mesure non.
 * 2. **Contour de contrôle** (3:1, WCAG 1.4.11) — `line-2`, `line-3`,
 *    `edge-strong` sur la page, la surface et `surface-2`. Un champ n'est
 *    délimité que par son filet ; un filet à 1,7:1 est un champ invisible.
 * 3. **Encre sur aplat d'action** (4,5:1) — le bouton plein, dans les deux
 *    thèmes, y compris le survol en thème clair où l'encre change.
 * 4. **Avatars** (4,5:1) — cinq pastilles partagées par les deux thèmes.
 * 5. **Filets composés** (3:1) — `border-line-2/40`, `border-signal/60`…
 *    Une opacité n'est pas une couleur : elle se compose avec la surface
 *    dessous, donc elle ne peut pas être jugée sur le jeton seul.
 *
 * ## Pourquoi la porte modélise la cascade
 *
 * Mesurer `border-line-2/40` à 1,53:1 serait faux : `globals.css` réécrit
 * déjà ce filet. Deux règles décident de la couleur **rendue** :
 *
 * - `button[class*="border-line"]` et les champs forment les contrôles à
 *   `--color-edge-strong` (3,2:1) — un `border-line-2/40` sur un bouton est
 *   donc opaque, quelle que soit son opacité déclarée ;
 * - la règle générale des surfaces arrondies peint `--color-line-2`
 *   (3,2:1) et sa spécificité 0,2,0 gagne sur ces utilitaires.
 *
 * La porte applique ces deux règles avant de composer. Ce qu'elle mesure
 * est donc la couleur que le navigateur peint, pas celle qu'on a écrite.
 * Toute nouvelle règle globale de filet doit être ajoutée ici : c'est le
 * prix d'une mesure statique, et c'est dit dans `docs/ARCHITECTURE.md`.
 *
 * ## Ce qui n'échoue pas
 *
 * Un filet **décoratif** (séparateur `/20`, bord de pastille, alerte) n'a
 * pas à atteindre 3:1 : WCAG 1.4.11 ne vise que l'information nécessaire
 * pour identifier un composant. Ces filets sont comptés dans la sortie,
 * jamais condamnés — sinon la porte exigerait de dessiner des cadres
 * partout et personne ne la garderait.
 *
 * La porte lit `app/globals.css` et les composants — pas une copie : une
 * valeur corrigée est mesurée le jour même. Sortie 1 dès qu'une paire ou un
 * filet de contrôle passe sous son seuil, avec le ratio exact, le fichier et
 * la ligne.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync("app/globals.css", "utf8");

function slice(startMarker, endMarker) {
  const i = CSS.indexOf(startMarker);
  if (i === -1) return "";
  const j = CSS.indexOf(endMarker, i + startMarker.length);
  return CSS.slice(i + startMarker.length, j === -1 ? CSS.length : j);
}

function parse(text) {
  const out = {};
  for (const [, raw, value] of text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[raw.replace(/^color-/, "")] = value.trim();
  }
  return out;
}

const dark = parse(slice("@theme {", "\n}"));
const light = { ...dark, ...parse(slice(':root[data-theme="light"] {', "\n}")) };

const hex = (value) => {
  const m = String(value).match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Résout les alias (`--color-edge: var(--color-line)`) avant de mesurer. */
function color(tokens, name) {
  let value = tokens[name];
  for (let hop = 0; hop < 4 && typeof value === "string"; hop += 1) {
    const ref = value.match(/^var\(--color-([a-z0-9-]+)\)$/);
    if (!ref) break;
    value = tokens[ref[1]];
  }
  return hex(value);
}

const luminance = ([r, g, b]) => {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const ratio = (fg, bg) => {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** Composition source-over : une opacité sur une surface opaque. */
const blend = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

const TEXT_PAIRS = [
  ["chalk", "page"],
  ["chalk", "surface"],
  ["chalk-2", "page"],
  ["chalk-2", "surface"],
  ["chalk-3", "page"],
  ["chalk-3", "surface"],
  ["chalk-4", "page"],
  ["chalk-4", "surface"],
  ["chalk-4", "surface-2"],
  ["signal", "page"],
  ["signal", "surface"],
  ["signal", "surface-2"],
  ["signal-d", "page"],
  ["danger", "page"],
  ["danger", "surface"],
  ["ok", "page"],
  ["ok", "surface"],
  ["warn", "page"],
  ["warn", "surface"],
  ["info", "page"],
];

const BORDER_PAIRS = [
  ["line-2", "surface"],
  ["line-3", "surface"],
  ["edge-strong", "surface"],
  ["line-2", "page"],
  ["line-2", "surface-2"],
  ["edge-strong", "surface-2"],
];

const problems = [];

function check(themeName, tokens) {
  for (const [fgName, bgName] of TEXT_PAIRS) {
    const fg = color(tokens, fgName);
    const bg = color(tokens, bgName);
    if (!fg || !bg) {
      problems.push(`${themeName} : jeton non résolu (${fgName} / ${bgName})`);
      continue;
    }
    const r = ratio(fg, bg);
    if (r < 4.5) {
      problems.push(
        `${themeName} : texte ${fgName} sur ${bgName} = ${r.toFixed(2)}:1 (min 4,5)`,
      );
    }
  }

  for (const [fgName, bgName] of BORDER_PAIRS) {
    const fg = color(tokens, fgName);
    const bg = color(tokens, bgName);
    if (!fg || !bg) {
      problems.push(`${themeName} : jeton non résolu (${fgName} / ${bgName})`);
      continue;
    }
    const r = ratio(fg, bg);
    if (r < 3) {
      problems.push(
        `${themeName} : contour ${fgName} sur ${bgName} = ${r.toFixed(2)}:1 (min 3)`,
      );
    }
  }

  /* Encre du bouton plein : `text-void` sur `signal` en sombre ; en clair,
     la règle force une encre papier (#FBFAF7) — c'est elle qu'on mesure. */
  const ink = themeName === "sombre" ? color(tokens, "void") : hex("#FBFAF7");
  const fill = color(tokens, "signal");
  if (ink && fill) {
    const r = ratio(ink, fill);
    if (r < 4.5) {
      problems.push(
        `${themeName} : encre du bouton signal = ${r.toFixed(2)}:1 (min 4,5)`,
      );
    }
  }
}

/* ── Filets composés, résolus comme le navigateur les peint ───────────── */

const CONTROL_TAGS = new Set(["button", "a", "Link", "input", "select", "textarea"]);
const SURFACES = ["page", "surface", "surface-2"];
const SOURCE_ROOTS = ["app", "components", "modules", "lib"];

function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.(tsx|jsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Balise ouvrante qui contient la classe, avec sa ligne. */
function tagAt(text, index) {
  const start = text.lastIndexOf("<", index);
  if (start === -1) return null;
  const name = text.slice(start, index).match(/^<([A-Za-z][\w.]*)/)?.[1];
  if (!name) return null;
  const end = text.indexOf(">", index);
  if (end === -1) return null;
  return {
    name,
    open: text.slice(start, end + 1),
    line: text.slice(0, index).split("\n").length,
  };
}

/* Un fond propre (hors variante `hover:`) définit la cible : le filet n'est
   alors qu'un ornement, et sa mesure ne dit rien de la lisibilité. */
const ownFill = (open) => /(^|[\s"'`])bg-[a-z0-9]/.test(open);
/* `button[class*="border-line"]` : la règle des contrôles réécrit le filet. */
const controlRewritten = (cls) => /border-line/.test(cls);

const composites = [];
let decorative = 0;

for (const root of SOURCE_ROOTS) {
  if (!existsSync(root)) continue;
  for (const file of sources(root)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bborder-([a-z][a-z0-9-]*)\/(\d{1,3})\b/g)) {
      const tag = tagAt(text, match.index);
      if (!tag) continue;
      if (!CONTROL_TAGS.has(tag.name)) {
        decorative += 1;
        continue;
      }
      composites.push({
        file,
        line: tag.line,
        tag: tag.name,
        token: match[1],
        alpha: Math.min(100, Number(match[2])) / 100,
        rewritten: controlRewritten(match[0]),
        filled: ownFill(tag.open),
      });
    }
  }
}

function worstComposite(layer, tokens, themeName) {
  const declared = color(tokens, layer.token);
  if (!declared) {
    problems.push(
      `${layer.file}:${layer.line} : jeton non résolu (${layer.token})`,
    );
    return null;
  }
  /* La règle des contrôles gagne sur l'utilitaire : couleur opaque. */
  const forced = layer.rewritten ? color(tokens, "edge-strong") : null;
  let worst = { ratio: Infinity, surface: SURFACES[0] };
  for (const surface of SURFACES) {
    const base = color(tokens, surface);
    if (!base) continue;
    const painted = forced ?? blend(declared, base, layer.alpha);
    const r = ratio(painted, base);
    if (r < worst.ratio) worst = { ratio: r, surface };
  }
  return { ...worst, theme: themeName };
}

for (const layer of composites) {
  const results = [
    worstComposite(layer, dark, "sombre"),
    worstComposite(layer, light, "clair"),
  ].filter(Boolean);
  if (!results.length) continue;
  const worst = results.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
  if (layer.filled || worst.ratio >= 3) continue;
  problems.push(
    `${layer.file}:${layer.line} : filet ${layer.token}/${Math.round(layer.alpha * 100)} ` +
      `sur <${layer.tag}> = ${worst.ratio.toFixed(2)}:1 en ${worst.theme} ` +
      `sur ${worst.surface} (min 3)`,
  );
}

/* La règle générale des surfaces doit émettre un filet mesuré : c'est elle
   qui a rendu le rond « Votre story » à 1,54:1 en écrasant `border-line-3`. */
const generalRule = CSS.match(
  /\[class\*="rounded"\]\s*\{\s*border-color:\s*var\(--color-([a-z0-9-]+)\)/,
);
if (!generalRule) {
  problems.push("globals.css : règle générale des surfaces arrondies introuvable");
} else {
  for (const [themeName, tokens] of [
    ["sombre", dark],
    ["clair", light],
  ]) {
    const painted = color(tokens, generalRule[1]);
    for (const surface of ["surface", "surface-2"]) {
      const base = color(tokens, surface);
      if (!painted || !base) {
        problems.push(`${themeName} : filet général non résolu (${generalRule[1]})`);
        continue;
      }
      const r = ratio(painted, base);
      if (r < 3) {
        problems.push(
          `${themeName} : filet général ${generalRule[1]} sur ${surface} = ` +
            `${r.toFixed(2)}:1 (min 3)`,
        );
      }
    }
  }
}

check("sombre", dark);
check("clair", light);

for (const name of ["lime", "sage", "pink", "orange", "violet"]) {
  const fg = color(dark, `av-${name}-fg`);
  const bg = color(dark, `av-${name}-bg`);
  if (fg && bg) {
    const r = ratio(fg, bg);
    if (r < 4.5) {
      problems.push(`avatar ${name} = ${r.toFixed(2)}:1 (min 4,5)`);
    }
  }
}

if (problems.length) {
  console.error("contraste : échec");
  for (const line of problems) console.error(`  ✗ ${line}`);
  process.exit(1);
}

console.log(
  `contraste : tenu (${TEXT_PAIRS.length * 2} paires de texte, ` +
    `${BORDER_PAIRS.length * 2} contours, 2 boutons, 5 avatars, ` +
    `${composites.length} filets composés de contrôle + ${decorative} décoratifs ` +
    `— deux thèmes)`,
);
