import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: import.meta.dirname },
  // El webhook ya registrado en Zernio apunta a /webhooks/zernio/ (con barra final).
  // Sin esto Next responde 308 a ese POST en vez de entregarlo.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/webhooks/zernio", destination: "/api/webhooks/zernio" },
      { source: "/webhooks/zernio/", destination: "/api/webhooks/zernio" },
    ];
  },
};

export default nextConfig;
