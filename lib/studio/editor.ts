/**
 * Atelier — modèle de calques et rendu.
 *
 * ## Pourquoi un modèle séparé de l'écran
 *
 * L'écran affiche des calques en DOM (texte net, sélection au pointeur), mais
 * l'export doit produire une image **au pixel** : 1080 × 1920 pour un statut.
 * Les deux passent donc par le même modèle, et le rendu canvas relit ce
 * modèle. Sans cela, l'aperçu et le fichier exporté divergeraient — le
 * défaut classique d'un éditeur où « ce n'est pas tout à fait ce que j'ai
 * vu ».
 *
 * ## Coordonnées
 *
 * Tout est en **pourcentage du cadre** (0–100). Un calque occupe la même
 * place relative en 9:16, en carré et en 16:9 ; changer de format ne
 * détruit pas la composition, il la recadre. Les tailles de police sont en
 * pixels du cadre de référence (1080 de large), converties au rendu.
 */

export type RatioId = "story" | "portrait" | "square" | "wide";

export const RATIOS: Record<RatioId, { label: string; w: number; h: number }> = {
  story: { label: "Statut 9:16", w: 1080, h: 1920 },
  portrait: { label: "Portrait 4:5", w: 1080, h: 1350 },
  square: { label: "Carré 1:1", w: 1080, h: 1080 },
  wide: { label: "Paysage 16:9", w: 1920, h: 1080 },
};

export type LayerType = "image" | "video" | "text" | "shape" | "sticker" | "bezier";

export interface Filters {
  /** Multiplicateurs, 1 = neutre. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Pixels de flou au cadre de référence. */
  blur: number;
  /** 0–100. */
  grayscale: number;
  sepia: number;
}

export const NO_FILTERS: Filters = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  blur: 0,
  grayscale: 0,
  sepia: 0,
};

export interface BaseLayer {
  id: string;
  name: string;
  type: LayerType;
  /** Cadre en pourcentage : origine du coin haut-gauche. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  filters: Filters;
}

export interface MediaLayer extends BaseLayer {
  type: "image" | "video" | "sticker";
  src: string;
  fit: "cover" | "contain";
  radius: number;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  color: string;
  /** Taille en px du cadre de référence. */
  size: number;
  weight: number;
  align: "left" | "center" | "right";
  font: "sans" | "display" | "mono";
  lineHeight: number;
  letterSpacing: number;
  uppercase: boolean;
}

