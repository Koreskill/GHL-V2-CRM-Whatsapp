import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { sendMessage } from "@/lib/zernio/inbox";
import type { SendMessageBody } from "@/lib/zernio/types";
import { computeWindow } from "./window";

export type DeliverSource = "human" | "agent";

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
  | { ok: false; code: "not_found" | "empty" | "window_closed" | "send_failed"; error: string; message?: DeliveredMessage };

const UNIQUE_VIOLATION = "23505";

// EL único camino de salida: envía por Zernio Y persiste. Nadie más inserta salientes.
export async function deliverMessage(
  conversationId: string,
  input: { text: string; source: DeliverSource },
): Promise<DeliverResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, code: "empty", error: "El mensaje está vacío" };

  const db = getDb();
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv) return { ok: false, code: "not_found", error: "Conversación inexistente" };

  const window = computeWindow(conv.channel, conv.lastInboundAt);
  // El agente IA nunca usa HUMAN_AGENT: Meta lo reserva para personas.
  const allowed = window.state === "open" || (window.state === "human_agent" && input.source === "human");
  if (!allowed) {
    const error =
      window.state === "template_only"
        ? "Pasaron más de 24 h desde el último mensaje del cliente: en WhatsApp solo se puede enviar una plantilla aprobada."
        : "La ventana para responder en este canal está cerrada.";
    return { ok: false, code: "window_closed", error };
  }

  const [pending] = await db
    .insert(messages)
    .values({
      conversationId,
      channel: conv.channel,
      provider: conv.provider,
      direction: "outbound",
      type: "text",
      body: text,
      status: "pending",
      rawPayload: { source: input.source },
    })
    .returning({ id: messages.id, sentAt: messages.sentAt });

  const body: SendMessageBody = { accountId: conv.accountId, message: text };
  if (window.state === "human_agent") {
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }

  // Idempotency-Key = id de la fila: un reintento del mismo envío no manda dos mensajes.
  const res = await sendMessage(conv.externalId, body, pending.id);

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
      .set({ status: "sent", externalId, rawPayload: { source: input.source, response: res.data } })
      .where(eq(messages.id, pending.id));
  } catch (err) {
    // El webhook message.sent llegó antes que esta respuesta y ya guardó el mensaje con ese id:
    // se descarta la fila pendiente y queda la del webhook, marcada con el origen.
    if ((err as { cause?: { code?: string } }).cause?.code !== UNIQUE_VIOLATION && (err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;
    await db.delete(messages).where(eq(messages.id, pending.id));
    const [existing] = await db
      .update(messages)
      .set({ rawPayload: sql`coalesce(${messages.rawPayload}, '{}'::jsonb) || ${JSON.stringify({ source: input.source })}::jsonb` })
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
