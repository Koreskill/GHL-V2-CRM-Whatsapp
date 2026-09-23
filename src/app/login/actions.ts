"use server";

import { redirect } from "next/navigation";
import { roleOf } from "@/lib/auth";
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
