const VERSION = "devnet-pwa-v2";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline.html";
const MAX_STATIC_ENTRIES = 120;

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

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_STATIC_ENTRIES) return;
  await Promise.all(
    keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((key) => cache.delete(key)),
  );
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
        await trimCache(cache);
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

async function handleNavigation(event, request, url) {
  try {
    const response = await fetch(request);
    if (response.ok && url.search === "" && PUBLIC_PAGES.has(url.pathname)) {
      const cache = await caches.open(PAGE_CACHE);
      await cache.put(request, response.clone());
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
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/rest/v1/")) return;
  if (url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/storage/v1/")) return;
  if (url.pathname.startsWith("/realtime/v1/")) return;
  if (request.headers.has("range")) return;

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
