export const PWA_NAME = "DevNet — Le réseau des développeurs africains";
export const PWA_SHORT_NAME = "DevNet";
export const PWA_DESCRIPTION =
  "La plateforme d'échange entre étudiants et professionnels du numérique en Afrique.";
export const PWA_THEME_COLOR = "#11110E";
export const PWA_BACKGROUND_COLOR = "#11110E";
export const PWA_LIGHT_THEME_COLOR = "#F6F4EF";
export const PWA_LIGHT_BACKGROUND_COLOR = "#F6F4EF";
export const PWA_START_URL = "/feed";
export const PWA_SCOPE = "/";

export const PWA_ICONS = {
  icon48: "/icons/icon-48.png",
  icon192: "/icons/icon-192.png",
  icon512: "/icons/icon-512.png",
  maskable512: "/icons/maskable-512.png",
  appleTouch: "/icons/apple-touch-icon.png",
} as const;

export const PWA_SCREENSHOTS = {
  desktop: "/screenshots/desktop.png",
  mobile: "/screenshots/mobile.png",
} as const;

export const PWA_OFFLINE_URL = "/offline.html";
export const PWA_SERVICE_WORKER_URL = "/sw.js";
export const PWA_INSTALL_DISMISSED_KEY = "devnet:pwa:install-dismissed";
export const PWA_INSTALL_DISMISS_MS = 1000 * 60 * 60 * 24 * 30;
