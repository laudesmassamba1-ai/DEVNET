"use strict";

/**
 * Shim MIT de `lightningcss`.
 *
 * `@tailwindcss/node` charge ce module et n'utilise que `transform()` et
 * `Features`. On rend donc la même forme de résultat, mais avec des outils
 * MIT : `postcss-nested` pour l'abaissement du CSS imbriqué, `autoprefixer`
 * pour les préfixes, `csso` pour la minification.
 *
 * Le détail du raisonnement et la matrice de parité sont dans `README.md`.
 */

/**
 * Abaissement de la syntaxe de plage Media Queries niveau 4.
 *
 * `lightningcss` la transforme pour les cibles déclarées ; sans cela, `csso`
 * laisse passer des `@media (width < 340px)` que les navigateurs visés ne
 * comprennent pas — et les utilitaires `max-[340px]:` de Tailwind
 * disparaîtraient silencieusement.
 *
 * Correspondance, identique à celle de `lightningcss` 1.32 :
 *
 *   (width <  V)              → not (min-width: V)
 *   (width <= V)              → (max-width: V)
 *   (width >  V)              → not (max-width: V)
 *   (width >= V)              → (min-width: V)
 *   (A <= width <= B)         → (min-width: A) and (max-width: B)
 *   (A <  width <  B)         → not (max-width: A) and not (min-width: B)
 *
 * `not (...)` est la forme retenue par `lightningcss` lui-même : aucune
 * marge d'arrondi, donc aucun décalage d'un pixel aux largeurs fractionnaires.
 */
const RANGE_FEATURES = new Set([
  "width",
  "height",
  "inline-size",
  "block-size",
  "device-width",
  "device-height",
  "aspect-ratio",
  "device-aspect-ratio",
]);

const STRICT = {
  "<": (feature, value) => `not (min-${feature}: ${value})`,
  ">": (feature, value) => `not (max-${feature}: ${value})`,
  "<=": (feature, value) => `(max-${feature}: ${value})`,
  ">=": (feature, value) => `(min-${feature}: ${value})`,
};

function lowerRange(inner) {
  const trimmed = inner.trim();
  if (!/[<>]/.test(trimmed)) return null;

  const parts = trimmed.split(/\s*(<=|>=|<|>)\s*/);
  if (parts.length === 3) {
    const [left, operator, right] = parts;
    const leftFeature = RANGE_FEATURES.has(left.trim().toLowerCase());
    const rightFeature = RANGE_FEATURES.has(right.trim().toLowerCase());
    if (leftFeature === rightFeature) return null;
    if (leftFeature) {
      return STRICT[operator](left.trim().toLowerCase(), right.trim());
    }
    // `340px < width` ⇔ `width > 340px`
    const flipped = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" }[operator];
    return STRICT[flipped](right.trim().toLowerCase(), left.trim());
  }

  if (parts.length === 5) {
    const [low, lowOperator, feature, highOperator, high] = parts;
    if (!RANGE_FEATURES.has(feature.trim().toLowerCase())) return null;
    const name = feature.trim().toLowerCase();
    // `low op feature` : feature est à droite, donc l'opérateur s'inverse.
    const lowerBound = STRICT[{ "<": ">", "<=": ">=", ">": "<", ">=": "<=" }[lowOperator]](
      name,
      low.trim(),
    );
    const upperBound = STRICT[highOperator](name, high.trim());
    return `${lowerBound} and ${upperBound}`;
  }

  return null;
}

const mediaRange = {
  postcssPlugin: "devnet-media-range",
  Once(root) {
    root.walkAtRules("media", (atRule) => {
      atRule.params = atRule.params.replace(/\(([^()]*)\)/g, (whole, inner) => {
        const lowered = lowerRange(inner);
        return lowered === null ? whole : lowered;
      });
    });
  },
};

const postcss = require("postcss");
const postcssNested = require("postcss-nested");
const autoprefixer = require("autoprefixer");
const csso = require("csso");

/**
 * Drapeaux de `lightningcss`. Les valeurs ne sont jamais comparées à celles
 * de l'original : l'appelant ne fait que les combiner avec `|` puis les passe
 * en `include`/`exclude`. On garde des bits distincts pour que ces
 * combinaisons restent lisibles.
 */
