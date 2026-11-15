import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Un serveur de test peut tourner à côté du serveur de développement :
   * le verrou de Next est posé dans `distDir`, pas dans le port. Sans ce
   * réglage, lancer les tests HTTP exigeait d'arrêter le serveur ouvert
   * dans le navigateur, ce qui n'est ni pratique ni sûr.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Le serveur Next compresse déjà les réponses ; on le rend explicite et
  // on retire l'en-tête `X-Powered-By`, qui n'apprend rien d'utile à un
  // visiteur et donne une version à un scanner.
  compress: true,
  poweredByHeader: false,
  /*
   * `@napi-rs/image` charge un binaire natif : il doit rester externe au
   * bundle (comme `sharp` l'était), sinon Turbopack ne peut pas placer
   * l'asset `.node` dans un chunk ESM. L'adaptateur `vendor/sharp` en dépend
   * pour l'optimiseur d'images de Next.
   */
  serverExternalPackages: ["@napi-rs/image"],
  /*
   * Les imports de grosses bibliothèques sont découpés par Next. Sans cette
   * liste, `@monaco-editor/react` et `aws4fetch` peuvent tirer un paquet
   * entier dans un chunk partagé alors qu'un seul écran les utilise.
   */
  experimental: {
    optimizePackageImports: ["@monaco-editor/react", "aws4fetch"],
    /* Le routeur client garde un écran déjà visité cinq minutes. Sans ce
       délai, revenir sur un onglet rejouait la récupération RSC et faisait
       réapparaître le squelette, alors que rien n'avait changé. Les données
       métier gardent leurs propres invalidation et TTL. */
    staleTimes: { dynamic: 300, static: 300 },
  },
  allowedDevOrigins: [
    // Ouvrir la page par `127.0.0.1` au lieu de `localhost` suffisait à
    // bloquer `/_next/hmr` : la page ne s'hydratait plus et restait sur le
    // logo du chargement. Les deux écritures de l'adresse locale sont donc
    // autorisées explicitement.
    "localhost",
    "127.0.0.1",
    "*.trycloudflare.com",
    "**.trycloudflare.com",
    "trycloudflare.com",
  ],
  async headers() {
    return [
      {
        // Le service worker doit être revalidé à chaque ouverture : sinon
        // une ancienne version peut rester active des jours et servir un
        // cache qui ne connaît pas les nouvelles routes.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/offline.html",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
          {
            // Le site est servi en HTTPS en production. Sans HSTS, une
            // première requête en clair reste possible avant la redirection.
            key: "Strict-Transport-Security",
            value: "max-age=63072000",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Ces réécritures ne visent que la pile Supabase locale
    // (`supabase start`). Les garder en production ferait proxifier
    // `/rest/v1/*` vers `127.0.0.1:54321` sur chaque instance serverless :
    // une réponse 502 opaque au lieu du service réel. Le dépôt expose sa
    // propre passerelle `/api/rest/*`, qui est le chemin utilisé par
    // l'application ; ces alias ne servent qu'au développement.
    if (process.env.NODE_ENV === "production") return [];
    return [
      {
        source: "/rest/v1/:path*",
        destination: "http://127.0.0.1:54321/rest/v1/:path*",
      },
      {
        source: "/auth/v1/:path*",
        destination: "http://127.0.0.1:54321/auth/v1/:path*",
      },
      {
        source: "/storage/v1/:path*",
        destination: "http://127.0.0.1:54321/storage/v1/:path*",
      },
      {
        source: "/realtime/v1/:path*",
        destination: "http://127.0.0.1:54321/realtime/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
