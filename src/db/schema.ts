import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const channelEnum = pgEnum("channel", ["whatsapp", "instagram", "facebook"]);
export const providerEnum = pgEnum("provider", ["zernio", "meta"]);
export const directionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
]);

export type Channel = (typeof channelEnum.enumValues)[number];
export type Provider = (typeof providerEnum.enumValues)[number];

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  phone: text("phone"),
  email: text("email"),
  ...timestamps,
});

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    externalId: text("external_id").notNull(),
    handle: text("handle"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_identities_channel_external_id_key").on(t.channel, t.externalId),
    index("contact_identities_contact_id_idx").on(t.contactId),
  ],
);

export const channelAccounts = pgTable("channel_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: providerEnum("provider").notNull(),
  channel: channelEnum("channel").notNull(),
  externalId: text("external_id").notNull().unique(),
  name: text("name"),
  handle: text("handle"),
  status: text("status").notNull().default("connected"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  historyImportedAt: timestamp("history_imported_at", { withTimezone: true }),
  ...timestamps,
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    channelAccountId: uuid("channel_account_id").references(() => channelAccounts.id, {
      onDelete: "set null",
    }),
    channel: channelEnum("channel").notNull(),
    provider: providerEnum("provider").notNull(),
    externalId: text("external_id").notNull(),
    accountId: text("account_id").notNull(),
    participantId: text("participant_id"),
    participantName: text("participant_name"),
    participantHandle: text("participant_handle"),
    participantPicture: text("participant_picture"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("conversations_provider_external_id_key").on(t.provider, t.externalId),
    index("conversations_last_message_at_idx").on(t.lastMessageAt.desc()),
    index("conversations_channel_idx").on(t.channel),
    index("conversations_contact_id_idx").on(t.contactId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    provider: providerEnum("provider").notNull(),
    externalId: text("external_id"),
    direction: directionEnum("direction").notNull(),
    type: text("type").notNull().default("text"),
    body: text("body"),
    status: messageStatusEnum("status").notNull(),
    error: text("error"),
    rawPayload: jsonb("raw_payload"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Solo external_id (no provider): un mismo id que entre por dos proveedores no se duplica.
    uniqueIndex("messages_external_id_key")
      .on(t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("messages_conversation_sent_at_idx").on(t.conversationId, t.sentAt),
  ],
);

export const agentConfigs = pgTable("agent_configs", {
  // 'global' o un canal; los campos nulos caen en cascada: canal -> global -> default del código.
  scope: text("scope").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  systemPrompt: text("system_prompt"),
  enabledTools: text("enabled_tools").array(),
  model: text("model"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    eventId: text("event_id").primaryKey(),
    provider: providerEnum("provider").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    index("webhook_events_unprocessed_idx")
      .on(t.receivedAt)
      .where(sql`${t.processedAt} is null`),
  ],
);
