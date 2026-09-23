import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { roleOf } from "@/lib/auth";
import { supabaseEnv } from "@/lib/supabase/env";

// Rutas que no exigen sesión: el login, lo que llama Zernio (firmado con HMAC) y los barridos (CRON_SECRET).
const PUBLIC_PREFIXES = ["/login", "/api/webhooks/", "/webhooks/", "/api/cron/"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const { url: supabaseUrl, key: supabaseKey } = supabaseEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  // Con sesión pero sin rol (p. ej. alguien que se registró solo en Supabase): no entra.
  if (data.user && roleOf(data.user)) return response;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: data.user ? "Sin acceso" : "No autorizado" }, { status: data.user ? 403 : 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  if (data.user) {
    url.search = "?error=sin_acceso";
  } else {
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
