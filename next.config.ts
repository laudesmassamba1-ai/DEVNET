import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "**.trycloudflare.com",
    "trycloudflare.com",
  ],
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
