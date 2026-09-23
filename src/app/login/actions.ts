"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { roleOf } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createSupabaseServer } from "@/lib/supabase/server";

function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  // Solo rutas internas: evita redirigir a otro dominio después del login.
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

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
  if (!roleOf(data.user)) {
    await supabase.auth.signOut();
    redirect("/login?error=sin_acceso");
  }
  redirect(next);
}

export async function signOut() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
