/**
 * Constantes du PWA — un seul endroit pour les nom, couleurs et chemins.
 *
 * Le manifeste (`app/manifest.ts`), les métadonnées (`app/layout.tsx`), le
 * service worker et les écrans de réglages lisent tous ce fichier : changer
 * une icône ou une couleur ne demande pas de retrouver quatre littéraux.
 */

export const PWA_NAME = "DevNet — Le réseau des développeurs africains";
export const PWA_SHORT_NAME = "DevNet";
export const PWA_DESCRIPTION =
  "La plateforme d'échange entre étudiants et professionnels du numérique en Afrique.";
export const PWA_THEME_COLOR = "#11110E";
export const PWA_BACKGROUND_COLOR = "#11110E";
export const PWA_LIGHT_THEME_COLOR = "#F6F4EF";
/** Barre de statut du thème Savane : le vert nuit du fond. */
export const PWA_SAVANE_THEME_COLOR = "#0B1715";
export const PWA_LIGHT_BACKGROUND_COLOR = "#F6F4EF";
export const PWA_START_URL = "/feed";
export const PWA_SCOPE = "/";
export const PWA_MANIFEST_URL = "/manifest.webmanifest";

/**
 * Icônes de l'application — le mark « terminal » de la marque.
 *
 * iOS ne lit que PNG ; Android accepte le maskable ; les navigateurs de
 * bureau prennent le 48 et le 192. Toutes ces images sont produites par
 * `scripts/pwa/generate-assets.mjs` à partir du même dessin.
 */
export const PWA_ICONS = {
  icon48: "/icons/icon-48.png",
  icon72: "/icons/icon-72.png",
  icon96: "/icons/icon-96.png",
  icon144: "/icons/icon-144.png",
  icon192: "/icons/icon-192.png",
  icon256: "/icons/icon-256.png",
  icon384: "/icons/icon-384.png",
  icon512: "/icons/icon-512.png",
  icon1024: "/icons/icon-1024.png",
  maskable512: "/icons/maskable-512.png",
  monochrome512: "/icons/monochrome-512.png",
  appleTouch: "/icons/apple-touch-icon.png",
} as const;

export const PWA_SCREENSHOTS = {
  desktop: "/screenshots/desktop.png",
  mobile: "/screenshots/mobile.png",
} as const;

/**
 * Écrans de démarrage iOS.
 *
 * Safari affiche un rectangle blanc (ou noir) entre l'appui sur l'icône et
 * le premier rendu — c'est le seul moment où l'application ne ressemble pas
 * à une application. Une image de démarrage par couple écran/densité comble
 * ce vide, et iOS la choisit d'après la requête média exacte.
 */
export const PWA_SPLASHES: ReadonlyArray<{ url: string; media: string }> = [
  [640, 1136, 2, 320, 568],
  [750, 1334, 2, 375, 667],
  [828, 1792, 2, 414, 896],
  [1125, 2436, 3, 375, 812],
  [1170, 2532, 3, 390, 844],
  [1179, 2556, 3, 393, 852],
  [1242, 2208, 3, 414, 736],
  [1242, 2688, 3, 414, 896],
  [1284, 2778, 3, 428, 926],
  [1290, 2796, 3, 430, 932],
  [1320, 2868, 3, 440, 956],
  [1536, 2048, 2, 768, 1024],
  [1620, 2160, 2, 810, 1080],
  [1668, 2224, 2, 834, 1112],
  [2048, 2732, 2, 1024, 1366],
].map(([width, height, ratio, cssWidth, cssHeight]) => ({
  url: `/splash/splash-${width}x${height}.png`,
  media: `(device-width: ${cssWidth}px) and (device-height: ${cssHeight}px) and (-webkit-device-pixel-ratio: ${ratio})`,
}));

export const PWA_OFFLINE_URL = "/offline.html";
export const PWA_SERVICE_WORKER_URL = "/sw.js";
export const PWA_INSTALL_DISMISSED_KEY = "devnet:pwa:install-dismissed";
export const PWA_INSTALL_DISMISS_MS = 1000 * 60 * 60 * 24 * 30;
