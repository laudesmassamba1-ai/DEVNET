const VERSION = "devnet-pwa-v7";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const DATA_CACHE = `${VERSION}-data`;
const MEDIA_CACHE = `${VERSION}-media`;
const RSC_CACHE = `${VERSION}-rsc`;
const OFFLINE_URL = "/offline.html";
const MAX_STATIC_ENTRIES = 500;
const MAX_DATA_ENTRIES = 120;
const MAX_MEDIA_ENTRIES = 240;
const MAX_PAGE_ENTRIES = 80;
const MAX_RSC_ENTRIES = 120;
/** Une lecture API garde sa valeur sept jours, puis n'est plus servie. */
const DATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = "x-devnet-cached-at";

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
  "/icons/icon-1024.png",
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
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.addAll(PRECACHE);
      // Les pages publiques n'ont pas besoin d'une session : les garder dès
      // l'installation évite la page « hors ligne » au premier lancement,
      // avant même que l'application ait eu le temps de préchauffer.
      const pageCache = await caches.open(PAGE_CACHE);
      await Promise.all(
        [...PUBLIC_PAGES].map((route) => pageCache.add(route).catch(() => undefined)),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Les données de la version courante survivent à une activation :
      // les supprimer ici coupait le mode hors-ligne à chaque mise à jour.
      const keep = new Set([STATIC_CACHE, PAGE_CACHE, DATA_CACHE, MEDIA_CACHE, RSC_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("devnet-pwa-") && !keep.has(key))
          .map((key) => caches.delete(key)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "WARM_ROUTES") {
    event.waitUntil(warmRoutes(Array.isArray(event.data.routes) ? event.data.routes : []));
  }
  if (event.data?.type === "DOWNLOAD_MEDIA") {
    const port = event.ports?.[0];
    event.waitUntil(
      downloadMedia(event.data.url).then((result) => port?.postMessage(result)),
    );
  }
  if (event.data?.type === "PURGE_DATA") {
    event.waitUntil(
      (async () => {
        // Déconnexion : les données réelles mises en cache sont
        // personnelles. Les pages visitées embarquent aussi des données
        // rendues, donc elles partent avec la session, comme les lectures
        // d'API et les payloads RSC.
        await caches.delete(DATA_CACHE);
        await caches.delete(MEDIA_CACHE);
        await caches.delete(PAGE_CACHE);
        await caches.delete(RSC_CACHE);
      })(),
    );
  }
});

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

/**
 * Garde le HTML des destinations principales pour un lancement à froid
 * hors-ligne. Le préchauffage du routeur ne garde que le payload RSC ;
 * ouvrir une notification depuis l'écran d'accueil demande aussi le
 * document. On le fait une fois, en silence, après l'ouverture.
 */
async function warmRoutes(routes) {
  const cache = await caches.open(PAGE_CACHE);
  /* La session n'est jamais mise en cache : elle porte `no-store` et une
     identité. Un appareil partagé ne doit pas rouvrir la session du
     précédent utilisateur ; hors-ligne, l'app repart de /login. */
  for (const route of routes.slice(0, 20)) {
    if (typeof route !== "string" || !route.startsWith("/")) continue;
    if (await cache.match(route)) continue;
    try {
      const response = await fetch(new Request(route, {
        credentials: "same-origin",
        headers: { Accept: "text/html" },
      }));
      if (response.ok && !response.redirected) await put(cache, route, response, MAX_PAGE_ENTRIES);
    } catch {
      // Une route qui ne répond pas ne doit pas interrompre les autres.
    }
  }
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(
    keys.slice(0, keys.length - max).map((key) => cache.delete(key)),
  );
}

function isUncacheable(response) {
  const control = (response.headers.get("Cache-Control") || "").toLowerCase();
  /* `no-store` est une consigne du serveur, pas une suggestion. La session
     (`/api/auth/session`) en porte une : la garder faisait survivre une
     identité à la déconnexion sur un appareil partagé. */
  return control.includes("no-store");
}

async function put(cache, request, response, max) {
  if (!response.ok || isUncacheable(response)) return;
  await cache.put(request, response.clone());
  await trimCache(cache, max);
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") await put(cache, request, response, MAX_STATIC_ENTRIES);
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  return (await network) ?? Response.error();
}

function isFreshData(cached) {
  const raw = cached.headers.get(CACHED_AT_HEADER);
  if (!raw) return true;
  const age = Date.now() - Number(raw);
  return Number.isFinite(age) && age >= 0 && age < DATA_TTL_MS;
}

async function putData(cache, request, response) {
  if (!response.ok || isUncacheable(response)) return;
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  const body = await response.clone().arrayBuffer();
  await cache.put(request, new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
  await trimCache(cache, MAX_DATA_ENTRIES);
}

async function networkFirstData(event, request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await putData(cache, request, response);
    return response;
  } catch {
    const cached = await cache.match(request);
    // Une donnée trop vieille n'est pas une donnée : la montrer ferait
    // croire que le message ou le compteur est encore vrai.
    return cached && isFreshData(cached) ? cached : Response.error();
  }
}

