export type FeedDensity = "comfortable" | "compact";

export const FEED_DENSITY_KEY = "devnet:feed-density";
export const REDUCED_MOTION_KEY = "devnet:reduced-motion";

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
