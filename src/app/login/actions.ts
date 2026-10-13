"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { roleOf } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { originFromHeaders } from "@/lib/request-origin";
import { safeNext } from "@/lib/safe-redirect";
import { createSupabaseServer } from "@/lib/supabase/server";

const MAX_FIELD = 320;

export async function signIn(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const email = String(formData.get("email") ?? "").trim().slice(0, MAX_FIELD);
  const password = String(formData.get("password") ?? "").slice(0, MAX_FIELD);
  if (!email || !password) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);

  // Fuerza bruta: 10 intentos por IP y 5 por email cada 15 minutos.
  const ip = clientIp(await headers());
  const byIp = rateLimit(`login:ip:${ip}`, 10, 15 * 60_000);
  const byEmail = rateLimit(`login:email:${email.toLowerCase()}`, 5, 15 * 60_000);
  if (!byIp.ok || !byEmail.ok) redirect(`/login?error=limite&next=${encodeURIComponent(next)}`);

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  // Mismo mensaje para email inexistente y contraseña incorrecta: no revela qué cuentas existen.
  if (error) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  // Sin rol no se entra, salvo para canjear una invitación: ahí el enlace mismo es el permiso.
  if (!roleOf(data.user) && !next.startsWith("/invitacion/")) {
    await supabase.auth.signOut();
    redirect("/login?error=sin_acceso");
  }
  redirect(next);
}

// "Continuar con Google": solo identidad (perfil + email). Calendar se autoriza aparte, más adelante.
// El permiso de entrar a una inmobiliaria NO sale de acá: lo resuelve el callback con la membresía.
export async function signInWithGoogle(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const h = await headers();
  const ip = clientIp(h);
  if (!rateLimit(`oauth:ip:${ip}`, 20, 15 * 60_000).ok) redirect(`/login?error=limite`);

  const origin = originFromHeaders(h);
  if (!origin) redirect("/login?error=google");

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      scopes: "openid email profile",
    },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
