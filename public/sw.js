const VERSION = "devnet-pwa-v4";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const DATA_CACHE = `${VERSION}-data`;
const OFFLINE_URL = "/offline.html";
const MAX_STATIC_ENTRIES = 120;
const MAX_DATA_ENTRIES = 80;
const MAX_PAGE_ENTRIES = 40;

const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-48.png",
  "/icons/icon-72.png",
  "/icons/icon-96.png",
  "/icons/icon-144.png",
  "/icons/icon-192.png",
  "/icons/icon-256.png",
  "/icons/icon-384.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/monochrome-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/app-icon.svg",
  "/logo.svg",
  "/favicon.svg",
];

const PUBLIC_PAGES = new Set([
  "/",
  "/login",
  "/register",
  "/aide",
  "/a-propos",
  "/cgu",
  "/confidentialite",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("devnet-pwa-") && !keep.has(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "PURGE_DATA") {
    event.waitUntil(
      (async () => {
        // Déconnexion : les données réelles mises en cache pour le mode
        // hors-ligne sont personnelles — les lectures de l'API comme
        // les écrans visités (qui embarquent les données rendues).
        // Elles partent avec la session.
        await caches.delete(DATA_CACHE);
        await caches.delete(PAGE_CACHE);
      })(),
    );
  }
});

/*
 * Notification poussée depuis le serveur — application fermée incluse.
 *
 * Le contenu est déjà déchiffré par le navigateur : il arrive en clair
 * dans `event.data`, et rien de personnel n'est écrit dans le cache.
 * Le badge est mis à jour ici aussi, sinon l'icône resterait muette
 * alors qu'une bannière vient de s'afficher.
 */
self.addEventListener("push", (event) => {
  let payload = { title: "DevNet", body: "Nouveau message", url: "/messages" };
  try {
    payload = { ...payload, ...(event.data ? event.data.json() : {}) };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag || "devnet",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-96.png",
        data: { url: payload.url || "/messages" },
      });
      try {
        if (self.navigator.setAppBadge) await self.navigator.setAppBadge();
      } catch {
        /* l'appareil ne gère pas le badge */
      }
    })(),
  );
});

/*
 * Un appui sur une bannière ouvre la conversation, pas l'accueil.
 *
 * La fenêtre déjà ouverte est réutilisée et mise à la bonne adresse :
 * ouvrir un second onglet pour un message qu'on attend ferait perdre
 * le fil de ce qu'on faisait.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/messages", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (!client.url.startsWith(self.location.origin)) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(
    keys.slice(0, keys.length - max).map((key) => cache.delete(key)),
  );
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
        await trimCache(cache, MAX_STATIC_ENTRIES);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  return (await network) ?? Response.error();
}

/* ── Données de l'API : réseau d'abord, cache au secours ──
   C'est le cœur du mode hors-ligne. Chaque lecture réussie est gardée
   en cache ; quand le réseau manque, la **dernière donnée réelle** est
   servie — l'app s'ouvre, se lit, se parcourt. Les écritures (POST,
   PATCH, DELETE) ne passent pas ici : hors-ligne, elles échouent avec
   leur erreur honnête, jamais un faux succès.

   `/api/backend-check` est exclu volontairement : la sonde doit
   refléter le réseau réel, sinon l'app croirait être en ligne et
   afficherait des errors de réseau plutôt que l'état hors-ligne. */
async function networkFirstData(event, request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await trimCache(cache, MAX_DATA_ENTRIES);
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached ?? Response.error();
  }
}

async function handleNavigation(event, request, url) {
  try {
    const response = await fetch(request);
    // Tout écran visité en ligne est réouvrable hors-ligne : l'app
    // native se rouvre là où on l'avait laissée, pas sur une page
    // d'erreur. Le plafond empêche le cache de grandir sans borne.
    if (response.ok && url.search === "") {
      const cache = await caches.open(PAGE_CACHE);
      await cache.put(request, response.clone());
      await trimCache(cache, MAX_PAGE_ENTRIES);
    }
    return response;
  } catch {
    const page = await caches.match(request);
    if (page) return page;

    if (PUBLIC_PAGES.has(url.pathname)) {
      const cachedPage = await caches.match(url.pathname);
      if (cachedPage) return cachedPage;
    }

    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has("range")) return;

  // Lecture de données : réseau d'abord, cache au secours (mode hors-ligne).
  // La sonde reste exclue : elle doit dire la vérité sur le réseau.
  if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/backend-check")) {
    event.respondWith(networkFirstData(event, request));
    return;
  }

  if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/storage/v1/") || url.pathname.startsWith("/realtime/v1/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, request, url));
    return;
  }

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/stickers/") ||
    url.pathname.startsWith("/splash/") ||
    url.pathname === "/logo.svg" ||
    url.pathname === "/favicon.svg";

  if (isStatic) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});
