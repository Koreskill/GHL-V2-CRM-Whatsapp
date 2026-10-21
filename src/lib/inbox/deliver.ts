import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { sendMessage } from "@/lib/zernio/inbox";
import { listTemplates, renderTemplate, templateParamCount } from "@/lib/zernio/templates";
import type { SendMessageBody } from "@/lib/zernio/types";
import { canAutomate } from "@/lib/agency/lifecycle";
import { computeWindow } from "./window";

// human: una persona desde la bandeja. agent: el bot. campaign / followup: envíos automáticos del admin.
// Todo lo que no es "human" es automático: nunca usa HUMAN_AGENT y se corta si la inmobiliaria no está activa.
export type DeliverSource = "human" | "agent" | "campaign" | "followup";
const isAutomated = (s: DeliverSource) => s !== "human";

export type DeliveredMessage = {
  id: string;
  conversationId: string;
  direction: "outbound";
  body: string;
  status: "sent" | "failed";
  error: string | null;
  sentAt: string;
};

export type DeliverResult =
  | { ok: true; message: DeliveredMessage }
  | { ok: false; code: "not_found" | "empty" | "window_closed" | "send_failed" | "invalid_template" | "org_inactive"; error: string; message?: DeliveredMessage };

const UNIQUE_VIOLATION = "23505";

export type TemplateInput = { name: string; language: string; params: string[] };

