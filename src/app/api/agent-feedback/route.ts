import { authorize, isUuid, jsonError } from "@/lib/api";
import { reportProblem } from "@/lib/agent/feedback";

// Cualquier persona del equipo puede marcar una respuesta del agente como problemática. Revisarla y
// convertirla en ejemplo es solo de un admin (configuracion/actions.ts).
export async function POST(req: Request) {
  const auth = await authorize("agent", { name: "agent-feedback", max: 30, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  const body = (await req.json().catch(() => null)) as { messageId?: unknown; note?: unknown } | null;
  if (!body || !isUuid(body.messageId)) return jsonError(400, "Mensaje inválido");
  const res = await reportProblem({
    orgId: auth.session.organizationId,
    userId: auth.session.user.id,
    messageId: body.messageId,
    note: typeof body.note === "string" ? body.note.trim() : null,
  });
  return res.ok ? Response.json({ ok: true }) : jsonError(422, res.error ?? "No se pudo registrar");
}
