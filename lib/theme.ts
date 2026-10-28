/**
 * Thème visuel.
 *
 * Le choix vit en base (`users.theme`), mais il ne concerne pas que
 * l'écran Paramètres : toute l'application doit le porter. On applique
 * donc `data-theme` sur `<html>`, lu par la CSS (`:root[data-theme="light"]`).
 *
 * Pour éviter un clignotement au chargement, on garde une copie du choix
 * dans `localStorage` : le script `beforeInteractive` du layout la lit
 * avant l'hydratation, puis `ThemeApplier` resynchronise avec la base dès
 * que le profil est résolu.
 */

export const DEFAULT_THEME = "liquid-bleu";
export const LIGHT_THEME = "light";

/** Copie locale du thème — lue avant l'hydratation, pour éviter le flash. */
export const THEME_STORAGE_KEY = "devnet:theme";

/** Événement par lequel l'écran Paramètres demande un changement immédiat. */
export const THEME_EVENT = "devnet:theme";

/** Ramène toute valeur inconnue au thème par défaut. */
export function normalizeTheme(theme: string | null | undefined): string {
  return theme === LIGHT_THEME ? LIGHT_THEME : DEFAULT_THEME;
}

/** Applique le thème au document et mémorise le choix localement. */
export function applyTheme(theme: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const value = normalizeTheme(theme);
  document.documentElement.dataset.theme = value;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Navigation privée : le thème reste appliqué, il n'est simplement
    // pas retenu pour la prochaine visite.
  }
}

/**
 * Applique le thème **et** prévient `ThemeApplier`.
 *
 * L'écran Paramètres s'en sert pour un aperçu en direct : le `<html>` change
 * avant même que le profil soit rechargé depuis la base.
 */
export function broadcastTheme(theme: string): void {
  if (typeof window === "undefined") return;
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}
