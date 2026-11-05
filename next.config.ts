import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["iconoir-react"],
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
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  async rewrites() {
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
