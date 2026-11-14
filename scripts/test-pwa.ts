import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import manifest from "../app/manifest";
import {
  PWA_BACKGROUND_COLOR,
  PWA_DESCRIPTION,
  PWA_ICONS,
  PWA_NAME,
  PWA_OFFLINE_URL,
  PWA_SCREENSHOTS,
  PWA_SHORT_NAME,
  PWA_SPLASHES,
  PWA_START_URL,
  PWA_THEME_COLOR,
} from "@/lib/pwa";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

function publicFile(url: string): string {
  return path.join(process.cwd(), "public", url.replace(/^\//, ""));
}

async function checkImage(file: string, sizes: string) {
  const absolute = publicFile(file);
  check(`image présente : ${file}`, existsSync(absolute), absolute);
  if (!existsSync(absolute)) return;

  const metadata = await sharp(absolute).metadata();
  check(`image PNG : ${file}`, metadata.format === "png", metadata.format);
  check(`dimensions : ${file}`, `${metadata.width}x${metadata.height}` === sizes, {
    expected: sizes,
    actual: `${metadata.width}x${metadata.height}`,
  });
}

function checkSource(file: string, snippets: string[]) {
  const absolute = path.join(process.cwd(), file);
  check(`fichier présent : ${file}`, existsSync(absolute), absolute);
  if (!existsSync(absolute)) return;
  const text = readFileSync(absolute, "utf8");
  for (const snippet of snippets) {
    check(`${file} contient ${snippet}`, text.includes(snippet));
  }
}

async function main() {
  const data = manifest();

  check("manifeste : nom", data.name === PWA_NAME, data.name);
  check("manifeste : nom court", data.short_name === PWA_SHORT_NAME, data.short_name);
  check("manifeste : description", data.description === PWA_DESCRIPTION);
  check("manifeste : démarrage", data.start_url === PWA_START_URL, data.start_url);
  check("manifeste : portée", data.scope === "/", data.scope);
  check("manifeste : plein écran", data.display === "standalone", data.display);
  check("manifeste : thème", data.theme_color === PWA_THEME_COLOR, data.theme_color);
  check("manifeste : fond", data.background_color === PWA_BACKGROUND_COLOR);
  check("manifeste : langue", data.lang === "fr", data.lang);
  check("manifeste : orientation libre", data.orientation === "any", data.orientation);
  check("manifeste : lancement existant", data.launch_handler?.client_mode === "navigate-existing");

  const icons = data.icons ?? [];
  check("manifeste : icône 48", icons.some((icon) => icon.src === PWA_ICONS.icon48));
  check("manifeste : icône 192", icons.some((icon) => icon.src === PWA_ICONS.icon192));
  check("manifeste : icône 512", icons.some((icon) => icon.src === PWA_ICONS.icon512));
  check(
    "manifeste : icône maskable",
    icons.some((icon) => icon.src === PWA_ICONS.maskable512 && icon.purpose === "maskable"),
  );

  await checkImage(PWA_ICONS.icon48, "48x48");
  await checkImage(PWA_ICONS.icon192, "192x192");
  await checkImage(PWA_ICONS.icon512, "512x512");
  await checkImage(PWA_ICONS.maskable512, "512x512");
  await checkImage(PWA_ICONS.appleTouch, "180x180");
  await checkImage(PWA_ICONS.icon1024, "1024x1024");
  await checkImage(PWA_ICONS.icon72, "72x72");
  await checkImage(PWA_ICONS.icon96, "96x96");
  await checkImage(PWA_ICONS.icon144, "144x144");
  await checkImage(PWA_ICONS.icon256, "256x256");
  await checkImage(PWA_ICONS.icon384, "384x384");
  await checkImage(PWA_ICONS.monochrome512, "512x512");
  check(
    "manifeste : icône monochrome",
    icons.some((icon) => icon.src === PWA_ICONS.monochrome512 && icon.purpose === "monochrome"),
  );

  // Les écrans de démarrage iOS : chaque fichier existe, à la taille physique
  // annoncée par sa requête média — sinon Safari affiche un rectangle noir.
  for (const splash of PWA_SPLASHES) {
    const match = /splash-(\d+)x(\d+)\.png$/.exec(splash.url);
    check(`écran de démarrage : nom ${splash.url}`, Boolean(match), splash.url);
    if (match) await checkImage(splash.url, `${match[1]}x${match[2]}`);
    check(
      `écran de démarrage : requête média ${splash.url}`,
      splash.media.startsWith("(device-width:") &&
        splash.media.includes("-webkit-device-pixel-ratio"),
      splash.media,
    );
  }

  const screenshots = data.screenshots ?? [];
  check("manifeste : capture large", screenshots.some((shot) => shot.form_factor === "wide"));
  check("manifeste : capture mobile", screenshots.some((shot) => shot.form_factor === "narrow"));
  await checkImage(PWA_SCREENSHOTS.desktop, "1280x720");
  await checkImage(PWA_SCREENSHOTS.mobile, "1080x1920");

  const shortcuts = data.shortcuts ?? [];
  check("manifeste : raccourci Fil", shortcuts.some((item) => item.url === "/feed"));
  check("manifeste : raccourci Messages", shortcuts.some((item) => item.url === "/messages"));
  check(
    "manifeste : raccourci Notifications",
    shortcuts.some((item) => item.url === "/notifications"),
  );
  check("manifeste : raccourci Recherche", shortcuts.some((item) => item.url === "/search"));

  checkSource("public/sw.js", [
    "install",
    "activate",
    "fetch",
    "SKIP_WAITING",
    PWA_OFFLINE_URL,
    "/api/",
    "_next/static",
    "PUBLIC_PAGES",
    "caches.delete",
  ]);

  const sw = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  check("service worker : cache limité", !sw.includes('caches.open("devnet-app"'));
  /* Mode hors-ligne réel : les lectures de l'API sont mises en cache
     (réseau d'abord, cache au secours), les écritures jamais, la sonde
     jamais, et la déconnexion purge données et pages visitées. */
  check("service worker : cache de données dédié", sw.includes("DATA_CACHE"));
  check("service worker : lectures en réseau d'abord", sw.includes("networkFirstData"));
  check("service worker : écritures jamais interceptées", /method !== "GET"/.test(sw));
  check("service worker : sonde hors cache", sw.includes('/api/backend-check"'));
  check("service worker : déconnexion purge données et pages", sw.includes("caches.delete(PAGE_CACHE)"));
  /* Le film de présentation et les captures sont des fichiers de build :
     sans eux dans la branche statique, /login se rouvre hors-ligne avec un
     cadre vide. Les médias d'API (avatars, photos de statut) suivent une
     autre route : une image déjà vue doit rester visible. */
  check("service worker : film et captures mis en cache", sw.includes('startsWith("/motion/")'));
  check("service worker : médias d'API en cache", sw.includes("mediaFirst"));
  check("service worker : repli image sans icône cassée", sw.includes("image/svg+xml"));
  check("service worker : version de cache à jour", /devnet-pwa-v\d+/.test(sw));

  checkSource(PWA_OFFLINE_URL.replace(/^\//, "public/"), [
    'lang="fr"',
    "Tu es hors ligne",
    "Réessayer",
    'href="/manifest.webmanifest"',
    "safe-area-inset-top",
  ]);

  checkSource("components/PwaManager.tsx", [
    "beforeinstallprompt",
    "appinstalled",
    ".register(PWA_SERVICE_WORKER_URL)",
    "SKIP_WAITING",
    "display-mode: standalone",
    "navigator.onLine",
    "usePwa",
  ]);
  checkSource("app/layout.tsx", [
    "PwaManager",
    "appleWebApp",
    "PWA_ICONS",
    "viewportFit",
    "startupImage",
  ]);
  checkSource("app/settings/page.tsx", ["PwaInstallSection", "Installer DevNet"]);

  console.log(`\n${passed} vérifications PWA réussies.`);
  if (failures.length) {
    console.error(`\n${failures.length} échec(s) :`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("PWA : manifeste, icônes, service worker et hors-ligne conformes.");
}

void main();
