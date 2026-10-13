import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { accessRequests } from "@/db/schema";
import { orgOf, roleOf } from "@/lib/roles";
import { requestOrigin } from "@/lib/request-origin";
import { safeNext } from "@/lib/safe-redirect";
import { createSupabaseServer } from "@/lib/supabase/server";

// Vuelta de "Continuar con Google" (PKCE). Canjea el código por una sesión y decide a dónde va:
//  - con rol y organización (invitado/creado por la agencia) → a la app;
//  - sin ellos → queda una SOLICITUD de acceso y pantalla de espera. Nunca cae en una inmobiliaria
//    por defecto, y el rol/tenant jamás se lee de user_metadata, de la URL ni de un formulario.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = requestOrigin(request);
  const fail = () => NextResponse.redirect(`${origin}/login?error=google`);

  // Si el usuario cancela el consentimiento Google devuelve ?error=access_denied (sin code).
  const code = searchParams.get("code");
  if (!code || searchParams.get("error")) return fail();

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail();

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email) {
    await supabase.auth.signOut();
    return fail();
  }

  if (roleOf(user) && orgOf(user)) {
    return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
  }

  // Venía de un enlace de invitación: ahí se canjea (valida email verificado, vencimiento y uso único).
  const next = safeNext(searchParams.get("next"));
  if (next.startsWith("/invitacion/")) return NextResponse.redirect(`${origin}${next}`);

  // Solo un email que Google verificó puede generar una solicitud.
  if (!user.email_confirmed_at) {
    await supabase.auth.signOut();
    return fail();
  }
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const fullName = typeof meta?.full_name === "string" ? meta.full_name.slice(0, 200) : null;
  await getDb()
    .insert(accessRequests)
    .values({ userId: user.id, email: user.email.toLowerCase(), fullName, provider: "google" })
    // Una solicitud ya rechazada no se reabre sola por volver a entrar.
    .onConflictDoNothing()
    .catch(() => {});

  return NextResponse.redirect(`${origin}/acceso-pendiente`);
}
