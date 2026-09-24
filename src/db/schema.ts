import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
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
// Fase 3 — Propiedades
export const operationTypeEnum = pgEnum("operation_type", ["venta", "alquiler", "temporario"]);
export const propertyTypeEnum = pgEnum("property_type", [
  "departamento",
  "casa",
  "ph",
  "terreno",
  "local",
  "oficina",
  "cochera",
  "otro",
]);
export const propertyStatusEnum = pgEnum("property_status", [
  "borrador",
  "disponible",
  "reservada",
  "vendida",
  "alquilada",
  "pausada",
]);
export const listingStatusEnum = pgEnum("listing_status", ["publicada", "pausada", "retirada"]);
// Fase 4 — Capa de IA (OpenRouter)
export const aiFunctionEnum = pgEnum("ai_function", [
  "conversacional",
  "extraccion",
  "calificacion",
  "fallback",
]);
export const aiCallStatusEnum = pgEnum("ai_call_status", ["ok", "error", "timeout"]);
// Fase 5 — Matching
export const matchStatusEnum = pgEnum("match_status", ["sugerida", "presentada", "descartada"]);
// Fase 6 — Atribución
export const presentationStatusEnum = pgEnum("presentation_status", [
  "presentada",
  "visita_solicitada",
  "visita_agendada",
  "negociando",
  "cerrada_ganada",
  "cerrada_perdida",
  "cancelada",
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

// ─── Fase 3: Propiedades ────────────────────────────────────────────────────
// La propiedad privada del tenant: tiene TODO, incluida la info reservada que nunca se comparte.
export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerContactId: uuid("owner_contact_id").references(() => contacts.id, { onDelete: "set null" }),
    operation: operationTypeEnum("operation").notNull(),
    propertyType: propertyTypeEnum("property_type").notNull(),
    status: propertyStatusEnum("status").notNull().default("borrador"),
    title: text("title"),
    description: text("description"),
    price: numeric("price", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    addressFull: text("address_full"), // privado
    zone: text("zone"),
    city: text("city"),
    lat: numeric("lat"),
    lng: numeric("lng"),
    bedrooms: integer("bedrooms"),
    bathrooms: integer("bathrooms"),
    areaM2: numeric("area_m2"),
    features: jsonb("features").$type<Record<string, unknown>>().notNull().default({}),
    photos: jsonb("photos").$type<string[]>().notNull().default([]),
    internalNotes: text("internal_notes"), // privado, nunca sale del tenant
    documents: jsonb("documents").$type<unknown[]>().notNull().default([]), // privado
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("properties_org_status_idx").on(t.organizationId, t.status),
    index("properties_org_operation_type_idx").on(t.organizationId, t.operation, t.propertyType),
  ],
);

// La proyección compartida en la red: solo campos comerciales. Compartir = crear/actualizar acá,
// no abrir acceso a properties. owner_organization_id es fijo, nunca cambia.
export const networkPropertyListings = pgTable(
  "network_property_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    ownerOrganizationId: uuid("owner_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    operation: operationTypeEnum("operation").notNull(),
    propertyType: propertyTypeEnum("property_type").notNull(),
    price: numeric("price", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    zone: text("zone"),
    city: text("city"),
    lat: numeric("lat"),
    lng: numeric("lng"),
    bedrooms: integer("bedrooms"),
    bathrooms: integer("bathrooms"),
    areaM2: numeric("area_m2"),
    features: jsonb("features").$type<Record<string, unknown>>().notNull().default({}),
    photos: jsonb("photos").$type<string[]>().notNull().default([]),
    commercialDescription: text("commercial_description"),
    availability: text("availability").notNull().default("disponible"),
    presentationLink: text("presentation_link"),
    collaborationTerms: jsonb("collaboration_terms").$type<Record<string, unknown>>().notNull().default({}),
    status: listingStatusEnum("status").notNull().default("publicada"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("network_property_listings_network_property_key").on(t.networkId, t.propertyId),
    index("network_property_listings_network_idx").on(t.networkId, t.status),
    index("network_property_listings_owner_org_idx").on(t.ownerOrganizationId),
  ],
);

// ─── Fase 4: Capa de IA (OpenRouter) ────────────────────────────────────────
// Modelo por inmobiliaria y función. Las CLAVES no van acá: viven en env server-side.
export const aiModelConfigs = pgTable(
  "ai_model_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    function: aiFunctionEnum("function").notNull(),
    provider: text("provider").notNull().default("openrouter"),
    model: text("model").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    priority: integer("priority").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("ai_model_configs_org_function_priority_key").on(t.organizationId, t.function, t.priority)],
);

// Registro de cada request a IA: proveedor, modelo, tokens, costo, latencia, estado.
export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    function: aiFunctionEnum("function").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    status: aiCallStatusEnum("status").notNull(),
    error: text("error"), // sin datos personales (safeError)
    requestRef: jsonb("request_ref").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_logs_org_created_idx").on(t.organizationId, t.createdAt)],
);

