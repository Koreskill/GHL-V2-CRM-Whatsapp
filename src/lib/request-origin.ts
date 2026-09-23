// Detrás del proxy de Dokploy/Traefik el host real viene en x-forwarded-*. No se usa APP_BASE_URL:
// una URL fija mal puesta rompe los callbacks sin ningún error visible.
export function requestOrigin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  return `${proto === "http" && !host.startsWith("localhost") && !host.startsWith("127.") ? "https" : proto}://${host}`;
}
