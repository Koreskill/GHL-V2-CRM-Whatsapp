import { and, eq, sql } from "drizzle-orm";
import { getDb, type DbExecutor } from "@/db";
import { conversations } from "@/db/schema";

/**
 * Indicador "escribiendo…".
 *
 * Es estado EFÍMERO de la conversación, no un mensaje: nunca entra al historial.
 *
 * Importante: Zernio no expone typing/presence en su API (verificado contra el OpenAPI 1.62.0),
 * así que esto se ve SOLO dentro del CRM. La persona del otro lado, en WhatsApp o Instagram, no
 * ve nada. Son dos capacidades distintas y esta es la que sí podemos dar.
 */

// Si un proceso muere sin limpiar, el indicador no queda pegado para siempre.
export const TYPING_TTL_MS = 30_000;
export const HUMAN_TYPING_TTL_MS = 8_000;

export async function setAgentTyping(conversationId: string, orgId: string, db: DbExecutor = getDb()) {
  await db
    .update(conversations)
    .set({ agentTypingSince: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)))
    .catch(() => {});
}

export async function clearAgentTyping(conversationId: string, orgId: string, db: DbExecutor = getDb()) {
  await db
    .update(conversations)
    .set({ agentTypingSince: null })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)))
    .catch(() => {});
}

// Al enviar una persona, se refresca la marca. El cliente lo llama con freno (no en cada tecla).
export async function setHumanTyping(conversationId: string, orgId: string, userId: string) {
  await getDb()
    .update(conversations)
    .set({ humanTypingSince: new Date(), humanTypingUserId: userId })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)))
    .catch(() => {});
}

export async function clearHumanTyping(conversationId: string, orgId: string) {
  await getDb()
    .update(conversations)
    .set({ humanTypingSince: null, humanTypingUserId: null })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)))
    .catch(() => {});
}

export type TypingState = { agent: boolean; human: boolean; humanUserId: string | null };

/**
 * Quién está escribiendo ahora. Las marcas vencidas se ignoran acá mismo (no hace falta un
 * barrido que las limpie), y `excludeUserId` evita que alguien se vea a sí mismo escribiendo.
 */
export async function getTypingState(
  conversationId: string,
  orgId: string,
  excludeUserId?: string,
): Promise<TypingState> {
  const [row] = await getDb()
    .select({
      agentTypingSince: conversations.agentTypingSince,
      humanTypingSince: conversations.humanTypingSince,
      humanTypingUserId: conversations.humanTypingUserId,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)));

  if (!row) return { agent: false, human: false, humanUserId: null };

  const fresh = (since: Date | null, ttl: number) => since !== null && Date.now() - since.getTime() < ttl;
  const human =
    fresh(row.humanTypingSince, HUMAN_TYPING_TTL_MS) && row.humanTypingUserId !== (excludeUserId ?? null);

  return {
    agent: fresh(row.agentTypingSince, TYPING_TTL_MS),
    human,
    humanUserId: human ? row.humanTypingUserId : null,
  };
}

// Limpieza defensiva: marcas viejas que quedaron por un proceso caído. La llama el barrido.
export async function clearStaleTyping() {
  await getDb()
    .update(conversations)
    .set({ agentTypingSince: null })
    .where(sql`${conversations.agentTypingSince} < now() - interval '2 minutes'`)
    .catch(() => {});
}
