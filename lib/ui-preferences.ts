export type FeedDensity = "comfortable" | "compact";

export const FEED_DENSITY_KEY = "devnet:feed-density";
export const REDUCED_MOTION_KEY = "devnet:reduced-motion";

/* ── Niveau de mouvement ──
   Trois niveaux, du plus calme au plus vivant. `sobre` est l'ancien
   « réduire les animations » : tout est coupé. `essentiel` garde les
   entrées et les retours d'action mais coupe l'ambiance continue
   (respirations, balayages, sonar). `standard` est la grammaire
   complète — le défaut, donc la valeur absente du stockage. */
export const MOTION_LEVEL_KEY = "devnet:motion-level";

export type MotionLevel = "standard" | "essentiel" | "sobre";

export function normalizeMotionLevel(value: string | null | undefined): MotionLevel {
  return value === "sobre" || value === "essentiel" ? value : "standard";
}

/**
 * Pose le niveau sur `<html>` et le mémorise.
 *
 * `sobre` reste porté par `data-reduce-motion` : tout le CSS et le
 * JavaScript existants (Tilt, useCount, waitForExit) coupent déjà sur
 * cet attribut — inutile de dupliquer la mécanique.
 */
export function applyMotionLevel(level: MotionLevel): boolean {
  if (typeof document === "undefined") return false;
  document.documentElement.dataset.motionLevel = level;
  document.documentElement.dataset.reduceMotion = level === "sobre" ? "true" : "false";
  try {
    localStorage.setItem(MOTION_LEVEL_KEY, level);
    return true;
  } catch {
    return false;
  }
}

/* ── Verre liquide ──
   Thème optionnel, indépendant de la palette : il pose `data-liquid` sur
   <html>, et le bloc `:root` avec data-liquid dans globals.css fait le
   reste. Absent du stockage = désactivé (le rendu plat d'origine). */
export const LIQUID_GLASS_KEY = "devnet:liquid-glass";

export function normalizeLiquidGlass(value: string | null | undefined): boolean {
  return value === "true";
}

export function applyLiquidGlass(enabled: boolean): boolean {
  if (typeof document === "undefined") return false;
  if (enabled) {
    document.documentElement.dataset.liquid = "true";
  } else {
    delete document.documentElement.dataset.liquid;
  }
  try {
    localStorage.setItem(LIQUID_GLASS_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function applyReducedMotion(enabled: boolean): boolean {
  if (typeof document === "undefined") return false;
  document.documentElement.dataset.reduceMotion = enabled ? "true" : "false";
  try {
    localStorage.setItem(REDUCED_MOTION_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}
