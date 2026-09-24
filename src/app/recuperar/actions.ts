"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { originFromHeaders } from "@/lib/request-origin";
import { createSupabaseServer } from "@/lib/supabase/server";

const MAX_FIELD = 320;

// Pide el correo de recuperación. Responde siempre lo mismo, exista o no la cuenta:
// si dijera "ese email no existe" cualquiera podría averiguar quiénes son clientes.
export async function requestReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().slice(0, MAX_FIELD).toLowerCase();
  if (!email) redirect("/recuperar?error=1");

  const h = await headers();
  const byIp = rateLimit(`reset:ip:${clientIp(h)}`, 5, 15 * 60_000);
  const byEmail = rateLimit(`reset:email:${email}`, 3, 15 * 60_000);
  if (!byIp.ok || !byEmail.ok) redirect("/recuperar?error=limite");

  const origin = originFromHeaders(h);
  const supabase = await createSupabaseServer();
  // El link del correo vuelve a /auth/confirm, que canjea el token y deja la sesión de recuperación.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent("/recuperar/nueva")}`,
  });

  redirect("/recuperar?enviado=1");
}

// Segundo paso: ya con la sesión de recuperación abierta, se fija la contraseña nueva.
export async function setNewPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) redirect("/recuperar/nueva?error=corta");

  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/recuperar?error=vencido");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/recuperar/nueva?error=1");

  // Se cierra la sesión de recuperación: se entra de nuevo con la contraseña nueva.
  await supabase.auth.signOut();
  redirect("/login?aviso=clave_lista");
}
