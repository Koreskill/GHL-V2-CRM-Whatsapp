import { isUuid, jsonError, requireUser } from "@/lib/api";
import { deliverMessage } from "@/lib/inbox/deliver";

const MAX_LENGTH = 4096;

export async function POST(req: Request) {
  if (!(await requireUser())) return jsonError(401, "unauthorized");

  const body = (await req.json().catch(() => null)) as { conversationId?: unknown; text?: unknown } | null;
  if (!body || !isUuid(body.conversationId) || typeof body.text !== "string") {
    return jsonError(400, "Se espera { conversationId, text }");
  }
  if (body.text.length > MAX_LENGTH) return jsonError(400, `Máximo ${MAX_LENGTH} caracteres`);

  const result = await deliverMessage(body.conversationId, { text: body.text, source: "human" });
  if (result.ok) return Response.json({ message: result.message });

  const status = { not_found: 404, empty: 400, window_closed: 409, send_failed: 502 }[result.code];
  return Response.json({ error: result.error, code: result.code, message: result.message ?? null }, { status });
}
