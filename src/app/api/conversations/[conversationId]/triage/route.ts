import { authorize, isUuid, jsonError } from "@/lib/api";
import { resolveTriage } from "@/lib/agent/triage/queries";

// Cierra un triaje pendiente cuando una persona lo atiende.
// No envía nada: el envío sigue saliendo por /api/messages/send, que es el único camino.
export async function POST(req: Request, { params }: RouteContext<"/api/conversations/[conversationId]/triage">) {
  const auth = await authorize("agent", { name: "triage", max: 60, windowMs: 60_000 });
  if ("response" in auth) return auth.response;

  const { conversationId } = await params;
  if (!isUuid(conversationId)) return jsonError(400, "Conversación inválida");

  const body = (await req.json().catch(() => null)) as { triageId?: unknown; action?: unknown } | null;
  if (!isUuid(body?.triageId)) return jsonError(400, "Se espera { triageId, action }");
  if (body?.action !== "descartar") return jsonError(400, "Acción no soportada");

  // El triaje queda como descartado, con su clasificación intacta: sirve para recalibrar después.
  await resolveTriage(body.triageId, auth.session.organizationId);
  return Response.json({ ok: true });
}