/**
 * Une vidéo se lit par morceaux (`Range`). Le cache garde le fichier
 * complet ; hors-ligne, on découpe la réponse demandée dans ce fichier.
 * Sans ce découpage, le navigateur reçoit une réponse 200 à une requête
 * `Range`, ne peut pas se positionner, et la vidéo reste bloquée.
 */
function cachedRangeResponse(buffer, contentType, range) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || "");
  if (!match) return null;
  const total = buffer.byteLength;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : total - 1;
  if (!match[1] && match[2]) {
    start = Math.max(0, total - Number(match[2]));
    end = total - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }
  end = Math.min(end, total - 1);
  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": contentType || "video/mp4",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

async function mediaRangeFirst(request, url) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(MEDIA_CACHE);
    const cached = await cache.match(url.href, { ignoreSearch: true });
    if (!cached) return Response.error();
    const buffer = await cached.arrayBuffer();
    return cachedRangeResponse(
      buffer,
      cached.headers.get("Content-Type") || "video/mp4",
      request.headers.get("range"),
    ) ?? Response.error();
  }
}

async function downloadMedia(url) {
  let target;
  try {
    target = new URL(url, self.location.origin);
  } catch {
    return { ok: false, error: "adresse invalide" };
  }
  if (target.origin !== self.location.origin || !target.pathname.startsWith("/api/media/")) {
    return { ok: false, error: "média non interne" };
  }
  target.hash = "";
  try {
    const response = await fetch(new Request(target.href, { credentials: "same-origin" }));
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const cache = await caches.open(MEDIA_CACHE);
    await put(cache, target.href, response, MAX_MEDIA_ENTRIES);
    return { ok: true, bytes: Number(response.headers.get("Content-Length") || 0) };
  } catch {
    return { ok: false, error: "réseau indisponible" };
  }
}

async function mediaFirst(event, request) {
  const cache = await caches.open(MEDIA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await put(cache, request, response, MAX_MEDIA_ENTRIES);
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      { headers: { "Content-Type": "image/svg+xml" } },
    );
  }
}

/**
 * Payload RSC : c'est ce que le routeur Next demande quand on change
 * d'onglet, pas une page HTML. Sans cette route, le service worker ne
 * voyait que la navigation complète et le mode hors-ligne échouait dès
 * le premier clic. Réseau d'abord, cache au secours : en ligne le routeur
 * garde son comportement normal ; hors-ligne le dernier payload connu
 * permet de changer d'onglet sans page d'erreur.
 */
async function rscFirst(event, request) {
  const cache = await caches.open(RSC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await put(cache, request, response, MAX_RSC_ENTRIES);
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached ?? Response.error();
  }
}

function isRscRequest(request, url) {
  return (
    request.headers.get("RSC") === "1" ||
    request.headers.get("Next-Router-Prefetch") === "1" ||
    url.searchParams.has("_rsc")
  );
}

async function handleNavigation(event, request, url) {
  let response;
  try {
    response = event.preloadResponse ? await event.preloadResponse : await fetch(request);
    // Une réponse redirigée vers /login n'est pas la page demandée : la
    // mettre en cache sous /feed ferait ouvrir la connexion hors-ligne.
    if (response.ok && !response.redirected) {
      const cache = await caches.open(PAGE_CACHE);
      await put(cache, request, response, MAX_PAGE_ENTRIES);
    }
    return response;
  } catch {
    const page =
      (await caches.match(request, { ignoreSearch: true })) ??
      (PUBLIC_PAGES.has(url.pathname) ? await caches.match(url.pathname) : null);
    if (page) return page;

    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.headers.has("range") && url.pathname.startsWith("/api/media/")) {
    event.respondWith(mediaRangeFirst(request, url));
    return;
  }

  if (url.pathname.startsWith("/api/media/") && request.destination === "image") {
    event.respondWith(mediaFirst(event, request));
    return;
  }

  if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/backend-check")) {
    event.respondWith(networkFirstData(event, request));
    return;
  }

  if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/storage/v1/") || url.pathname.startsWith("/realtime/v1/")) return;

  if (isRscRequest(request, url)) {
    event.respondWith(rscFirst(event, request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, request, url));
    return;
  }

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/stickers/") ||
    url.pathname.startsWith("/splash/") ||
    url.pathname.startsWith("/motion/") ||
    url.pathname.startsWith("/screenshots/") ||
    url.pathname === "/logo.svg" ||
    url.pathname === "/favicon.svg";

  if (isStatic) {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }

  if (request.destination === "image") {
    event.respondWith(mediaFirst(event, request));
  }
});
