/**
 * Modèle de l'éditeur de statut : calques, historique annulable, géométrie.
 *
 * Tout ce fichier est pur (ni DOM ni canvas) pour être testé seul. L'aperçu
 * et l'export lisent les **mêmes** calques, dans le même repère :
 *   - positions et tracés en pourcentage de la scène (0–100) ;
 *   - tailles en fraction de la largeur de scène ;
 *   - scène de référence 1080 × 1920 (9:16).
 * Ainsi ce qu'on voit est ce qui est publié, quelle que soit la taille d'écran.
 */

export const STAGE_W = 1080;
export const STAGE_H = 1920;

/** Fractions de la largeur de scène pour le texte. */
export const TEXT_SIZES = [0.09, 0.07, 0.052] as const;
export const TEXT_SIZE_LABEL = ["Grand", "Moyen", "Petit"] as const;

/** Variables de thème pour les encres (texte et dessin). Jamais de hex ici. */
export const INK_VARS = [
  "--story-ink-1",
  "--story-ink-2",
  "--story-ink-3",
  "--story-ink-4",
] as const;
export const INK_LABEL = ["Blanc", "Encre", "Ambre", "Menthe"] as const;

/** Épaisseurs de trait, en fraction de la largeur de scène. */
export const STROKE_WIDTHS = [0.012, 0.024, 0.045] as const;
export const STROKE_LABEL = ["Fin", "Moyen", "Épais"] as const;

/** Stickers émoji, rendus comme du texte : identiques partout. */
export const STICKER_GLYPHS = ["😂", "🔥", "❤️", "😍", "🎉", "👏", "😮", "💯", "🌿", "📍"] as const;

/** Taille d'un sticker, fraction de la largeur de scène. */
export const STICKER_SCALE = 0.16;

/** Fonds unis, variables CSS (le thème reste la seule source). */
export const BACKGROUND_VARS: [string, string][] = [
  ["--story-bg-1-a", "--story-bg-1-b"],
  ["--story-bg-2-a", "--story-bg-2-b"],
  ["--story-bg-3-a", "--story-bg-3-b"],
  ["--story-bg-4-a", "--story-bg-4-b"],
  ["--story-bg-5-a", "--story-bg-5-b"],
  ["--story-bg-6-a", "--story-bg-6-b"],
  ["--story-bg-7-a", "--story-bg-7-b"],
  ["--story-bg-8-a", "--story-bg-8-b"],
];

/**
 * Filtres : chaînes CSS passées telles quelles à l'aperçu ET au canvas.
 * Un filtre affiché ne peut donc pas différer du fichier publié.
 */
export const FILTERS: { label: string; css: string }[] = [
  { label: "Naturel", css: "none" },
  { label: "Chaud", css: "saturate(1.08) sepia(0.22) brightness(1.03)" },
  { label: "Froid", css: "saturate(0.94) hue-rotate(-10deg) brightness(1.03)" },
  { label: "Vintage", css: "sepia(0.4) saturate(0.82) contrast(0.94) brightness(1.04)" },
  { label: "Cinéma", css: "contrast(1.16) saturate(0.88) brightness(0.96)" },
  { label: "Noir et blanc", css: "grayscale(1) contrast(1.06)" },
  { label: "Contrasté", css: "contrast(1.24) saturate(1.08)" },
  { label: "Doux", css: "brightness(1.06) contrast(0.92) saturate(0.9)" },
];

/**
 * Cadrage de la photo : zoom centré. Aperçu (`transform: scale`) et export
 * (`drawImage`) utilisent ces mêmes facteurs.
 */
export const ZOOMS = [1, 1.25, 1.5] as const;
export const ZOOM_LABEL = ["Plein", "Serré", "Très serré"] as const;

/** Couleurs de dessin, en index de `INK_VARS`. */
export const PEN_COLORS = [0, 1, 2, 3] as const;

export const ALIGN_LABEL = ["gauche", "centre", "droite"] as const;
export type Align = 0 | 1 | 2;

/** Largeur du bloc de texte, fraction de la scène. Sert à l'alignement. */
export const TEXT_BOX_RATIO = 0.82;

/** Marges de sécurité : un calque ne sort pas de la scène. */
const MIN_PCT = 4;
const MAX_PCT = 96;

export type TextLayer = {
  id: string;
  kind: "text";
  text: string;
  x: number;
  y: number;
  size: number;
  color: number;
  align: Align;
  /** Fond en pastille derrière chaque ligne, pour lire sur une photo. */
  pill: boolean;
};

export type StrokeLayer = {
  id: string;
  kind: "stroke";
  /** Points en pourcentage de la scène. */
  points: [number, number][];
  color: number;
  /** Index dans `STROKE_WIDTHS`. */
  width: number;
};

