import { authorize, isUuid, jsonError } from "@/lib/api";
import { requestOrigin } from "@/lib/request-origin";
import { safeError } from "@/lib/safe-error";
import { getRecommendations } from "@/lib/scoring/store";

// Propiedades recomendadas para esta conversación, con su puntaje de compatibilidad y el perfil del
// que salió. Lectura: no manda nada. Todo se filtra por la organización de la sesión.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: RouteContext<"/api/conversations/[conversationId]/recommendations">) {
  const auth = await authorize("agent", { name: "recommendations", max: 60, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;
  if (!isUuid(conversationId)) return jsonError(400, "Conversación inválida");

  try {
    return Response.json(await getRecommendations(auth.session.organizationId, conversationId, requestOrigin(req)));
  } catch (err) {
    console.error("[recomendaciones]", safeError(err));
    return jsonError(500, "No se pudieron calcular las recomendaciones");
  }
}