// ─── Fase 5: Prospectos y matching ──────────────────────────────────────────
// Perfil estructurado del prospecto extraído de la conversación. NUNCA sale del tenant.
export const prospectRequirements = pgTable(
  "prospect_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    operation: operationTypeEnum("operation"),
    propertyTypes: jsonb("property_types").$type<string[]>().notNull().default([]),
    zones: jsonb("zones").$type<string[]>().notNull().default([]),
    bedroomsMin: integer("bedrooms_min"),
    bathroomsMin: integer("bathrooms_min"),
    priceMin: numeric("price_min", { precision: 14, scale: 2 }),
    priceMax: numeric("price_max", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    areaMin: numeric("area_min"),
    mustHave: jsonb("must_have").$type<string[]>().notNull().default([]),
    niceToHave: jsonb("nice_to_have").$type<string[]>().notNull().default([]),
    rawExtraction: jsonb("raw_extraction").$type<Record<string, unknown>>(),
    confidence: numeric("confidence"),
    status: text("status").notNull().default("activo"),
    ...timestamps,
  },
  (t) => [
    index("prospect_requirements_org_idx").on(t.organizationId, t.status),
    index("prospect_requirements_contact_idx").on(t.contactId),
  ],
);

// Resultado del cruce perfil <-> catálogo de red. Privado del tenant del prospecto.
export const propertyMatches = pgTable(
  "property_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    prospectRequirementId: uuid("prospect_requirement_id")
      .notNull()
      .references(() => prospectRequirements.id, { onDelete: "cascade" }),
    networkPropertyListingId: uuid("network_property_listing_id")
      .notNull()
      .references(() => networkPropertyListings.id, { onDelete: "cascade" }),
    score: numeric("score").notNull(),
    reasons: jsonb("reasons").$type<{ factor: string; peso: number; detalle: string }[]>().notNull().default([]),
    status: matchStatusEnum("status").notNull().default("sugerida"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("property_matches_req_listing_key").on(t.prospectRequirementId, t.networkPropertyListingId),
    index("property_matches_org_idx").on(t.organizationId),
  ],
);

// ─── Fase 6: Atribución comercial ───────────────────────────────────────────
// Único punto donde se tocan dos tenants: solo IDs, estado y condiciones. Sin datos privados.
export const propertyPresentations = pgTable(
  "property_presentations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    networkPropertyListingId: uuid("network_property_listing_id")
      .notNull()
      .references(() => networkPropertyListings.id, { onDelete: "cascade" }),
    ownerOrganizationId: uuid("owner_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    presentingOrganizationId: uuid("presenting_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    prospectContactId: uuid("prospect_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    prospectRequirementId: uuid("prospect_requirement_id").references(() => prospectRequirements.id, { onDelete: "set null" }),
    matchId: uuid("match_id").references(() => propertyMatches.id, { onDelete: "set null" }),
    status: presentationStatusEnum("status").notNull().default("presentada"),
    presentedAt: timestamp("presented_at", { withTimezone: true }).notNull().defaultNow(),
    visitRequestedAt: timestamp("visit_requested_at", { withTimezone: true }),
    // null hasta que el prospecto pide visita: recién ahí se notifica/coordina con el dueño.
    ownerNotifiedAt: timestamp("owner_notified_at", { withTimezone: true }),
    commissionTerms: jsonb("commission_terms").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("property_presentations_owner_idx").on(t.ownerOrganizationId),
    index("property_presentations_presenting_idx").on(t.presentingOrganizationId),
    index("property_presentations_listing_idx").on(t.networkPropertyListingId),
  ],
);
