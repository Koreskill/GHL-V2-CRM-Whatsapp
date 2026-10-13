// Única validación del destino `next` de login, OTP y callback de Google.
// Función pura (la importan el proxy y las rutas): solo deja pasar rutas internas.

const BASE = "http://internal.invalid";

export function safeNext(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  // Solo ruta relativa al sitio; "//host" y "/\host" los navegadores los toman como otro dominio.
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Barras invertidas y caracteres de control (incluye CR/LF y tabulaciones) en cualquier posición.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    // Rutas que llevan de vuelta al login o al callback crean bucles de redirección.
    if (url.pathname === "/login" || url.pathname.startsWith("/auth/")) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
