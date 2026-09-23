import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseCookieOptions, supabaseEnv } from "./env";

export async function createSupabaseServer() {
  // cookies() primero: marca la ruta como dinámica, así el build no intenta prerenderizarla
  // (en el build de la imagen las variables no existen todavía).
  const cookieStore = await cookies();
  const { url: supabaseUrl, key: supabaseKey } = supabaseEnv();
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookieOptions: supabaseCookieOptions(),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            // Desde un Server Component no se pueden escribir cookies; el proxy refresca la sesión.
          }
        },
      },
    },
  );
}

export async function getUser() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user;
}
