/**
 * Export canvas d'un statut : fond, photo filtrée, puis calques dans l'ordre.
 *
 * Le repère et les tailles viennent de `status-editor-model` : l'aperçu et
 * ce fichier partagent les mêmes constantes. Ce module ne lit ni le DOM ni le
 * thème : les couleurs arrivent résolues (`colorOf`), parce que le canvas
 * n'accepte pas `var(...)`.
 */
import {
  STAGE_H,
  STAGE_W,
  STICKER_SCALE,
  STROKE_WIDTHS,
  TEXT_BOX_RATIO,
  TEXT_SIZES,
  ZOOMS,
  wrapLines,
  type Layer,
} from "./status-editor-model";

export type PaintScene = {
  /** Photo décodée, ou `null` pour un fond uni. */
  image: CanvasImageSource | null;
  /** Deux couleurs résolues du dégradé de fond. */
  palette: [string, string];
  /** Chaîne CSS de filtre, identique à celle de l'aperçu. */
  filterCss: string;
  /** Index dans `ZOOMS`, identique à celui de l'aperçu. */
  zoom: number;
  layers: Layer[];
  /** Couleur résolue d'un index d'encre. */
  colorOf: (index: number) => string;
  /** Couleur de fond des pastilles, résolue. */
  pillColor: string;
};

const LINE_HEIGHT = 1.22;
const PILL_ALPHA = 0.55;

export function paintScene(context: CanvasRenderingContext2D, scene: PaintScene): void {
  paintBackground(context, scene);
  for (const layer of scene.layers) {
    if (layer.kind === "stroke") paintStroke(context, layer, scene);
    else if (layer.kind === "sticker") paintSticker(context, layer);
    else paintText(context, layer, scene);
  }
}

function paintBackground(context: CanvasRenderingContext2D, scene: PaintScene): void {
  if (scene.image) {
    const image = scene.image as HTMLImageElement;
    const width = (image.naturalWidth || image.width) as number;
    const height = (image.naturalHeight || image.height) as number;
    const scale = Math.max(STAGE_W / width, STAGE_H / height) * (ZOOMS[scene.zoom] ?? 1);
    const drawW = width * scale;
    const drawH = height * scale;
    // Le filtre est cuit dans les pixels : l'export ne dépend d'aucune
    // propriété stockée hors du fichier.
    context.filter = scene.filterCss;
    context.drawImage(scene.image, (STAGE_W - drawW) / 2, (STAGE_H - drawH) / 2, drawW, drawH);
    context.filter = "none";
    return;
  }
  const gradient = context.createLinearGradient(0, 0, STAGE_W, STAGE_H);
  gradient.addColorStop(0, scene.palette[0]);
  gradient.addColorStop(1, scene.palette[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, STAGE_W, STAGE_H);
}

function paintStroke(
  context: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: "stroke" }>,
  scene: PaintScene,
): void {
  if (layer.points.length === 0) return;
  context.save();
  context.strokeStyle = scene.colorOf(layer.color);
  context.lineWidth = (STROKE_WIDTHS[layer.width] ?? STROKE_WIDTHS[1]) * STAGE_W;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  layer.points.forEach(([px, py], index) => {
    const x = (px / 100) * STAGE_W;
    const y = (py / 100) * STAGE_H;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  if (layer.points.length === 1) {
    // Un simple appui devient une pastille pleine, de la taille du trait.
    const [px, py] = layer.points[0];
    context.fillStyle = scene.colorOf(layer.color);
    context.beginPath();
    context.arc((px / 100) * STAGE_W, (py / 100) * STAGE_H, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.stroke();
  }
  context.restore();
}

function paintSticker(context: CanvasRenderingContext2D, layer: Extract<Layer, { kind: "sticker" }>): void {
  const size = STICKER_SCALE * STAGE_W;
  context.save();
  context.font = `${Math.round(size)}px ui-sans-serif, system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,0.35)";
  context.shadowBlur = 12;
  context.fillText(layer.glyph, (layer.x / 100) * STAGE_W, (layer.y / 100) * STAGE_H);
  context.restore();
}

function paintText(context: CanvasRenderingContext2D, layer: Extract<Layer, { kind: "text" }>, scene: PaintScene): void {
  const body = layer.text.trim();
  if (!body) return;
  const fontSize = Math.round(TEXT_SIZES[layer.size] * STAGE_W);
  const boxWidth = TEXT_BOX_RATIO * STAGE_W;
  const font = `800 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  context.save();
  context.font = font;
  const lines = wrapLines(body, boxWidth, (value) => context.measureText(value).width);
  const lineHeight = fontSize * LINE_HEIGHT;
  const centerX = (layer.x / 100) * STAGE_W;
  const centerY = (layer.y / 100) * STAGE_H;
  // Le bloc est centré sur la position ; l'alignement se fait dans sa boîte.
  const boxLeft = centerX - boxWidth / 2;
  const anchor = layer.align === 0 ? boxLeft : layer.align === 2 ? boxLeft + boxWidth : centerX;
  const align = (["left", "center", "right"] as const)[layer.align];
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
  context.textAlign = align;
  context.textBaseline = "middle";
  const fill = scene.colorOf(layer.color);

  if (layer.pill) {
    context.save();
    context.globalAlpha = PILL_ALPHA;
    context.fillStyle = scene.pillColor;
    const pad = fontSize * 0.28;
    lines.forEach((line, index) => {
      const width = context.measureText(line).width;
      const left = layer.align === 0 ? anchor : layer.align === 2 ? anchor - width : anchor - width / 2;
      const top = startY + index * lineHeight - lineHeight / 2;
      context.fillRect(left - pad, top, width + pad * 2, lineHeight);
    });
    context.restore();
  } else {
    context.shadowColor = "rgba(0,0,0,0.45)";
    context.shadowBlur = 18;
  }

  context.fillStyle = fill;
  lines.forEach((line, index) => {
    // Les lignes sont déjà coupées par `wrapLines` : pas de maxWidth, qui
    // comprimerait la police au lieu de couper.
    context.fillText(line, anchor, startY + index * lineHeight);
  });
  context.restore();
}
