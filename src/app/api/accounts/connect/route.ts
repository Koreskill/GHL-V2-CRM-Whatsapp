import { authorize, jsonError } from "@/lib/api";
import { requestOrigin } from "@/lib/request-origin";
import { getConnectUrl } from "@/lib/zernio/accounts";

const PLATFORMS = new Set(["whatsapp", "instagram", "facebook"] as const);

export async function GET(req: Request) {
  const auth = await authorize("admin", { name: "accounts", max: 10, windowMs: 60_000 });
  if ("response" in auth) return auth.response;

  const platform = new URL(req.url).searchParams.get("platform");
  if (!platform || !PLATFORMS.has(platform as "whatsapp")) return jsonError(400, "Plataforma inválida");

  const redirectUrl = `${requestOrigin(req)}/conexion`;
  const res = await getConnectUrl(platform as "whatsapp" | "instagram" | "facebook", redirectUrl, {
    hostedSignup: platform === "whatsapp",
  });
  if (!res.success || !res.data.authUrl) {
    console.error("[accounts] no se pudo obtener la URL de conexión:", res.success ? "sin authUrl" : res.error.status, res.success ? "" : res.error.code);
    return jsonError(502, "Zernio no devolvió el link de conexión. Probá de nuevo en unos minutos.");
  }
  // El navegador va a navegar a esta URL: solo https de Zernio (nunca javascript: ni otro dominio).
  if (!isZernioUrl(res.data.authUrl)) {
    console.error("[accounts] URL de conexión inesperada, descartada");
    return jsonError(502, "Zernio devolvió un link de conexión inválido.");
  }
  return Response.json({ authUrl: res.data.authUrl });
}

function isZernioUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "zernio.com" || url.hostname.endsWith(".zernio.com"));
  } catch {
    return false;
  }
}
