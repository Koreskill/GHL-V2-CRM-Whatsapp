import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, conversations, messages, type Channel } from "@/db/schema";
import { computeWindow, type MessagingWindow } from "./window";

export type ConversationListItem = {
  id: string;
  channel: Channel;
  name: string;
  handle: string | null;
  phone: string | null;
  picture: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  preview: string | null;
  previewDirection: "inbound" | "outbound" | null;
};

export async function listConversations(filters: { channel?: Channel; q?: string; limit?: number }) {
  const db = getDb();
  const where: SQL[] = [];
  if (filters.channel) where.push(eq(conversations.channel, filters.channel));
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(
      or(
        ilike(conversations.participantName, like),
        ilike(conversations.participantHandle, like),
        ilike(conversations.participantId, like),
        ilike(contacts.name, like),
        ilike(contacts.phone, like),
      )!,
    );
  }

  // Última vista previa por conversación con LATERAL: una sola consulta, sin N+1.
  const last = sql`lateral (
    select m.body, m.direction from ${messages} m
    where m.conversation_id = ${conversations.id}
    order by m.sent_at desc limit 1
  ) as last`;

  const rows = await db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      participantName: conversations.participantName,
      participantHandle: conversations.participantHandle,
      participantId: conversations.participantId,
      participantPicture: conversations.participantPicture,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      lastMessageAt: conversations.lastMessageAt,
      unreadCount: conversations.unreadCount,
      preview: sql<string | null>`last.body`,
      previewDirection: sql<"inbound" | "outbound" | null>`last.direction`,
    })
    .from(conversations)
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(last, sql`true`)
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
    .limit(filters.limit ?? 100);

  return rows.map<ConversationListItem>((r) => ({
    id: r.id,
    channel: r.channel,
    name: r.contactName ?? r.participantName ?? r.participantHandle ?? r.participantId ?? "Sin nombre",
    handle: r.participantHandle,
    phone: r.channel === "whatsapp" ? (r.contactPhone ?? (r.participantId && /^\d{8,15}$/.test(r.participantId) ? `+${r.participantId}` : null)) : null,
    picture: r.participantPicture,
    lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    unreadCount: r.unreadCount,
    preview: r.preview,
    previewDirection: r.previewDirection,
  }));
}

export async function countConversations() {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(conversations);
  return row.n;
}

export type ConversationDetail = ConversationListItem & {
  aiEnabled: boolean;
  window: MessagingWindow;
};

export async function getConversation(id: string): Promise<ConversationDetail | null> {
  const db = getDb();
  const [r] = await db
    .select({ conv: conversations, contactName: contacts.name, contactPhone: contacts.phone })
    .from(conversations)
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, id));
  if (!r) return null;
  const c = r.conv;
  return {
    id: c.id,
    channel: c.channel,
    name: r.contactName ?? c.participantName ?? c.participantHandle ?? c.participantId ?? "Sin nombre",
    handle: c.participantHandle,
    phone: c.channel === "whatsapp" ? (r.contactPhone ?? (c.participantId && /^\d{8,15}$/.test(c.participantId) ? `+${c.participantId}` : null)) : null,
    picture: c.participantPicture,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unreadCount: c.unreadCount,
    preview: null,
    previewDirection: null,
    aiEnabled: c.aiEnabled,
    window: computeWindow(c.channel, c.lastInboundAt),
  };
}

export type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  status: string;
  error: string | null;
  sentAt: string;
  source: "human" | "agent" | null;
};

export async function listMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      type: messages.type,
      body: messages.body,
      status: messages.status,
      error: messages.error,
      sentAt: messages.sentAt,
      source: sql<string | null>`${messages.rawPayload}->>'source'`,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.sentAt))
    .limit(limit);

  return rows.reverse().map((m) => ({
    ...m,
    sentAt: m.sentAt.toISOString(),
    source: m.source === "agent" || m.source === "human" ? m.source : null,
  }));
}

export async function markConversationRead(id: string) {
  await getDb().update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, id));
}

export async function setConversationAi(id: string, enabled: boolean) {
  await getDb().update(conversations).set({ aiEnabled: enabled }).where(eq(conversations.id, id));
}

