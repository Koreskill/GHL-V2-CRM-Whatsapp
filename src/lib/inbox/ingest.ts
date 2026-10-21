import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor as Db } from "@/db";
import { channelAccounts, conversations, messages, type Channel } from "@/db/schema";
import { applyAccountSnapshot, isCrmChannel } from "@/lib/zernio/accounts";
import type {
  InboxWebhookAccount,
  InboxWebhookConversation,
  WebhookMessageReceived,
  WebhookMessageSent,
  WebhookMessageStatus,
  WebhookReferral,
  ZernioWebhookPayload,
} from "@/lib/zernio/types";
import { automationAllowed, ingestAllowed, orgStatus } from "@/lib/agency/lifecycle";
import { isOptOutRequest } from "@/lib/crm/opt-out";
import { enqueue } from "@/lib/jobs/queue";
import { resolveContact } from "./contacts";

export type IngestResult =
  | { kind: "message"; conversationId: string; messageId: string | null; inbound: boolean; inserted: boolean; sentAt: Date }
  | { kind: "status"; updated: number }
  | { kind: "account"; accountExternalId: string; status: "connected" | "disconnected" }
  | { kind: "referral" | "test" }
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
    organizationId: string;
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
      organizationId: args.organizationId,
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
      target: [conversations.organizationId, conversations.provider, conversations.externalId],
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
  const organizationId = account.organizationId;
  // Suspendida: se guarda igual (no se pierde). Eliminada: sus datos ya se anonimizaron, no se vuelve a llenar.
  const status = await orgStatus(organizationId);
  if (!ingestAllowed(status)) return { kind: "ignored", reason: "org_eliminada" };
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

  const contactId = externalIds.length ? await resolveContact(db, { organizationId, channel, ...identity, externalIds }) : null;

  const conversationId = await upsertConversation(db, {
    organizationId,
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
      organizationId,
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
    .onConflictDoNothing({ target: [messages.organizationId, messages.externalId], where: sql`${messages.externalId} is not null` })
    .returning({ id: messages.id });

  // Contadores solo si el mensaje es nuevo: reprocesar un evento no puede sumar dos veces.
  if (inserted) {
    const at = sql`${sentAt.toISOString()}::timestamptz`;
    await db
      .update(conversations)
      .set({
        lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${at})`,
        ...(inbound
          ? {
              lastInboundAt: sql`greatest(${conversations.lastInboundAt}, ${at})`,
              unreadCount: sql`${conversations.unreadCount} + 1`,
            }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, conversationId));

    if (inbound) {
      // Contestó: los seguimientos de este hilo se cortan (el próximo ciclo arranca de cero si vuelve a callar).
      await db.execute(sql`
        update followup_enrollments set status = 'respondio', responded_at = ${at}, next_run_at = null, lease_until = null, updated_at = now()
        where conversation_id = ${conversationId} and organization_id = ${organizationId} and status = 'activa'
      `);
      // Pidió la baja de mensajes comerciales: queda marcado en el contacto (campañas y seguimientos lo excluyen).
      if (contactId && isOptOutRequest(msg.text)) {
        await db.execute(sql`
          update contacts set marketing_opt_out_at = coalesce(marketing_opt_out_at, ${at}), marketing_opt_out_source = coalesce(marketing_opt_out_source, 'mensaje'), updated_at = now()
          where id = ${contactId} and organization_id = ${organizationId}
        `);
      }
      // El triaje se ENCOLA en la misma transacción: si el evento quedó guardado, el trabajo también. Un
      // reinicio del proceso no pierde la respuesta (antes vivía en un after() en memoria). La espera de
      // 5 s agrupa ráfagas: solo el último mensaje de la ráfaga contesta (ver superseded() en run.ts).
      if (automationAllowed(status)) {
        await enqueue(
          {
            organizationId,
            kind: "triage",
            dedupeKey: `triage:${inserted.id}`,
            payload: { conversationId, messageId: inserted.id },
            runAfter: new Date(Date.now() + TRIAGE_BATCH_MS),
            maxAttempts: 3,
          },
          db,
        );
      }
    }
  }

  return { kind: "message", conversationId, messageId: inserted?.id ?? null, inbound, inserted: Boolean(inserted), sentAt };
}

export const TRIAGE_BATCH_MS = 5_000;

async function ingestStatus(db: Db, payload: WebhookMessageStatus): Promise<IngestResult> {
  const next = payload.event === "message.delivered" ? "delivered" : payload.event === "message.read" ? "read" : "failed";
  const error = payload.error ? [payload.error.code, payload.error.title, payload.error.message].filter(Boolean).join(" · ") : null;

  // Solo dentro de la inmobiliaria dueña de la cuenta: el id externo es único por inmobiliaria, no global.
  const account = await findChannelAccount(db, payload.account);
  if (!account) return { kind: "ignored", reason: "unknown_account" };

  // No retroceder: un "delivered" que llega después de "read" no pisa el estado.
  const updated = await db
    .update(messages)
    .set({ status: next, ...(next === "failed" ? { error } : {}) })
    .where(
      and(
        eq(messages.organizationId, account.organizationId),
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
  const account = await findChannelAccount(db, payload.account);
  if (!account) return { kind: "ignored", reason: "unknown_account" };
  const attribution = { ...payload.referral, capturedAt: payload.timestamp };
  await db
    .update(conversations)
    .set({ metadata: sql`jsonb_build_object('attribution', ${JSON.stringify(attribution)}::jsonb) || ${conversations.metadata}` })
    .where(
      and(
        eq(conversations.organizationId, account.organizationId),
        eq(conversations.provider, "zernio"),
        eq(conversations.externalId, payload.conversation.platformConversationId),
      ),
    );
  return { kind: "referral" };
}

async function ingestAccount(
  db: Db,
  account: { accountId: string; platform: string; username: string; displayName?: string },
  status: "connected" | "disconnected",
  reason?: string,
): Promise<IngestResult> {
  if (!isCrmChannel(account.platform)) return { kind: "ignored", reason: `platform:${account.platform}` };
  await applyAccountSnapshot(db, {
    externalId: account.accountId,
    channel: account.platform,
    name: account.displayName ?? account.username,
    handle: account.username,
    status,
    metadata: reason ? { disconnectReason: reason } : {},
  });
  return { kind: "account", accountExternalId: account.accountId, status };
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
