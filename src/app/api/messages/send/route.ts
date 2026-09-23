import { authorize, isUuid, jsonError } from "@/lib/api";
import { deliverMessage, type TemplateInput } from "@/lib/inbox/deliver";

const MAX_LENGTH = 4096;
const TEMPLATE_NAME = /^[a-z][a-z0-9_]{0,511}$/;
const LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

function parseTemplate(value: unknown): TemplateInput | null {
  if (!value || typeof value !== "object") return null;
  const t = value as { name?: unknown; language?: unknown; params?: unknown };
  if (typeof t.name !== "string" || !TEMPLATE_NAME.test(t.name)) return null;
  if (typeof t.language !== "string" || !LANGUAGE.test(t.language)) return null;
  const params = t.params ?? [];
  if (!Array.isArray(params) || params.length > 20 || params.some((p) => typeof p !== "string" || p.length > 1024)) return null;
  return { name: t.name, language: t.language, params: params as string[] };
}

// Un único endpoint de envío: texto libre o plantilla de WhatsApp, siempre por deliverMessage.
export async function POST(req: Request) {
  const auth = await authorize();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => null)) as { conversationId?: unknown; text?: unknown; template?: unknown } | null;
  if (!body || !isUuid(body.conversationId)) return jsonError(400, "Se espera { conversationId, text } o { conversationId, template }");

  let result;
  if (body.template !== undefined) {
    const template = parseTemplate(body.template);
    if (!template) return jsonError(400, "Plantilla inválida");
    result = await deliverMessage(body.conversationId, { template, source: "human" });
  } else {
    if (typeof body.text !== "string") return jsonError(400, "Se espera { conversationId, text }");
    if (body.text.length > MAX_LENGTH) return jsonError(400, `Máximo ${MAX_LENGTH} caracteres`);
    result = await deliverMessage(body.conversationId, { text: body.text, source: "human" });
  }

  if (result.ok) return Response.json({ message: result.message });
  const status = { not_found: 404, empty: 400, window_closed: 409, send_failed: 502, invalid_template: 422 }[result.code];
  return Response.json({ error: result.error, code: result.code, message: result.message ?? null }, { status });
}
