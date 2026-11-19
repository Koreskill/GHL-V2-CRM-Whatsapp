// Validación del link de conexión que devuelve Zernio, ANTES de mandar el navegador ahí.
//
// Zernio no devuelve siempre una página suya: para WhatsApp es de zernio.com, pero para Instagram y Facebook
// es la pantalla de autorización de Meta (www.instagram.com / www.facebook.com), verificado contra la API.
// Por eso la lista es POR PLATAFORMA y exacta: solo https, sin usuario ni puerto, y únicamente los dominios
// que ese flujo realmente usa. Cualquier otro se descarta (nunca javascript:, http: ni un dominio ajeno).

export type ConnectPlatform = "whatsapp" | "instagram" | "facebook";

const ZERNIO = ["zernio.com"];
const META = ["facebook.com", "instagram.com"];

// Dominio base permitido; sirve el propio y sus subdominios (www., m., web., business.).
const ALLOWED_BASE: Record<ConnectPlatform, string[]> = {
  whatsapp: [...ZERNIO, ...META],
  instagram: [...ZERNIO, ...META],
  facebook: [...ZERNIO, ...META],
};

export function isAllowedConnectUrl(value: string | null | undefined, platform: ConnectPlatform): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_BASE[platform].some((base) => host === base || host.endsWith(`.${base}`));
}
