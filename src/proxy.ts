import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { roleOf } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { supabaseCookieOptions, supabaseEnv } from "@/lib/supabase/env";

// Rutas que no exigen sesión: el login, lo que llama Zernio (firmado con HMAC) y los barridos (CRON_SECRET).
const PUBLIC_PREFIXES = ["/login", "/api/webhooks/", "/webhooks/", "/api/cron/"];
const MACHINE_PREFIXES = ["/api/webhooks/", "/webhooks/", "/api/cron/"];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const isPublic = (pathname: string) =>
  PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));

function originHost(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return null; // "null" u otro valor inválido: no coincide con nada
  }
}

function json(status: number, error: string, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isMachine = MACHINE_PREFIXES.some((p) => pathname.startsWith(p));

  // Límite por IP para la API usada por personas (los webhooks de Zernio llegan en ráfagas legítimas).
  if (isApi && !isMachine) {
    const limit = rateLimit(`api:${clientIp(request.headers)}`, 240, 60_000);
    if (!limit.ok) return json(429, "Demasiadas solicitudes. Espera un momento.", { "Retry-After": String(limit.retryAfterSec) });
  }

  // CSRF: una petición que modifica datos con la cookie de sesión tiene que venir de esta misma app.
  if (MUTATING.has(request.method) && !isMachine) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (origin && host && originHost(origin) !== host) return json(403, "Origen no permitido");
  }

  if (isPublic(pathname)) return NextResponse.next();

  const { url: supabaseUrl, key: supabaseKey } = supabaseEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  // Con sesión pero sin rol (p. ej. alguien que se registró solo en Supabase): no entra.
  if (data.user && roleOf(data.user)) return response;

  if (isApi) return json(data.user ? 403 : 401, data.user ? "Sin acceso" : "No autorizado");

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = data.user
    ? "?error=sin_acceso"
    : pathname === "/"
      ? ""
      : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