// EL único camino de salida: envía por Zernio Y persiste. Nadie más inserta salientes.
export async function deliverMessage(
  conversationId: string,
  input: {
    source: DeliverSource;
    organizationId: string;
    /**
     * Clave estable del envío (p. ej. `campaign:<destinatario>`). Con ella un reintento NO duplica: si ya
     * salió, se devuelve el mensaje existente; si quedó a medias, se reutiliza la fila y se reenvía con
     * la misma Idempotency-Key, que Zernio conserva 24 h y responde sin volver a mandar.
     */
    idempotencyKey?: string;
  } & ({ text: string; template?: undefined } | { template: TemplateInput; text?: undefined }),
): Promise<DeliverResult> {
  const db = getDb();
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv) return { ok: false, code: "not_found", error: "Conversación inexistente" };
  // Guard de tenant: TODO llamador pasa su organizationId; ninguno puede escribir en otra inmobiliaria.
  if (conv.organizationId !== input.organizationId) {
    return { ok: false, code: "not_found", error: "Conversación inexistente" };
  }
  // Una inmobiliaria suspendida o eliminada no inicia nada automático (ver agency/lifecycle.ts).
  if (isAutomated(input.source) && !(await canAutomate(conv.organizationId))) {
    return { ok: false, code: "org_inactive", error: "La inmobiliaria no está activa: no se envían mensajes automáticos." };
  }

  // Reintento de un envío con clave: lo que ya salió no se vuelve a mandar.
  let reuseId: string | null = null;
  if (input.idempotencyKey) {
    const [prev] = await db
      .select({ id: messages.id, status: messages.status, body: messages.body, sentAt: messages.sentAt, error: messages.error })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.organizationId, conv.organizationId),
          sql`${messages.rawPayload}->>'idempotencyKey' = ${input.idempotencyKey}`,
        ),
      )
      .limit(1);
    if (prev && prev.status !== "pending" && prev.status !== "failed") {
      return {
        ok: true,
        message: { id: prev.id, conversationId, direction: "outbound", body: prev.body ?? "", status: "sent", error: null, sentAt: prev.sentAt.toISOString() },
      };
    }
    if (prev) reuseId = prev.id;
  }

  // Un expediente delegado es de solo lectura: su cuenta de canal es la de la inmobiliaria de origen.
  if ((conv.metadata as Record<string, unknown> | null)?.delegation) {
    return { ok: false, code: "not_found", error: "Este hilo es un expediente delegado: no se puede responder desde acá." };
  }

  const window = computeWindow(conv.channel, conv.lastInboundAt);

  // Plantilla de WhatsApp: vale con la ventana abierta o cerrada. Se valida contra Zernio en el servidor.
  let text: string;
  let templatePayload: SendMessageBody["template"] | undefined;
  if (input.template) {
    if (conv.channel !== "whatsapp") return { ok: false, code: "invalid_template", error: "Las plantillas son solo para WhatsApp" };
    if (input.source !== "human" && input.source !== "campaign") {
      return { ok: false, code: "invalid_template", error: "Solo una persona o una campaña envían plantillas" };
    }
    const { name, language, params } = input.template;
    const found = await listTemplates({ accountId: conv.accountId, name, language, status: "APPROVED" });
    const template = found.success ? found.data.templates?.find((t) => t.name === name && t.language === language && t.status === "APPROVED") : undefined;
    if (!template) return { ok: false, code: "invalid_template", error: "La plantilla no existe o todavía no está aprobada por Meta" };
    const expected = templateParamCount(template);
    if (params.length !== expected || params.some((p) => !p.trim())) {
      return { ok: false, code: "invalid_template", error: `La plantilla necesita ${expected} ${expected === 1 ? "variable" : "variables"} completas` };
    }
    text = renderTemplate(template, params);
    templatePayload = {
      elements: [
        {
          name,
          language,
          components: expected ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] : [],
        },
      ],
    };
  } else {
    text = input.text.trim();
    if (!text) return { ok: false, code: "empty", error: "El mensaje está vacío" };
  }

  // El agente IA nunca usa HUMAN_AGENT: Meta lo reserva para personas.
  const allowed = Boolean(templatePayload) || window.state === "open" || (window.state === "human_agent" && input.source === "human");
  if (!allowed) {
    const error =
      window.state === "template_only"
        ? "Pasaron más de 24 h desde el último mensaje del cliente: en WhatsApp solo se puede enviar una plantilla aprobada."
        : "La ventana para responder en este canal está cerrada.";
    return { ok: false, code: "window_closed", error };
  }

  const payloadBase = {
    source: input.source,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.template ? { template: input.template } : {}),
  };
  const [pending] = reuseId
    ? await db
        .update(messages)
        .set({ status: "pending", error: null, body: text, rawPayload: payloadBase })
        .where(eq(messages.id, reuseId))
        .returning({ id: messages.id, sentAt: messages.sentAt })
    : await db
        .insert(messages)
        .values({
          organizationId: conv.organizationId,
          conversationId,
          channel: conv.channel,
          provider: conv.provider,
          direction: "outbound",
          type: templatePayload ? "template" : "text",
          body: text,
          status: "pending",
          rawPayload: payloadBase,
        })
        .returning({ id: messages.id, sentAt: messages.sentAt });

  const body: SendMessageBody = templatePayload
    ? { accountId: conv.accountId, template: templatePayload }
    : { accountId: conv.accountId, message: text };
  if (!templatePayload && window.state === "human_agent") {
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }

  // Idempotency-Key = la clave estable si la hay, o el id de la fila: un reintento no manda dos mensajes.
  const res = await sendMessage(conv.externalId, body, input.idempotencyKey ?? pending.id);

  const base = { id: pending.id, conversationId, direction: "outbound" as const, body: text, sentAt: pending.sentAt.toISOString() };

  if (!res.success) {
    const error = res.error.message;
    await db.update(messages).set({ status: "failed", error }).where(eq(messages.id, pending.id));
    return { ok: false, code: "send_failed", error, message: { ...base, status: "failed", error } };
  }

  const externalId = res.data.data?.messageId ?? null;
  try {
    await db
      .update(messages)
      .set({ status: "sent", externalId, rawPayload: { ...payloadBase, response: res.data } })
      .where(eq(messages.id, pending.id));
  } catch (err) {
    // El webhook message.sent llegó antes que esta respuesta y ya guardó el mensaje con ese id:
    // se descarta la fila pendiente y queda la del webhook, marcada con el origen.
    if ((err as { cause?: { code?: string } }).cause?.code !== UNIQUE_VIOLATION && (err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;
    await db.delete(messages).where(eq(messages.id, pending.id));
    const [existing] = await db
      .update(messages)
      .set({ rawPayload: sql`coalesce(${messages.rawPayload}, '{}'::jsonb) || ${JSON.stringify(payloadBase)}::jsonb` })
      .where(and(isNotNull(messages.externalId), eq(messages.externalId, externalId!)))
      .returning({ id: messages.id, sentAt: messages.sentAt });
    if (existing) base.id = existing.id;
  }

  await db
    .update(conversations)
    .set({
      lastMessageAt: sql`greatest(${conversations.lastMessageAt}, now())`,
      // Si una persona responde, el hilo queda leído.
      ...(input.source === "human" ? { unreadCount: 0 } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(conversations.id, conversationId));

  return { ok: true, message: { ...base, status: "sent", error: null } };
}
