/**
 * Export d'un statut : la même scène que l'aperçu, dessinée sur un canvas
 * 1080 × 1920, puis encodée en WebP. Pur côté navigateur, sans React.
 */
import {
  BACKGROUND_VARS,
  FILTERS,
  INK_VARS,
  STAGE_H,
  STAGE_W,
  type Layer,
} from "@/lib/status-editor-model";
import { paintScene } from "@/lib/status-render";

export type ExportScene = {
  imageUrl: string | null;
  background: number;
  filter: number;
  zoom: number;
  layers: Layer[];
};

/** Valeur résolue d'une variable de thème : le canvas n'accepte pas `var(...)`. */
export function themeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * Rend la scène en WebP. Une photo illisible retombe sur le fond uni : mieux
 * vaut un statut sans photo qu'un échec silencieux.
 */
export async function renderStageBlob(scene: ExportScene): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const image = scene.imageUrl ? await loadImage(scene.imageUrl) : null;
  const [a, b] = BACKGROUND_VARS[scene.background] ?? BACKGROUND_VARS[0];

  paintScene(context, {
    image,
    palette: [themeColor(a, "#000"), themeColor(b, "#000")],
    filterCss: FILTERS[scene.filter]?.css ?? "none",
    zoom: scene.zoom,
    layers: scene.layers,
    colorOf: (index) => themeColor(INK_VARS[index] ?? INK_VARS[0], "#fff"),
    pillColor: themeColor("--color-void", "#000"),
  });

  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
}
