// Detrás del proxy de Dokploy/Traefik el host real viene en x-forwarded-*. No se usa APP_BASE_URL:
// una URL fija mal puesta rompe los callbacks sin ningún error visible.
// Con ALLOWED_HOSTS definida, un Host / X-Forwarded-Host que no figure en la lista se ignora: los callbacks
// de OAuth y la dirección de las notificaciones push de Google no pueden apuntar a un dominio ajeno.
/**
 * ALLOWED_HOSTS se carga a mano en el panel: se acepta "dominio.com", "https://dominio.com/" o "https//dominio.com/"
 * y todo queda en "dominio.com". Un error de tipeo ahí no puede romper el login.
 */
export function normalizeHost(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?(?::\/\/|\/\/|:\/)/, "")
    .replace(/[/?#].*$/, "");
}

function allowedHostList() {
  return (process.env.ALLOWED_HOSTS ?? "").split(",").map(normalizeHost).filter(Boolean);
}

export function requestOrigin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  if (!hostAllowed(host)) {
    const first = allowedHostList()[0];
    if (first) return `https://${first}`;
  }
  return `${proto === "http" && !host.startsWith("localhost") && !host.startsWith("127.") ? "https" : proto}://${host}`;
}

// Misma lógica desde una Server Action, donde hay headers() pero no un Request.
export function originFromHeaders(h: Headers) {
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host") || "";
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  const local = host.startsWith("localhost") || host.startsWith("127.");
  return host ? `${proto === "http" && !local ? "https" : proto}://${host}` : "";
}

// ALLOWED_HOSTS (opcional, separados por coma): hosts válidos para armar enlaces que salen por correo
// (recuperación, invitaciones). Sin ella el host sale del request, como siempre. Con ella, un
// header Host / X-Forwarded-Host falsificado no puede hacer que el correo apunte a un dominio ajeno.
export function hostAllowed(host: string) {
  const list = allowedHostList();
  return list.length === 0 || list.includes(host.toLowerCase());
}

// Igual que originFromHeaders pero para enlaces de correo: si el host no está permitido, usa el primero
// de la lista en vez de confiar en el header.
export function trustedOriginFromHeaders(h: Headers) {
  const origin = originFromHeaders(h);
  if (!origin) return "";
  const host = new URL(origin).host;
  if (hostAllowed(host)) return origin;
  const first = allowedHostList()[0];
  return first ? `https://${first}` : "";
}
