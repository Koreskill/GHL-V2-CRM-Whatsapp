// Sin prefijo NEXT_PUBLIC_: se leen al arrancar el servidor, no se incrustan al compilar la imagen.
export function supabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL y/o SUPABASE_PUBLISHABLE_KEY en las variables de entorno");
  }
  return { url, key };
}
