import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { channelAccounts, conversations, messages, type Channel } from "@/db/schema";
import { isCrmChannel } from "@/lib/zernio/accounts";
import type {
  InboxWebhookAccount,
  InboxWebhookConversation,
  WebhookMessageReceived,
  WebhookMessageSent,
  WebhookMessageStatus,
  WebhookReferral,
  ZernioWebhookPayload,
} from "@/lib/zernio/types";
import { resolveContact } from "./contacts";

export type IngestResult =
  | { kind: "message"; conversationId: string; messageId: string | null; inbound: boolean; inserted: boolean; sentAt: Date }
  | { kind: "status"; updated: number }
  | { kind: "account" | "referral" | "test" }
  | { kind: "ignored"; reason: string };

type WebhookMessage = WebhookMessageReceived["message"] | WebhookMessageSent["message"];

const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4, received: 0 } as const;

const accountExternalId = (a: InboxWebhookAccount) => a.accountId ?? a.id;

async function findChannelAccount(db: Db, account: InboxWebhookAccount) {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.externalId, accountExternalId(account)));
  return row;
}

function attributionFrom(payload: WebhookMessageReceived | WebhookMessageSent) {
  if (payload.event !== "message.received") return undefined;
  const referral = payload.metadata?.referral;
  return referral ? { ...referral, capturedAt: payload.timestamp } : undefined;
}

