import { authorize, isUuid, jsonError } from "@/lib/api";
import { safeError } from "@/lib/safe-error";
import { saveManualPreferences } from "@/lib/scoring/store";

// Corrección manual de lo que busca el contacto. Lo corregido manda sobre la extracción automática
// y recalcula los puntajes. La organización sale de la sesión, nunca del cuerpo.
export async function PATCH(req: Request, { params }: RouteContext<"/api/conversations/[conversationId]/preferences">) {
  const auth = await authorize("agent", { name: "preferences", max: 30, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;
  if (!isUuid(conversationId)) return jsonError(400, "Conversación inválida");

  const body = await req.json().catch(() => null);
  try {
    const res = await saveManualPreferences(auth.session.organizationId, conversationId, auth.session.user.id, body);
    return res.ok ? Response.json({ ok: true, changed: res.changed }) : jsonError(res.error === "No se encontró la conversación." ? 404 : 422, res.error);
  } catch (err) {
    console.error("[preferencias]", safeError(err));
    return jsonError(500, "No se pudieron guardar las preferencias");
  }
}
