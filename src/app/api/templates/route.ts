import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations } from "@/db/schema";
import { authorize, isUuid, jsonError } from "@/lib/api";
import { listTemplates, templateBody, templateParamCount } from "@/lib/zernio/templates";

// Plantillas aprobadas que se pueden enviar en una conversación de WhatsApp.
export async function GET(req: Request) {
  const auth = await authorize("agent", { name: "templates", max: 60, windowMs: 60_000 });
  if ("response" in auth) return auth.response;

  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!isUuid(conversationId)) return jsonError(400, "conversationId inválido");
  const [conv] = await getDb()
    .select({ channel: conversations.channel, accountId: conversations.accountId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, auth.session.organizationId)));
  if (!conv) return jsonError(404, "Conversación inexistente");
  if (conv.channel !== "whatsapp") return Response.json({ templates: [] });

  const res = await listTemplates({ accountId: conv.accountId, status: "APPROVED" });
  if (!res.success) return jsonError(502, "No se pudieron leer las plantillas de WhatsApp.");

  return Response.json({
    templates: (res.data.templates ?? [])
      .filter((t) => t.status === "APPROVED" && t.name && t.language)
      .map((t) => ({ name: t.name!, language: t.language!, category: t.category ?? null, body: templateBody(t), params: templateParamCount(t) })),
  });
}
