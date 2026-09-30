import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { conversationEvents, conversations } from "@/db/schema";

// Estado OPERATIVO de una conversación. Es un eje aparte de ai_enabled (que solo apaga al bot),
// de la ventana de mensajería y de unread_count: pausar la IA no cambia la pestaña, y un mensaje
// nuevo no reactiva un hilo desactivado. Archivar oculta, no borra: es reversible.
export const CONVERSATION_STATUSES = ["activa", "desactiva", "archivada"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const isConversationStatus = (value: unknown): value is ConversationStatus =>
  typeof value === "string" && (CONVERSATION_STATUSES as readonly string[]).includes(value);

export const INBOX_TABS = ["desactivas", "activas", "delegadas", "archivadas"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const TAB_STATUS: Record<"desactivas" | "activas" | "archivadas", ConversationStatus> = {
  desactivas: "desactiva",
  activas: "activa",
  archivadas: "archivada",
};

/** Cambia el estado dejando el rastro. Solo dentro de la organización; devuelve false si no existe o ya estaba así. */
export async function setConversationStatus(orgId: string, conversationId: string, status: ConversationStatus, actorUserId: string | null): Promise<boolean> {
  const db = getDb();
  const [current] = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)));
  if (!current || current.status === status) return false;

  const updated = await db
    .update(conversations)
    .set({ status, statusChangedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId), ne(conversations.status, status)))
    .returning({ id: conversations.id });
  if (!updated.length) return false;

  await db
    .insert(conversationEvents)
    .values({ organizationId: orgId, conversationId, actorUserId, action: "estado", fromValue: current.status, toValue: status })
    .catch(() => {});
  return true;
}

export async function countByStatus(orgId: string): Promise<Record<ConversationStatus, number>> {
  const rows = await getDb().execute<{ status: string; n: number }>(sql`
    select status, count(*)::int as n from conversations where organization_id = ${orgId} group by status
  `);
  const out: Record<ConversationStatus, number> = { activa: 0, desactiva: 0, archivada: 0 };
  for (const r of rows) if (isConversationStatus(r.status)) out[r.status] = r.n;
  return out;
}