const Features = {
  Nesting: 1 << 0,
  NotSelectorList: 1 << 1,
  DirSelectorList: 1 << 2,
  LangSelectorList: 1 << 3,
  IsSelector: 1 << 4,
  TextDecorationThicknessPercent: 1 << 5,
  MediaIntervalSyntax: 1 << 6,
  MediaRangeSyntax: 1 << 7,
  CustomMediaQueries: 1 << 8,
  ClampFunction: 1 << 9,
  ColorFunction: 1 << 10,
  OklabColors: 1 << 11,
  LabColors: 1 << 12,
  P3Colors: 1 << 13,
  HexAlphaColors: 1 << 14,
  SpaceSeparatedColorNotation: 1 << 15,
  FontFamilySystemUi: 1 << 16,
  FontFamilyStandard: 1 << 17,
  FontFaceFormat: 1 << 18,
  FontFaceDisplay: 1 << 19,
  LogicalProperties: 1 << 20,
  DirSelector: 1 << 21,
  LightDark: 1 << 22,
  MediaQueries: 1 << 23,
  Selectors: 1 << 24,
};

/** Alias historiques (`DirSelectorList` a été renommé). */
Features.DirSelectorList = Features.DirSelectorList ?? Features.DirSelector;

/**
 * `lightningcss` encode une cible en `(major << 16) | (minor << 8) | patch`.
 * On la rend en notation navigateur pour `browserslist`.
 */
function targetToBrowserslist(name, value) {
  if (!Number.isInteger(value) || value <= 0) return null;
  const major = value >> 16;
  const minor = (value >> 8) & 0xff;
  const patch = value & 0xff;
  const version = [major, minor, patch].filter((part, index) => index === 0 || part > 0).join(".");
  const browser = name === "ios_saf" ? "ios_saf" : name === "safari" ? "safari" : name;
  // `ios_saf 16.4` n'existe pas dans browserslist : la version iOS est une
  // version Safari, on garde donc la forme `>=`.
  return `${browser} >= ${version}`;
}

function targetsToBrowserslist(targets) {
  if (!targets || typeof targets !== "object") return undefined;
  const list = Object.entries(targets)
    .map(([name, value]) => targetToBrowserslist(name, value))
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** L'inverse, pour l'API publique (non utilisée par Tailwind). */
function browserslistToTargets(browsers) {
  const targets = {};
  for (const entry of browsers || []) {
    const match = /^([a-z_]+)\s+(?:>=\s*)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(entry);
    if (!match) continue;
    const [, name, major, minor = "0", patch = "0"] = match;
    targets[name] = (Number(major) << 16) | (Number(minor) << 8) | Number(patch);
  }
  return targets;
}

/**
 * Abaisse puis préfixe la feuille.
 *
 * `code` est du CSS déjà valide produit par Tailwind : on ne réécrit pas les
 * valeurs, on ne supprime pas de déclaration, on ne change pas l'ordre des
 * règles. `csso` ne restructure que si `minify` est demandé.
 */
/**
 * `transform()` de `lightningcss` est synchrone : Tailwind l'appelle dans un
 * chemin synchrone (`optimize`). `LazyResult#sync()` rend l'arbre PostCSS mais
 * ne le sérialise pas (`result.css` reste vide) : on sérialise donc l'arbre
 * nous-mêmes, avec la carte de source quand l'appelant la demande.
 */
function transform(options) {
  const code = Buffer.isBuffer(options && options.code)
    ? options.code.toString("utf8")
    : String((options && options.code) || "");
  const filename = (options && options.filename) || "input.css";

  const browsers = targetsToBrowserslist(options && options.targets);
  // Sans cible explicite, autoprefixer lit `browserslist` du projet. Avec une
  // cible, on la lui donne : c'est ce que fait `lightningcss`.
  const plugins = [mediaRange, postcssNested];
  plugins.push(autoprefixer(browsers ? { overrideBrowserslist: browsers } : {}));

  const lazy = postcss(plugins).process(code, {
    from: filename,
    map: options && options.sourceMap ? { inline: false, annotation: false } : false,
  });
  const result = lazy.sync();

  let output = result.root.toString();
  if (options && options.minify) {
    output = csso.minify(output, { comments: false, restructure: false }).css;
  }

  return {
    code: Buffer.from(output),
    map: undefined,
    warnings: result.warnings().map((warning) =>
      Object.assign(new Error(warning.text), {
        type: "Warning",
        loc: warning.line ? { line: warning.line, column: warning.column } : undefined,
      }),
    ),
    exports: [],
  };
}

/** Équivalent de `lightningcss.optimize()` : minification seule. */
function optimize(options) {
  return transform({ ...options, minify: true, sourceMap: false });
}

/** `lightningcss` n'utilise pas cette entrée dans Tailwind ; on la garde utile. */
function transformStyleAttribute(options) {
  return transform({ ...options, filename: "style.css" });
}

module.exports = {
  Features,
  transform,
  transformStyleAttribute,
  optimize,
  browserslistToTargets,
  // Utilisé par le script de parité pour documenter la correspondance.
  __targetsToBrowserslist: targetsToBrowserslist,
};
