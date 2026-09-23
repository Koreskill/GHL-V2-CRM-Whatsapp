// Límite de peticiones en memoria (ventana deslizante). Alcanza para un solo contenedor en Dokploy;
// con varias réplicas habría que moverlo a Redis o a la base.
const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, hits] of buckets) if (!hits.length || now - hits[hits.length - 1] > 3_600_000) buckets.delete(k);
    lastSweep = now;
  }
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, retryAfterSec: 0 };
}

// IP real del cliente detrás de Traefik: x-real-ip lo pone el proxy; si no, la última entrada de
// x-forwarded-for (la que agregó nuestro proxy, no la que puede inventar el cliente).
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? "unknown";
}

export function tooManyRequests(retryAfterSec: number) {
  return Response.json(
    { error: "Demasiadas solicitudes. Espera un momento y vuelve a intentar." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