async function upsertConversation(
  db: Db,
  args: {
    channel: Channel;
    channelAccountId: string;
    accountId: string;
    conversation: InboxWebhookConversation;
    contactId: string | null;
    attribution?: Record<string, unknown>;
  },
) {
  const { conversation: c } = args;
  const metadata: Record<string, unknown> = { zernioConversationId: c.id };
  if (args.attribution) metadata.attribution = args.attribution;

  const [row] = await db
    .insert(conversations)
    .values({
      channel: args.channel,
      provider: "zernio",
      externalId: c.platformConversationId,
      accountId: args.accountId,
      channelAccountId: args.channelAccountId,
      contactId: args.contactId,
      participantId: c.participantId ?? null,
      participantName: c.participantName ?? null,
      participantHandle: c.participantUsername ?? null,
      participantPicture: c.participantPicture ?? null,
      metadata,
    })
    .onConflictDoUpdate({
      target: [conversations.provider, conversations.externalId],
      set: {
        participantName: sql`coalesce(excluded.participant_name, ${conversations.participantName})`,
        participantHandle: sql`coalesce(excluded.participant_handle, ${conversations.participantHandle})`,
        participantPicture: sql`coalesce(excluded.participant_picture, ${conversations.participantPicture})`,
        contactId: sql`coalesce(${conversations.contactId}, excluded.contact_id)`,
        // Lo que ya está guardado gana: la atribución del primer click no se pisa.
        metadata: sql`excluded.metadata || ${conversations.metadata}`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: conversations.id });
  return row.id;
}

async function ingestMessage(db: Db, payload: WebhookMessageReceived | WebhookMessageSent): Promise<IngestResult> {
  const account = await findChannelAccount(db, payload.account);
  if (!account) return { kind: "ignored", reason: "unknown_account" };

  const msg: WebhookMessage = payload.message;
  const channel = account.channel;
  if (!isCrmChannel(msg.platform) || msg.platform !== channel) {
    return { kind: "ignored", reason: `platform_mismatch:${msg.platform}` };
  }

  const inbound = msg.direction === "incoming";
  const conv = payload.conversation;
  // Entrante: el remitente es la persona (en WhatsApp, BSUID primero). Saliente: el remitente es la
  // cuenta propia, así que la persona sale de la conversación.
  const identity =
    payload.event === "message.received" && inbound
      ? {
          externalIds: [payload.message.sender.businessScopedUserId, payload.message.sender.id],
          handle: payload.message.sender.username ?? payload.message.sender.whatsappUsername ?? null,
          name: payload.message.sender.name ?? conv.participantName ?? null,
          phone: payload.message.sender.phoneNumber ?? null,
        }
      : { externalIds: [conv.participantId], handle: conv.participantUsername ?? null, name: conv.participantName ?? null, phone: null };
  const externalIds = identity.externalIds.filter((v): v is string => Boolean(v));

  const contactId = externalIds.length ? await resolveContact(db, { channel, ...identity, externalIds }) : null;

  const conversationId = await upsertConversation(db, {
    channel,
    channelAccountId: account.id,
    accountId: account.externalId,
    conversation: payload.conversation,
    contactId,
    attribution: attributionFrom(payload),
  });

  const sentAt = new Date(msg.sentAt);
  const [inserted] = await db
    .insert(messages)
    .values({
      conversationId,
      channel,
      provider: "zernio",
      externalId: msg.platformMessageId,
      direction: inbound ? "inbound" : "outbound",
      type: msg.attachments[0]?.type ?? "text",
      body: msg.text,
      status: inbound ? "received" : "sent",
      rawPayload: payload,
      sentAt,
    })
    .onConflictDoNothing({ target: messages.externalId, where: sql`${messages.externalId} is not null` })
    .returning({ id: messages.id });

  // Contadores solo si el mensaje es nuevo: reprocesar un evento no puede sumar dos veces.
  if (inserted) {
    await db
      .update(conversations)
      .set({
        lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${sentAt})`,
        ...(inbound
          ? {
              lastInboundAt: sql`greatest(${conversations.lastInboundAt}, ${sentAt})`,
              unreadCount: sql`${conversations.unreadCount} + 1`,
            }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, conversationId));
  }

  return { kind: "message", conversationId, messageId: inserted?.id ?? null, inbound, inserted: Boolean(inserted), sentAt };
}

async function ingestStatus(db: Db, payload: WebhookMessageStatus): Promise<IngestResult> {
  const next = payload.event === "message.delivered" ? "delivered" : payload.event === "message.read" ? "read" : "failed";
  const error = payload.error ? [payload.error.code, payload.error.title, payload.error.message].filter(Boolean).join(" · ") : null;

  // No retroceder: un "delivered" que llega después de "read" no pisa el estado.
  const updated = await db
    .update(messages)
    .set({ status: next, ...(next === "failed" ? { error } : {}) })
    .where(
      and(
        eq(messages.externalId, payload.message.platformMessageId),
        sql`(case ${messages.status}
               when 'pending' then 0 when 'received' then 0 when 'sent' then 1
               when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 end) < ${STATUS_RANK[next]}`,
      ),
    )
    .returning({ id: messages.id });
  return { kind: "status", updated: updated.length };
}

async function ingestReferral(db: Db, payload: WebhookReferral): Promise<IngestResult> {
  const attribution = { ...payload.referral, capturedAt: payload.timestamp };
  await db
    .update(conversations)
    .set({ metadata: sql`jsonb_build_object('attribution', ${JSON.stringify(attribution)}::jsonb) || ${conversations.metadata}` })
    .where(and(eq(conversations.provider, "zernio"), eq(conversations.externalId, payload.conversation.platformConversationId)));
  return { kind: "referral" };
}

async function ingestAccount(
  db: Db,
  account: { accountId: string; platform: string; username: string; displayName?: string },
  status: "connected" | "disconnected",
  reason?: string,
): Promise<IngestResult> {
  if (!isCrmChannel(account.platform)) return { kind: "ignored", reason: `platform:${account.platform}` };
  await db
    .insert(channelAccounts)
    .values({
      provider: "zernio",
      channel: account.platform,
      externalId: account.accountId,
      name: account.displayName ?? account.username,
      handle: account.username,
      status,
      metadata: reason ? { disconnectReason: reason } : {},
    })
    .onConflictDoUpdate({
      target: channelAccounts.externalId,
      set: { status, name: sql`excluded.name`, handle: sql`excluded.handle`, metadata: sql`${channelAccounts.metadata} || excluded.metadata`, updatedAt: sql`now()` },
    });
  return { kind: "account" };
}

export async function ingestZernioEvent(db: Db, payload: ZernioWebhookPayload): Promise<IngestResult> {
  switch (payload.event) {
    case "message.received":
    case "message.sent":
      return ingestMessage(db, payload);
    case "message.delivered":
    case "message.read":
    case "message.failed":
      return ingestStatus(db, payload);
    case "referral.received":
      return ingestReferral(db, payload);
    case "account.connected":
      return ingestAccount(db, payload.account, "connected");
    case "account.disconnected":
      return ingestAccount(db, payload.account, "disconnected", payload.account.reason);
    case "webhook.test":
      return { kind: "test" };
    default:
      return { kind: "ignored", reason: `unhandled_event:${(payload as { event?: string }).event}` };
  }
}
