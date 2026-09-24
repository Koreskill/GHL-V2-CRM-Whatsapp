import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente con la clave de servicio: puede crear usuarios y escribir app_metadata (rol, organización).
// NUNCA se importa desde un componente de cliente. La clave no lleva prefijo NEXT_PUBLIC_ y se lee
// en runtime, igual que el resto: con NEXT_PUBLIC_ Next la incrustaría en el bundle del navegador.
export function createSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SECRET_KEY: sin ellas no se pueden crear clientes");
  }
  // Sin sesión propia: este cliente nunca toca cookies ni refresca tokens.
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export const hasAdminKey = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
