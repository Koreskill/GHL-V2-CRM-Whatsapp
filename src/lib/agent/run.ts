import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { agentConfigs, conversations } from "@/db/schema";

// Si el trabajo se procesa más tarde que esto, no se le contesta al cliente como si acabara de escribir.
export const MAX_AGENT_DELAY_MS = 10 * 60 * 1000;

export type AgentRunResult =
  | { status: "skipped"; reason: string }
  | { status: "replied"; messageId: string };

export async function runAgentForConversation(
  conversationId: string,
  opts: { triggeredAt: Date },
): Promise<AgentRunResult> {
  if (Date.now() - opts.triggeredAt.getTime() > MAX_AGENT_DELAY_MS) {
    return { status: "skipped", reason: "stale" };
  }

  const db = getDb();
  const [conversation] = await db
    .select({ channel: conversations.channel, aiEnabled: conversations.aiEnabled })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conversation) return { status: "skipped", reason: "conversation_not_found" };
  if (!conversation.aiEnabled) return { status: "skipped", reason: "conversation_ai_off" };

  const configs = await db
    .select()
    .from(agentConfigs)
    .where(inArray(agentConfigs.scope, [conversation.channel, "global"]));
  const channelConfig = configs.find((c) => c.scope === conversation.channel);
  // Doble interruptor: sin fila del canal o con el canal apagado, no contesta.
  if (!channelConfig?.enabled) return { status: "skipped", reason: "channel_off" };

  // Fase 5: armar historial por conversationId, llamar a OpenAI y salir por deliverMessage.
  return { status: "skipped", reason: "llm_not_configured" };
}
