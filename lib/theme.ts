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

/**
 * Le thème par défaut est le sombre, **pas** un nom historique.
 *
 * `DEFAULT_THEME` valait `"liquid-bleu"` : un nom qui ne correspondait à
 * aucun sélecteur CSS. Il ne cassait rien parce que tout thème inconnu
 * retombe sur les tokens sombres de `:root` — donc le défaut marchait par
 * accident, et la valeur écrite en base ne décrivait pas ce qui s'affichait.
 */
export const DEFAULT_THEME = "dark";
export const LIGHT_THEME = "light";

/**
 * Troisième thème : vert profond, or et ivoire.
 *
 * Il n'est pas une variante du sombre mais une palette à part entière :
 * fond vert nuit (`#0B1715`), surfaces vertes relevées, texte ivoire
 * (`#F4F1E8`), action turquoise (`#20BFA9`), or (`#D6A84F`) réservé aux
 * distinctions — anneau de story, niveaux, badges — et vert `#087F5B`
 * pour la progression. Les composants ne changent pas : tout passe par
 * les jetons de `globals.css`.
 */
export const SAVANE_THEME = "savane";

/**
 * Savane en plein jour : ivoire, encre verte, or profond.
 *
 * Même densité et mêmes familles que la version nuit — c'est la même
 * direction graphique sous une autre lumière, pas un quatrième univers.
 */
export const SAVANE_LIGHT_THEME = "savane-clair";

/**
 * Thèmes proposés à l'utilisateur, dans l'ordre d'affichage.
 *
 * Une seule liste : les Paramètres et le profil piochent dedans, et
 * `normalizeTheme` accepte exactement ces identifiants. Une valeur
 * inconnue retombe sur le défaut au lieu de produire un écran sans
 * couleurs.
 */
export const THEMES = [
  { id: DEFAULT_THEME, label: "Encre", hint: "Le défaut, sombre et chaud.", icon: "moon" },
  { id: LIGHT_THEME, label: "Papier", hint: "Ivoire, encre, lumière du jour.", icon: "sun" },
  { id: SAVANE_THEME, label: "Savane", hint: "Vert profond, or, turquoise.", icon: "globe" },
  { id: SAVANE_LIGHT_THEME, label: "Savane clair", hint: "Ivoire, encre verte, or profond.", icon: "compass" },
] as const;

/** Copie locale du thème — lue avant l'hydratation, pour éviter le flash. */
export const THEME_STORAGE_KEY = "devnet:theme";

/** Événement par lequel l'écran Paramètres demande un changement immédiat. */
export const THEME_EVENT = "devnet:theme";

/** Ramène toute valeur inconnue au thème par défaut. */
export function normalizeTheme(theme: string | null | undefined): string {
  // Toute valeur inconnue (dont l'ancien `liquid-bleu`) devient le défaut :
  // un profil qui porte encore l'ancien nom affiche le thème sombre, qui
  // est bien ce qu'il voyait déjà.
  const known = THEMES.find((entry) => entry.id === theme);
  return known ? known.id : DEFAULT_THEME;
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
