import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { aiChatComplete, openrouterConfigured, resolveModel } from "@/lib/ai/openrouter";
import { calcomBookingUrl } from "@/lib/calcom";
import { deliverMessage } from "@/lib/inbox/deliver";
import { computeWindow } from "@/lib/inbox/window";
import { resolveAgentConfig } from "./config";
import { TOOL_DEFINITIONS, runTool } from "./tools";

// Si el trabajo se procesa más tarde que esto, no se le contesta al cliente como si acabara de escribir.
export const MAX_AGENT_DELAY_MS = 10 * 60 * 1000;
const HISTORY_LIMIT = 30;
const MAX_TOOL_ROUNDS = 3;
const MAX_MESSAGE_CHARS = 2000;
const AGENT_MAX_PER_CONVERSATION_HOUR = 20;
const agentMaxPerHour = () => Number(process.env.AGENT_MAX_REPLIES_PER_HOUR) || 300;

export type AgentRunResult =
  | { status: "skipped"; reason: string }
  | { status: "replied"; messageId: string; handoff: boolean }
  | { status: "failed"; error: string };

// El historial es de ESTA conversación, nunca del contacto: no se mezcla WhatsApp con Instagram.
async function loadHistory(conversationId: string): Promise<ChatCompletionMessageParam[]> {
  const rows = await getDb()
    .select({ direction: messages.direction, body: messages.body, type: messages.type, status: messages.status })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), ne(messages.status, "failed")))
    .orderBy(desc(messages.sentAt))
    .limit(HISTORY_LIMIT);
  return rows.reverse().map((m) => ({
    role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
    content: (m.body ?? `[${m.type}]`).slice(0, MAX_MESSAGE_CHARS),
  }));
}

// Otro mensaje del cliente (lo atiende su propia corrida) o una respuesta ya enviada: esta corrida sobra.
async function superseded(conversationId: string, trigger: { id: string; sentAt: Date }) {
  const [newer] = await getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), gt(messages.sentAt, trigger.sentAt), ne(messages.id, trigger.id)))
    .limit(1);
  return Boolean(newer);
}

export async function runAgentForConversation(
  conversationId: string,
  opts: { triggerMessageId: string },
): Promise<AgentRunResult> {
  const db = getDb();
  const [trigger] = await db
    .select({ id: messages.id, sentAt: messages.sentAt, direction: messages.direction })
    .from(messages)
    .where(and(eq(messages.id, opts.triggerMessageId), eq(messages.conversationId, conversationId)));
  if (!trigger || trigger.direction !== "inbound") return { status: "skipped", reason: "trigger_not_found" };
  if (Date.now() - trigger.sentAt.getTime() > MAX_AGENT_DELAY_MS) return { status: "skipped", reason: "stale" };

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv) return { status: "skipped", reason: "conversation_not_found" };
  if (!conv.aiEnabled) return { status: "skipped", reason: "conversation_ai_off" };

  const config = await resolveAgentConfig(conv.organizationId, conv.channel);
  // Doble interruptor: el hilo (ai_enabled) Y el canal (agent_configs.enabled).
  if (!config.enabled) return { status: "skipped", reason: "channel_off" };
  if (computeWindow(conv.channel, conv.lastInboundAt).state !== "open") return { status: "skipped", reason: "window_closed" };
  if (await superseded(conversationId, trigger)) return { status: "skipped", reason: "superseded" };

  // Topes de gasto: alguien que manda cientos de mensajes no puede vaciar el saldo de OpenAI.
  const [usage] = await db.execute<{ conv: number; total: number }>(sql`
    select
      count(*) filter (where conversation_id = ${conversationId})::int as conv,
      count(*)::int as total
    from messages
    where direction = 'outbound' and raw_payload->>'source' = 'agent'
      and organization_id = ${conv.organizationId} and sent_at >= now() - interval '1 hour'
  `);
  if (usage.conv >= AGENT_MAX_PER_CONVERSATION_HOUR) return { status: "skipped", reason: "limit_conversation" };
  if (usage.total >= agentMaxPerHour()) return { status: "skipped", reason: "limit_global" };

  if (!openrouterConfigured()) return { status: "skipped", reason: "openrouter_key_missing" };
  const modelConfig = await resolveModel(conv.organizationId, "conversacional", config.model);

  const bookingUrl = calcomBookingUrl();
  const systemPrompt = bookingUrl
    ? `${config.systemPrompt}\n\nSi la persona quiere agendar una reunión o visita, compartí este link para que elija el horario: ${bookingUrl.toString()}. No propongas horarios concretos vos.`
    : config.systemPrompt;

  const chat: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(await loadHistory(conversationId)),
  ];
  const tools = config.tools.map((t) => TOOL_DEFINITIONS[t]);

  let reply = "";
  let handoff = false;
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const completion = await aiChatComplete({
        organizationId: conv.organizationId,
        fn: "conversacional",
        model: modelConfig.model,
        provider: modelConfig.provider,
        params: modelConfig.params,
        body: {
          messages: chat,
          ...(tools.length && round < MAX_TOOL_ROUNDS ? { tools } : {}),
          temperature: 0.4,
        },
        requestRef: { conversationId, triggerMessageId: opts.triggerMessageId },
      });
      const choice = completion.choices[0]?.message;
      if (!choice) break;
      const calls = (choice.tool_calls ?? []).filter((c) => c.type === "function");
      if (calls.length === 0) {
        reply = choice.content?.trim() ?? "";
        break;
      }
      chat.push({ role: "assistant", content: choice.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const result = await runTool(call.function.name, call.function.arguments, { conversationId });
        handoff ||= Boolean(result.handoff);
        chat.push({ role: "tool", tool_call_id: call.id, content: result.output });
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[agent] OpenAI falló en ${conversationId}:`, error);
    return { status: "failed", error };
  }

  if (!reply) return { status: "skipped", reason: "empty_reply" };
  reply = reply.slice(0, 4096); // máximo de un mensaje de WhatsApp

  // Mientras el modelo pensaba pudo escribir el cliente, contestar un vendedor o apagarse la IA.
  if (await superseded(conversationId, trigger)) return { status: "skipped", reason: "superseded_after_llm" };
  if (!handoff) {
    const [fresh] = await db.select({ aiEnabled: conversations.aiEnabled }).from(conversations).where(eq(conversations.id, conversationId));
    if (!fresh?.aiEnabled) return { status: "skipped", reason: "conversation_ai_off_after_llm" };
  }

  // La salida va por deliverMessage: el agente no escribe en la base por su cuenta.
  const sent = await deliverMessage(conversationId, { text: reply, source: "agent" });
  if (!sent.ok) return { status: "failed", error: sent.error };
  return { status: "replied", messageId: sent.message.id, handoff };
}
