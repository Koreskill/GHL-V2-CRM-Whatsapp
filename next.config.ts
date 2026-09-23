import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// 'unsafe-inline' en scripts: Next inyecta scripts inline de arranque; eliminarlo exige nonces por request.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-src https://cal.com https://*.cal.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: import.meta.dirname },
  poweredByHeader: false,
  // El webhook ya registrado en Zernio apunta a /webhooks/zernio/ (con barra final).
  // Sin esto Next responde 308 a ese POST en vez de entregarlo.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/webhooks/zernio", destination: "/api/webhooks/zernio" },
      { source: "/webhooks/zernio/", destination: "/api/webhooks/zernio" },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
