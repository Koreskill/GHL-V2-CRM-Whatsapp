import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { channelAccounts, conversations, messages } from "@/db/schema";
import { listConversations, listMessages } from "@/lib/zernio/inbox";
import type { RestConversation, RestMessage } from "@/lib/zernio/types";
import { resolveContact } from "./contacts";

type Account = typeof channelAccounts.$inferSelect;

export type ImportResult = { conversations: number; messages: number; errors: string[] };

const OUT_STATUS = { sent: "sent", delivered: "delivered", read: "read", failed: "failed", deleted: "sent" } as const;

// Importa lo que Zernio ya replicó (no llega por webhook). NUNCA dispara el agente:
// contestarle de golpe a cientos de clientes viejos es un desastre difícil de explicar.
export async function importAccountHistory(
  db: Db,
  account: Account,
  opts: { maxConversations?: number; maxMessagesPerConversation?: number } = {},
): Promise<ImportResult> {
  const maxConversations = opts.maxConversations ?? 500;
  const maxMessages = opts.maxMessagesPerConversation ?? 200;
  const result: ImportResult = { conversations: 0, messages: 0, errors: [] };

  let seen = 0;
  for await (const page of listConversations({ accountId: account.externalId, limit: 50 })) {
    if (!page.success) {
      result.errors.push(`conversaciones: ${page.error.message}`);
      break;
    }
    for (const conv of page.data) {
      if (seen++ >= maxConversations) break;
      if (conv.accountId && conv.accountId !== account.externalId) continue;
      try {
        result.messages += await importConversation(db, account, conv, maxMessages);
        result.conversations++;
      } catch (err) {
        result.errors.push(`${conv.id}: ${err instanceof Error ? err.message.split("\n")[0] : "error"}`);
      }
    }
    if (seen >= maxConversations) break;
  }

  await db.update(channelAccounts).set({ historyImportedAt: sql`now()` }).where(eq(channelAccounts.id, account.id));
  return result;
}

async function fetchMessages(conv: RestConversation, accountId: string, max: number): Promise<RestMessage[]> {
  const out: RestMessage[] = [];
  for await (const page of listMessages(conv.id!, { accountId, limit: 100, sortOrder: "desc" })) {
    if (!page.success) throw new Error(`mensajes: ${page.error.message}`);
    out.push(...page.data);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

async function importConversation(db: Db, account: Account, conv: RestConversation, maxMessages: number) {
  if (!conv.id) return 0;
  const history = await fetchMessages(conv, account.externalId, maxMessages);

  return db.transaction(async (tx) => {
    const contactId = conv.participantId
      ? await resolveContact(tx, {
          organizationId: account.organizationId,
          channel: account.channel,
          externalIds: [conv.participantId],
          name: conv.participantName ?? null,
        })
      : null;

    const attribution = conv.metadata && Object.keys(conv.metadata).length ? { ...conv.metadata, source: "import" } : undefined;

    const [row] = await tx
      .insert(conversations)
      .values({
        organizationId: account.organizationId,
        channel: account.channel,
        provider: "zernio",
        externalId: conv.id!,
        accountId: account.externalId,
        channelAccountId: account.id,
        contactId,
        participantId: conv.participantId ?? null,
        participantName: conv.participantName ?? null,
        participantPicture: conv.participantPicture ?? null,
        metadata: attribution ? { attribution } : {},
      })
      .onConflictDoUpdate({
        target: [conversations.organizationId, conversations.provider, conversations.externalId],
        set: {
          participantName: sql`coalesce(${conversations.participantName}, excluded.participant_name)`,
          participantPicture: sql`coalesce(excluded.participant_picture, ${conversations.participantPicture})`,
          contactId: sql`coalesce(${conversations.contactId}, excluded.contact_id)`,
          metadata: sql`excluded.metadata || ${conversations.metadata}`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: conversations.id });

    let inserted = 0;
    for (const m of history) {
      if (!m.id) continue;
      const inbound = m.direction === "incoming";
      const sentAt = new Date(m.sentAt ?? m.createdAt ?? Date.now());
      const rows = await tx
        .insert(messages)
        .values({
          organizationId: account.organizationId,
          conversationId: row.id,
          channel: account.channel,
          provider: "zernio",
          externalId: m.id,
          direction: inbound ? "inbound" : "outbound",
          type: m.attachments?.[0]?.type ?? "text",
          body: m.message ?? null,
          status: inbound ? "received" : OUT_STATUS[m.deliveryStatus ?? "sent"],
          rawPayload: { source: "import", sentVia: m.sentVia ?? null },
          sentAt,
        })
        .onConflictDoNothing({ target: [messages.organizationId, messages.externalId], where: sql`${messages.externalId} is not null` })
        .returning({ id: messages.id });
      inserted += rows.length;
    }

    // Fechas desde lo guardado; el historial importado queda leído (no suma a unread_count).
    await tx.execute(sql`
      update conversations c set
        last_message_at = greatest(c.last_message_at, (select max(sent_at) from messages where conversation_id = c.id)),
        last_inbound_at = greatest(c.last_inbound_at, (select max(sent_at) from messages where conversation_id = c.id and direction = 'inbound'))
      where c.id = ${row.id}
    `);
    return inserted;
  });
}
