import { authorize, isUuid, jsonError } from "@/lib/api";
import { clearHumanTyping, getTypingState, setHumanTyping } from "@/lib/inbox/typing";

// Estado "escribiendo…" de una conversación. Es efímero: no se guarda ningún mensaje.
// Solo se ve dentro del CRM; Zernio no expone typing/presence hacia WhatsApp o Instagram.

export async function GET(_req: Request, { params }: RouteContext<"/api/conversations/[conversationId]/typing">) {
  const auth = await authorize();
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;
  if (!isUuid(conversationId)) return jsonError(400, "Conversación inválida");

  // Se excluye a quien pregunta: nadie tiene que verse a sí mismo escribiendo.
  const state = await getTypingState(conversationId, auth.session.organizationId, auth.session.user.id);
  return Response.json(state);
}

export async function POST(req: Request, { params }: RouteContext<"/api/conversations/[conversationId]/typing">) {
  // Límite alto porque el cliente lo llama con freno mientras alguien escribe.
  const auth = await authorize("agent", { name: "typing", max: 120, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  const { conversationId } = await params;
  if (!isUuid(conversationId)) return jsonError(400, "Conversación inválida");

  const body = (await req.json().catch(() => null)) as { typing?: boolean } | null;
  if (body?.typing === false) await clearHumanTyping(conversationId, auth.session.organizationId);
  else await setHumanTyping(conversationId, auth.session.organizationId, auth.session.user.id);

  return Response.json({ ok: true });
}
