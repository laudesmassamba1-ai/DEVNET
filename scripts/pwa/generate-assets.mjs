/**
 * Icônes et écrans de démarrage du PWA DevNet.
 *
 * Une seule source de vérité : le mark « terminal » (fenêtre, chevron `>`,
 * curseur phosphor) dessiné dans `components/Logo.tsx`. Ce script le
 * redessine en SVG autonome — mêmes coordonnées, mêmes couleurs de jeton —
 * puis en sort chaque taille attendue par iOS, Android et les navigateurs.
 *
 *   node scripts/pwa/generate-assets.mjs
 *
 * À relancer si le mark ou la palette change. Les fichiers produits sont
 * versionnés : aucun build ne dépend de sharp pour servir un icône.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const ICONS_DIR = path.join(ROOT, "public", "icons");
const SPLASH_DIR = path.join(ROOT, "public", "splash");

const COLORS = {
  bg: "#11110E",
  signal: "#FF7A45",
  phosphor: "#5FBF86",
  phosphorShade: "#3F9A66",
  chalk: "#ECE9DF",
};

/** Le mark, en coordonnées 64×64 — celles de `Logo.tsx`. */
const MARK = `
  <g fill="none" stroke-linejoin="miter">
    <rect x="3" y="7" width="58" height="50" rx="7" stroke="${COLORS.signal}" stroke-width="3.2" />
  </g>
  <line x1="5.4" y1="19" x2="58.6" y2="19" stroke="${COLORS.signal}" stroke-width="2.2" />
  <g fill="${COLORS.signal}">
    <rect x="9" y="11" width="4.4" height="4.4" />
    <rect x="16" y="11" width="4.4" height="4.4" opacity="0.72" />
    <rect x="23" y="11" width="4.4" height="4.4" opacity="0.45" />
  </g>
  <path d="M14.6 28.6 L26.4 38 L14.6 47.4" fill="none" stroke="${COLORS.signal}"
    stroke-width="4.6" stroke-linecap="butt" stroke-linejoin="miter" />
  <g>
    <rect x="32" y="42.6" width="14" height="5.6" fill="${COLORS.phosphor}" />
    <rect x="39" y="42.6" width="7" height="5.6" fill="${COLORS.phosphorShade}" />
    <rect x="32" y="42.6" width="14" height="1.7" fill="${COLORS.chalk}" />
  </g>
`;

/**
 * Même mark, en monochrome : un seul aplat clair, pour les contextes qui
 * teintent eux-mêmes l'icône (badge Android, barre d'état).
 */
const MARK_MONO = `
  <g fill="#FFFFFF" stroke="#FFFFFF">
    <rect x="3" y="7" width="58" height="50" rx="7" fill="none" stroke-width="3.2" />
    <line x1="5.4" y1="19" x2="58.6" y2="19" stroke-width="2.2" />
    <rect x="9" y="11" width="4.4" height="4.4" stroke="none" />
    <rect x="16" y="11" width="4.4" height="4.4" stroke="none" />
    <rect x="23" y="11" width="4.4" height="4.4" stroke="none" />
    <path d="M14.6 28.6 L26.4 38 L14.6 47.4" fill="none" stroke-width="4.6" />
    <rect x="32" y="42.6" width="14" height="5.6" stroke="none" />
  </g>
`;

/**
 * Un carré plein : le mark est centré, jamais collé au bord. `coverage` est
 * la part du côté occupée par le dessin — 0,82 pour une icône classique,
 * 0,56 pour une icône maskable, dont le bord peut être rogné.
 */
function iconSvg({ coverage = 0.82, background = COLORS.bg, mono = false } = {}) {
  const scale = (512 * coverage) / 64;
  const offset = (512 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${background ? `<rect width="512" height="512" fill="${background}" />` : ""}
  <g transform="translate(${offset.toFixed(3)} ${offset.toFixed(3)}) scale(${scale.toFixed(4)})">
    ${mono ? MARK_MONO : MARK}
  </g>
</svg>`;
}

/** Écran de démarrage iOS : fond plein, mark centré, rien d'autre. */
function splashSvg(width, height) {
  const side = Math.round(Math.min(width, height) * 0.26);
  const scale = side / 64;
  const x = (width - side) / 2;
  const y = (height - side) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${COLORS.bg}" />
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">
    ${MARK}
  </g>
</svg>`;
}

const ICON_SIZES = [48, 72, 96, 144, 192, 256, 384, 512];

/**
 * Tailles d'écran de démarrage — celles qu'iOS demande réellement dans une
 * `apple-touch-startup-image`, en pixels physiques. La requête média
 * correspondante est générée à côté, dans `lib/pwa.ts`.
 */
const SPLASHES = [
  [640, 1136],
  [750, 1334],
  [828, 1792],
  [1125, 2436],
  [1170, 2532],
  [1179, 2556],
  [1242, 2208],
  [1242, 2688],
  [1284, 2778],
  [1290, 2796],
  [1320, 2868],
  [1536, 2048],
  [1620, 2160],
  [1668, 2224],
  [2048, 2732],
];

async function render(svg, width, height, file, { flatten = false } = {}) {
  let image = sharp(Buffer.from(svg), { density: 384 });
  image = image.resize(width, height, { fit: "fill" });
  if (flatten) image = image.flatten({ background: COLORS.bg });
  await image.png({ compressionLevel: 9, palette: true, colors: 64 }).toFile(file);
}

async function main() {
  await mkdir(ICONS_DIR, { recursive: true });
  await mkdir(SPLASH_DIR, { recursive: true });

  const icon = iconSvg();
  const maskable = iconSvg({ coverage: 0.56 });
  const mono = iconSvg({ background: null, mono: true, coverage: 0.86 });

  // La source SVG est servie : elle reste nette à toutes les tailles et
  // documente le dessin pour qui veut le reprendre.
  await writeFile(path.join(ICONS_DIR, "app-icon.svg"), icon);
  await writeFile(path.join(ICONS_DIR, "app-icon-maskable.svg"), maskable);
  await writeFile(path.join(ICONS_DIR, "app-icon-monochrome.svg"), mono);

  for (const size of ICON_SIZES) {
    await render(icon, size, size, path.join(ICONS_DIR, `icon-${size}.png`));
  }
  await render(maskable, 512, 512, path.join(ICONS_DIR, "maskable-512.png"));
  await render(mono, 512, 512, path.join(ICONS_DIR, "monochrome-512.png"));
  // iOS arrondit lui-même : l'icône est pleine, sans coins pré-peints.
  await render(icon, 180, 180, path.join(ICONS_DIR, "apple-touch-icon.png"));
  await render(icon, 1024, 1024, path.join(ICONS_DIR, "icon-1024.png"));

  for (const [width, height] of SPLASHES) {
    await render(
      splashSvg(width, height),
      width,
      height,
      path.join(SPLASH_DIR, `splash-${width}x${height}.png`),
      { flatten: true },
    );
  }

  console.log(
    `PWA : ${ICON_SIZES.length + 3} icônes et ${SPLASHES.length} écrans de démarrage générés.`,
  );
}

void main();