export interface ShapeLayer extends BaseLayer {
  type: "shape";
  shape: "rect" | "ellipse" | "line";
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface BezierLayer extends BaseLayer {
  type: "bezier";
  points: [number, number][];
  controlPoints: [number, number][];
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export type Layer = MediaLayer | TextLayer | ShapeLayer | BezierLayer;

/** Options de rendu avec mémoïsation des calculs. */

/** Palettes : jetons système + picker plein écran. */
export const INK_TOKENS = [
  "--color-chalk",
  "--color-signal",
  "--color-ok",
  "--color-warn",
  "--color-danger",
  "--color-info",
  "--color-void",
] as const;

export const SURFACE_TOKENS = [
  "--color-void",
  "--color-surface-2",
  "--color-surface-3",
  "--color-signal",
  "--color-ok",
] as const;

/** Couleur au format CSS complet (hxe pour #rrggbb, ou var --css). */
export type CssColor = `${string}`;

export function parseCssColor(css: string): [number, number, number?, number?] {
  const hex = css.replace(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i, "#$1$2$3");
  if (/#([a-f0-9]{8})$/i.test(css)) {
    const a = parseInt(css.match(/#([a-f0-9]{2})$/i)?.[1] ?? "ff", 16) / 255;
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];
  }
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function rgbToCss(r: number, g: number, b: number, a = 1): string {
  const alpha = Math.round(a * 255).toString(16).padStart(2, "0");
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${alpha}`;
}

let seq = 0;
const nextId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

const base = (type: LayerType, name: string): BaseLayer => ({
  id: nextId(),
  name,
  type,
  x: 25,
  y: 35,
  w: 50,
  h: 30,
  rotation: 0,
  opacity: 1,
  locked: false,
  filters: { ...NO_FILTERS },
});

export function createText(patch: Partial<TextLayer> = {}): TextLayer {
  return {
    ...base("text", "Texte"),
    type: "text",
    x: 10,
    y: 40,
    w: 80,
    h: 20,
    text: "Ton texte",
    color: "var(--color-chalk)",
    size: 72,
    weight: 700,
    align: "center",
    font: "display",
    lineHeight: 1.2,
    letterSpacing: 0,
    uppercase: false,
    ...patch,
  };
}

export function createShape(shape: ShapeLayer["shape"], patch: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    ...base("shape", shape === "ellipse" ? "Ellipse" : shape === "line" ? "Trait" : "Rectangle"),
    type: "shape",
    shape,
    x: 30,
    y: 60,
    w: 40,
    h: shape === "line" ? 2 : 18,
    fill: "var(--color-signal)",
    stroke: "var(--color-void)",
    strokeWidth: 0,
    radius: 24,
    ...patch,
  };
}



export function createBezier(patch: Partial<BezierLayer> = {}): BezierLayer {
  return {
    ...base("bezier", "Courbe Bézier"),
    type: "bezier",
    points: [[0.2, 0.5], [0.8, 0.5]],
    controlPoints: [[0.1, 0.5], [0.9, 0.5]],
    fill: "var(--color-signal)",
    stroke: "var(--color-void)",
    strokeWidth: 2,
    ...patch,
  };
}
export function createMedia(
  type: "image" | "video" | "sticker",
  src: string,
  patch: Partial<MediaLayer> = {},
): MediaLayer {
  return {
    ...base(type, type === "video" ? "Vidéo" : type === "sticker" ? "Sticker" : "Image"),
    type,
    src,
    fit: "cover",
    radius: 0,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...patch,
  };
}

/** Chaîne `filter` CSS — même expression pour l'aperçu et le canvas. */
export function filterCss(f: Filters, scale = 1): string {
  const parts: string[] = [];
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.saturation !== 1) parts.push(`saturate(${f.saturation})`);
  if (f.blur > 0) parts.push(`blur(${(f.blur * scale).toFixed(2)}px)`);
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale / 100})`);
  if (f.sepia > 0) parts.push(`sepia(${f.sepia / 100})`);
  return parts.length ? parts.join(" ") : "none";
}

export function isFiltered(f: Filters): boolean {
  return filterCss(f) !== "none";
}

/** Sérialisation pour l'historique : un instantané ne partage pas ses objets. */
export function snapshot(layers: Layer[]): Layer[] {
  return layers.map((l) => ({ ...l, filters: { ...l.filters } }));
}

/**
 * Résout une valeur CSS (`var(--color-chalk)`) en valeur concrète.
 *
 * Le canvas ne connaît pas les variables CSS : `ctx.fillStyle =
 * "var(--color-chalk)"` est une chaîne invalide, silencieusement ignorée —
 * le texte gardait alors le noir par défaut et disparaissait sur le fond
 * sombre. On lit donc la valeur calculée sur `<html>`, celle que le thème a
 * déjà résolue. Le cache est indexé par thème : changer de thème invalide
 * les couleurs sans qu'on ait à y penser.
 */
const TOKEN_CACHE = new Map<string, string>();

export function resolveCssValue(value: string, fallback = "#000000"): string {
  if (typeof document === "undefined") return fallback;
  const match = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!match) return value;
  const [, name, inlineFallback] = match;
  const theme = document.documentElement.dataset.theme ?? "dark";
  const key = `${theme}|${name}`;
  const cached = TOKEN_CACHE.get(key);
  if (cached) return cached;
  const computed = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const resolved = computed || inlineFallback?.trim() || fallback;
  TOKEN_CACHE.set(key, resolved);
  return resolved;
}

const FONT_FALLBACK: Record<TextLayer["font"], string> = {
  display: "ui-serif, Georgia, serif",
  sans: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, monospace",
};

const IMAGE_CACHE = new Map<string, HTMLImageElement>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = IMAGE_CACHE.get(src);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      IMAGE_CACHE.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Image illisible : ${src.slice(0, 60)}`));
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawMedia(
  ctx: CanvasRenderingContext2D,
  layer: MediaLayer,
  boxW: number,
  boxH: number,
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
): void {
  ctx.save();
  if (layer.radius > 0) {
    roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, layer.radius);
    ctx.clip();
  }
  const scale =
    layer.fit === "cover"
      ? Math.max(boxW / sourceW, boxH / sourceH)
      : Math.min(boxW / sourceW, boxH / sourceH);
  const dw = sourceW * scale;
  const dh = sourceH * scale;
  ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

export interface RenderOptions {
  width: number;
  height: number;
  background: string;
  /** Éléments vidéo prêts, indexés par `src`. */
  videos?: Map<string, HTMLVideoElement>;
}

/**
 * Peint la composition.
 *
 * Le rendu est synchrone dès que les images sont chargées ; `prepare()` les
 * charge à l'avance pour que l'export ne peigne pas un cadre vide sur une
 * image encore en vol.
 */
export async function prepare(layers: Layer[]): Promise<void> {
  await Promise.all(
    layers
      .filter((l): l is MediaLayer => l.type === "image" || l.type === "sticker")
      .map((l) => loadImage(l.src).catch(() => null)),
  );
}

export function drawLayers(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  opts: RenderOptions,
): void {
  const { width, height, videos } = opts;
  const background = resolveCssValue(opts.background, "#16150F");
  ctx.save();
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";

  for (const layer of layers) {
    const px = (layer.x / 100) * width;
    const py = (layer.y / 100) * height;
    const pw = (layer.w / 100) * width;
    const ph = (layer.h / 100) * height;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    ctx.filter = filterCss(layer.filters, width / 1080);
    ctx.translate(px + pw / 2, py + ph / 2);
    ctx.rotate((layer.rotation * Math.PI) / 180);

    if (layer.type === "image" || layer.type === "sticker") {
      const img = IMAGE_CACHE.get(layer.src);
      if (img) drawMedia(ctx, layer, pw, ph, img, img.naturalWidth, img.naturalHeight);
    } else if (layer.type === "video") {
      const video = videos?.get(layer.src);
      if (video && video.videoWidth > 0) {
        drawMedia(ctx, layer, pw, ph, video, video.videoWidth, video.videoHeight);
      } else {
        ctx.fillStyle = resolveCssValue("var(--color-surface-2)", "#201F19");
        ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      }
    } else if (layer.type === "text") {
      const size = (layer.size / 1080) * width;
      const family = resolveCssValue(
        `var(--font-${layer.font})`,
        FONT_FALLBACK[layer.font],
      );
      ctx.font = `${layer.weight} ${size}px ${family}`;
      ctx.fillStyle = resolveCssValue(layer.color, "#FBFAF7");
      ctx.textAlign = layer.align === "center" ? "center" : layer.align === "right" ? "right" : "left";
      const anchorX = layer.align === "center" ? 0 : layer.align === "right" ? pw / 2 : -pw / 2;
      const lines = wrapText(ctx, layer.uppercase ? layer.text.toUpperCase() : layer.text, pw);
      const step = size * layer.lineHeight;
      lines.forEach((line, i) => {
        ctx.fillText(line, anchorX, -ph / 2 + i * step);
      });
    } else if (layer.type === "shape") {
      if (layer.shape === "line") {
        ctx.strokeStyle = resolveCssValue(layer.fill, "#FBFAF7");
        ctx.lineWidth = Math.max(1, Math.min(pw, ph));
        ctx.beginPath();
        ctx.moveTo(-pw / 2, 0);
        ctx.lineTo(pw / 2, 0);
        ctx.stroke();
      } else {
        if (layer.shape === "ellipse") {
          ctx.beginPath();
          ctx.ellipse(0, 0, pw / 2, ph / 2, 0, 0, Math.PI * 2);
        } else {
          roundRect(ctx, -pw / 2, -ph / 2, pw, ph, layer.radius);
        }
        if (layer.fill && layer.fill !== "transparent") {
          ctx.fillStyle = resolveCssValue(layer.fill, "#FBFAF7");
          ctx.fill();
        }
        if (layer.strokeWidth > 0) {
          ctx.strokeStyle = resolveCssValue(layer.stroke, "#16150F");
          ctx.lineWidth = layer.strokeWidth;
          ctx.stroke();
        }
      }
    } else if (layer.type === "bezier") {
      ctx.strokeStyle = resolveCssValue(layer.stroke, "#16150F");
      ctx.lineWidth = Math.max(1, Math.min(layer.strokeWidth, pw, ph));
      ctx.beginPath();
      const points = layer.points;
      if (points.length >= 2) {
        ctx.moveTo((points[0][0] / 100) * pw, (points[0][1] / 100) * ph);
        for (let i = 1; i < points.length; i += 1) {
          const p = points[i];
          ctx.lineTo((p[0] / 100) * pw, (p[1] / 100) * ph);
        }
      }
      if (layer.fill && layer.fill !== "transparent") {
        ctx.fillStyle = resolveCssValue(layer.fill, "#FBFAF7");
        ctx.fill();
      }
      if (layer.strokeWidth > 0) {
        ctx.strokeStyle = resolveCssValue(layer.stroke, "#16150F");
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Rend la composition dans un canvas hors écran. */
export async function renderToCanvas(
  layers: Layer[],
  opts: RenderOptions,
): Promise<HTMLCanvasElement> {
  await prepare(layers);
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible");
  drawLayers(ctx, layers, opts);
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg" | "image/webp",
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Encodage impossible"))),
      type,
      quality,
    );
  });
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