export type StickerLayer = {
  id: string;
  kind: "sticker";
  glyph: string;
  x: number;
  y: number;
};

export type Layer = TextLayer | StrokeLayer | StickerLayer;

/** Un instantané complet : tout ce qui est annulable. */
export type Snapshot = {
  layers: Layer[];
  filter: number;
  background: number;
  /** Index dans `ZOOMS`. */
  zoom: number;
};

export type History = {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
  /** État avant le geste en cours (glisser, tracer), pour que `commit` l'annule. */
  base: Snapshot | null;
};

const HISTORY_LIMIT = 100;

let sequence = 0;
/** Identifiant de calque, unique dans la session d'éditeur. */
export function nextLayerId(kind: Layer["kind"]): string {
  sequence += 1;
  return `${kind}-${sequence}`;
}

export function clampPct(value: number): number {
  return Math.min(MAX_PCT, Math.max(MIN_PCT, value));
}

export function emptySnapshot(): Snapshot {
  return { layers: [], filter: 0, background: 0, zoom: 0 };
}

export function createHistory(initial: Snapshot = emptySnapshot()): History {
  return { past: [], present: initial, future: [], base: null };
}

/**
 * Enregistre un changement annulable. Après un geste (`live`), l'étape
 * empilée est l'état d'AVANT le geste, pas l'état intermédiaire.
 */
export function commit(history: History, next: Snapshot): History {
  const before = history.base ?? history.present;
  return {
    past: [...history.past, before].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    base: null,
  };
}

/**
 * Met à jour l'état courant sans créer d'étape : utilisé pendant un geste
 * (glisser, tracer). Le premier `live` mémorise l'état de départ ; `commit`
 * l'enregistre à la fin du geste.
 */
export function live(history: History, next: Snapshot): History {
  return { ...history, present: next, base: history.base ?? history.present };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    base: null,
  };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
    base: null,
  };
}

/** Texte en tête de la liste : il est au-dessus des tracés existants. */
export function addTextLayer(layers: Layer[], x = 50, y = 46): { layers: Layer[]; id: string } {
  const id = nextLayerId("text");
  const layer: TextLayer = {
    id,
    kind: "text",
    text: "",
    x: clampPct(x),
    y: clampPct(y),
    size: 0,
    color: 0,
    align: 1,
    pill: false,
  };
  return { layers: [...layers, layer], id };
}

export function addStrokeLayer(layers: Layer[], point: [number, number], color: number, width: number) {
  const id = nextLayerId("stroke");
  const layer: StrokeLayer = { id, kind: "stroke", points: [point], color, width };
  return { layers: [...layers, layer], id };
}

export function appendStrokePoint(layers: Layer[], id: string, point: [number, number]): Layer[] {
  return layers.map((layer) =>
    layer.id === id && layer.kind === "stroke"
      ? { ...layer, points: [...layer.points, point] }
      : layer,
  );
}

export function addStickerLayer(layers: Layer[], glyph: string, x = 50, y = 40): { layers: Layer[]; id: string } {
  const id = nextLayerId("sticker");
  const layer: StickerLayer = { id, kind: "sticker", glyph, x: clampPct(x), y: clampPct(y) };
  return { layers: [...layers, layer], id };
}

/** Applique `patch` au calque `id`. Les autres calques ne bougent pas. */
export function updateLayer(layers: Layer[], id: string, patch: Partial<Omit<TextLayer, "id" | "kind">>): Layer[] {
  return layers.map((layer) => (layer.id === id ? ({ ...layer, ...patch } as Layer) : layer));
}

export function moveLayer(layers: Layer[], id: string, x: number, y: number): Layer[] {
  return layers.map((layer) => {
    if (layer.id !== id) return layer;
    if (layer.kind === "stroke") return layer;
    return { ...layer, x: clampPct(x), y: clampPct(y) };
  });
}

export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers.filter((layer) => layer.id !== id);
}

/** Calques dont le texte n'est pas vide, pour l'aperçu de la liste. */
export function textOf(layers: Layer[]): string {
  return layers
    .flatMap((layer) => (layer.kind === "text" && layer.text.trim() ? [layer.text.trim()] : []))
    .join(" ");
}

/** Un statut publiable contient au moins un calque, ou un fond à montrer. */
export function hasContent(layers: Layer[]): boolean {
  return layers.some((layer) => layer.kind !== "text" || layer.text.trim().length > 0);
}

/**
 * Coupe un texte en lignes qui tiennent dans `maxWidth`.
 *
 * `measure` renvoie la largeur d'une chaîne dans la police courante. Le canvas
 * la fournit en production ; les tests fournissent une largeur fixe.
 * Un mot plus long que la ligne est découpé par caractères.
 */
export function wrapLines(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
      while (measure(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}
