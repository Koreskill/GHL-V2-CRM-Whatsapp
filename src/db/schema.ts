import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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
export const memberRoleEnum = pgEnum("member_role", ["admin", "agente"]);
export const networkMemberStatusEnum = pgEnum("network_member_status", [
  "activa",
  "invitada",
  "suspendida",
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

// ─── Núcleo de tenancy ──────────────────────────────────────────────────────
// La unidad de aislamiento es organizations (la inmobiliaria). Toda tabla de datos
// transaccionales lleva organization_id y toda query se filtra por él.

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("activa"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

// Una red (ej: Cowin) habilita un catálogo compartido. NO es padre de sus miembros:
// no hereda acceso a sus datos privados.
export const networks = pgTable("networks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("activa"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const networkMembers = pgTable(
  "network_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: networkMemberStatusEnum("status").notNull().default("invitada"),
    collaborationTerms: jsonb("collaboration_terms").$type<Record<string, unknown>>().notNull().default({}),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("network_members_network_org_key").on(t.networkId, t.organizationId)],
);

// Mapea un usuario de Supabase Auth a su inmobiliaria y su rol.
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("agente"),
    ...timestamps,
  },
  (t) => [uniqueIndex("organization_members_user_org_key").on(t.userId, t.organizationId)],
);

// Auditoría del plano de control de la agencia (cambios de contexto, cambios sensibles).
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").notNull(),
  actingAsOrganizationId: uuid("acting_as_organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  target: text("target"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── CRM (por tenant) ───────────────────────────────────────────────────────

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name"),
  phone: text("phone"),
  email: text("email"),
  ...timestamps,
});

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    externalId: text("external_id").notNull(),
    handle: text("handle"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Identidad por tenant: dos inmobiliarias pueden hablarle al mismo external_id como contactos distintos.
    uniqueIndex("contact_identities_org_channel_external_id_key").on(
      t.organizationId,
      t.channel,
      t.externalId,
    ),
    index("contact_identities_contact_id_idx").on(t.contactId),
  ],
);

export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    channel: channelEnum("channel").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name"),
    handle: text("handle"),
    status: text("status").notNull().default("connected"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    historyImportedAt: timestamp("history_imported_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("channel_accounts_org_external_id_key").on(t.organizationId, t.externalId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
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
    uniqueIndex("conversations_org_provider_external_id_key").on(
      t.organizationId,
      t.provider,
      t.externalId,
    ),
    index("conversations_last_message_at_idx").on(t.lastMessageAt.desc()),
    index("conversations_channel_idx").on(t.channel),
    index("conversations_contact_id_idx").on(t.contactId),
    index("conversations_org_idx").on(t.organizationId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
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
    // Idempotencia por tenant: un mismo external_id de dos inmobiliarias distintas no colisiona.
    uniqueIndex("messages_org_external_id_key")
      .on(t.organizationId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("messages_conversation_sent_at_idx").on(t.conversationId, t.sentAt),
  ],
);

export const agentConfigs = pgTable(
  "agent_configs",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // 'global' o un canal; los campos nulos caen en cascada: canal -> global -> default del código.
    scope: text("scope").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    systemPrompt: text("system_prompt"),
    enabledTools: text("enabled_tools").array(),
    model: text("model"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.scope] })],
);

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
