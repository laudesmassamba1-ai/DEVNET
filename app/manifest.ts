import type { MetadataRoute } from "next";
import {
  PWA_BACKGROUND_COLOR,
  PWA_DESCRIPTION,
  PWA_ICONS,
  PWA_NAME,
  PWA_SCOPE,
  PWA_SCREENSHOTS,
  PWA_SHORT_NAME,
  PWA_START_URL,
  PWA_THEME_COLOR,
} from "@/lib/pwa";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: PWA_SCOPE,
    name: PWA_NAME,
    short_name: PWA_SHORT_NAME,
    description: PWA_DESCRIPTION,
    lang: "fr",
    dir: "ltr",
    start_url: PWA_START_URL,
    scope: PWA_SCOPE,
    display: "standalone",
    // On réclame le mode le plus intégré disponible, sans jamais dégrader
    // l'affichage sur un navigateur qui ne connaît pas ces modes.
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR,
    categories: ["social", "developer", "education", "productivity"],
    prefer_related_applications: false,
    launch_handler: { client_mode: "navigate-existing" },
    icons: [
      { src: PWA_ICONS.icon48, sizes: "48x48", type: "image/png", purpose: "any" },
      { src: PWA_ICONS.icon72, sizes: "72x72", type: "image/png", purpose: "any" },
      { src: PWA_ICONS.icon96, sizes: "96x96", type: "image/png", purpose: "any" },
      { src: PWA_ICONS.icon144, sizes: "144x144", type: "image/png", purpose: "any" },
      { src: PWA_ICONS.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: PWA_ICONS.icon256, sizes: "256x256", type: "image/png", purpose: "any" },
      { src: PWA_ICONS.icon384, sizes: "384x384", type: "image/png", purpose: "any" },
      { src: PWA_ICONS.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: PWA_ICONS.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: PWA_ICONS.monochrome512, sizes: "512x512", type: "image/png", purpose: "monochrome" },
    ],
    screenshots: [
      {
        src: PWA_SCREENSHOTS.desktop,
        sizes: "1280x720",
        type: "image/png",
        form_factor: "wide",
        label: "Le fil DevNet sur ordinateur",
      },
      {
        src: PWA_SCREENSHOTS.mobile,
        sizes: "1080x1920",
        type: "image/png",
        form_factor: "narrow",
        label: "Le fil DevNet sur mobile",
      },
    ],
    shortcuts: [
      {
        name: "Fil",
        short_name: "Fil",
        description: "Ouvrir le fil d'actualité",
        url: "/feed",
        icons: [{ src: PWA_ICONS.icon192, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Messages",
        short_name: "Messages",
        description: "Ouvrir les messages privés",
        url: "/messages",
        icons: [{ src: PWA_ICONS.icon192, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Notifications",
        short_name: "Notifications",
        description: "Ouvrir le centre de notifications",
        url: "/notifications",
        icons: [{ src: PWA_ICONS.icon192, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Recherche",
        short_name: "Recherche",
        description: "Chercher des personnes, posts et hashtags",
        url: "/search",
        icons: [{ src: PWA_ICONS.icon192, sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
