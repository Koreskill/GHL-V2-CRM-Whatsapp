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
// Fase 7 — Pipeline de oportunidades
// La ETAPA es dónde está la oportunidad en el tablero; el ESTADO es si sigue viva.
// Van separados a propósito: una oportunidad perdida conserva la etapa en la que se cayó,
// que es justo el dato que sirve para saber dónde se traban las ventas.
export const dealStageEnum = pgEnum("deal_stage", [
  "prospecto",
  "contactado",
  "propuesta",
  "negociacion",
  "cerrado_ganado",
]);
export const dealStatusEnum = pgEnum("deal_status", ["abierta", "ganada", "perdida"]);

// Fase 8 — Visitas. Pedir una visita NO es tenerla agendada: son estados distintos.
// Reprogramar no es un estado: mueve scheduled_at y queda en el historial.
export const visitStatusEnum = pgEnum("visit_status", [
  "solicitada",
  "agendada",
  "realizada",
  "no_asistio",
  "cancelada",
]);

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
    // ── Indicador "escribiendo…" (Fase 11) ──
    // Estado efímero de la conversación, NO un mensaje: nunca entra al historial.
    // Zernio no expone typing/presence, así que esto se ve SOLO dentro del CRM; la persona
    // del otro lado (WhatsApp/Instagram) no ve nada.
    agentTypingSince: timestamp("agent_typing_since", { withTimezone: true }),
    humanTypingSince: timestamp("human_typing_since", { withTimezone: true }),
    humanTypingUserId: uuid("human_typing_user_id"),
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
    // ── Sincronización con Google Sheets (Fase 9) ──
    // property_id de la hoja: clave ESTABLE. Se actualiza la misma propiedad aunque cambien
    // título o precio. Único por inmobiliaria (dos clientes pueden usar el mismo id en su hoja).
    externalId: text("external_id"),
    source: text("source").notNull().default("manual"), // manual | google_sheets
    addressPublic: text("address_public"), // la publicable; address_full sigue siendo privada
    mapUrl: text("map_url"),
    parking: integer("parking"),
    areaCoveredM2: numeric("area_covered_m2"),
    amenities: jsonb("amenities").$type<string[]>().notNull().default([]),
    coverUrl: text("cover_url"),
    galleryUrls: jsonb("gallery_urls").$type<string[]>().notNull().default([]),
    videoUrl: text("video_url"),
    tour360Url: text("tour_360_url"),
    sourceUrl: text("source_url"), // enlace original del aviso
    externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    // Qué faltó o vino mal en la última sincronización. La ficha lo señala en vez de inventarlo.
    syncIssues: jsonb("sync_issues").$type<string[]>().notNull().default([]),
    internalNotes: text("internal_notes"), // privado, nunca sale del tenant
    documents: jsonb("documents").$type<unknown[]>().notNull().default([]), // privado
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("properties_org_status_idx").on(t.organizationId, t.status),
    index("properties_org_operation_type_idx").on(t.organizationId, t.operation, t.propertyType),
    // Parcial: solo las que vienen de la hoja tienen external_id, y no se puede repetir dentro de
    // la misma inmobiliaria. Las cargadas a mano lo dejan en null y no chocan entre sí.
    uniqueIndex("properties_org_external_id_key")
      .on(t.organizationId, t.externalId)
      .where(sql`${t.externalId} is not null`),
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

// ─── Fase 7: Pipeline de oportunidades ──────────────────────────────────────
// La unidad comercial es la OPORTUNIDAD, no el contacto ni la propiedad: si alguien pregunta por
// tres departamentos es UNA oportunidad con tres propiedades, no tres oportunidades duplicadas.
// El mismo contacto puede tener otra oportunidad más adelante si busca algo distinto.
export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // De qué conversación nació. Opcional: un asesor puede cargarla a mano.
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    // Qué busca el contacto NO se duplica acá: vive en prospect_requirements, que ya lo extrae
    // de la conversación (operación, zonas, presupuesto, ambientes).
    prospectRequirementId: uuid("prospect_requirement_id").references(() => prospectRequirements.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    stage: dealStageEnum("stage").notNull().default("prospecto"),
    status: dealStatusEnum("status").notNull().default("abierta"),
    lostReason: text("lost_reason"),
    // Usuario de Supabase Auth. Sin FK: auth.users vive en otro esquema y crm_app no lo toca.
    assignedUserId: uuid("assigned_user_id"),
    // Opcional a propósito: el precio de una propiedad NO es el valor comercial de la oportunidad.
    value: numeric("value", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    notes: text("notes"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("deals_org_stage_idx").on(t.organizationId, t.status, t.stage),
    index("deals_org_contact_idx").on(t.organizationId, t.contactId),
    index("deals_org_assigned_idx").on(t.organizationId, t.assignedUserId),
  ],
);

// Propiedades de interés de una oportunidad. Una oportunidad tiene varias; una propiedad puede
// estar en varias oportunidades.
export const dealProperties = pgTable(
  "deal_properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deal_properties_deal_property_key").on(t.dealId, t.propertyId),
    index("deal_properties_org_idx").on(t.organizationId),
  ],
);

// Historial de la oportunidad: quién la movió, cuándo y de dónde a dónde. Append-only.
export const dealEvents = pgTable(
  "deal_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deal_events_deal_idx").on(t.dealId, t.createdAt)],
);

export type DealStage = (typeof dealStageEnum.enumValues)[number];
export type DealStatus = (typeof dealStatusEnum.enumValues)[number];

// ─── Fase 8: Visitas ────────────────────────────────────────────────────────
// Una visita es una cita a UNA propiedad concreta, dentro de una oportunidad. Una oportunidad
// puede acumular varias, incluso a propiedades distintas.
// property_presentations NO sirve para esto: es de la red de colaboración (apunta a
// network_property_listings, no a properties) y su visit_requested_at es un timestamp suelto, sin
// fecha confirmada ni resultado. Acá se enlaza esa presentación cuando existe, pero un asesor
// también puede cargar la visita a mano.
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    // Solo si la visita nació de una presentación de la red. Nullable a propósito.
    propertyPresentationId: uuid("property_presentation_id").references(() => propertyPresentations.id, {
      onDelete: "set null",
    }),
    status: visitStatusEnum("status").notNull().default("solicitada"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    // Null mientras esté solo solicitada: pedir no es tener fecha.
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    assignedUserId: uuid("assigned_user_id"),
    // Nota de seguimiento que se carga después de la cita.
    notes: text("notes"),
    cancelReason: text("cancel_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("visits_org_status_idx").on(t.organizationId, t.status, t.scheduledAt),
    index("visits_deal_idx").on(t.dealId),
    index("visits_property_idx").on(t.propertyId),
    index("visits_contact_idx").on(t.contactId),
  ],
);

// Historial de la visita: reprogramaciones, cancelaciones y resultado. Append-only.
export const visitEvents = pgTable(
  "visit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("visit_events_visit_idx").on(t.visitId, t.createdAt)],
);

export type VisitStatus = (typeof visitStatusEnum.enumValues)[number];

// ─── Fase 9: Catálogo sincronizado desde Google Sheets ──────────────────────
// La hoja es la FUENTE de la cartera: el CRM la refleja, no la edita. Así no pasa que alguien
// cambie un precio en el CRM y quede otro distinto en la hoja.
export const propertySyncConfigs = pgTable(
  "property_sync_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spreadsheetId: text("spreadsheet_id").notNull(),
    // gid de la pestaña. Null = la primera.
    sheetGid: text("sheet_gid"),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastStatus: text("last_status"), // ok | error
    lastError: text("last_error"), // sin credenciales: safeError()
    lastRowsSeen: integer("last_rows_seen"),
    lastRowsUpserted: integer("last_rows_upserted"),
    lastRowsSkipped: integer("last_rows_skipped"),
    ...timestamps,
  },
  (t) => [uniqueIndex("property_sync_configs_org_key").on(t.organizationId)],
);

// ─── Fase 10: Errores y logs operativos ─────────────────────────────────────
// Bandeja para RESOLVER problemas, no un log técnico más: mensaje claro, detalle aparte, estado
// y reintento cuando es seguro. Nunca guarda credenciales ni el texto de los mensajes.
export const incidentStatusEnum = pgEnum("incident_status", ["nuevo", "en_revision", "resuelto"]);
export const incidentSeverityEnum = pgEnum("incident_severity", ["info", "advertencia", "error"]);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null = incidente del plano de agencia, no de una inmobiliaria concreta.
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    module: text("module").notNull(), // sheets | mensajeria | agente | webhook | pipeline | visitas
    severity: incidentSeverityEnum("severity").notNull().default("error"),
    status: incidentStatusEnum("status").notNull().default("nuevo"),
    // Qué pasó, en castellano y para alguien que opera, no para quien programó.
    message: text("message").notNull(),
    detail: text("detail"), // detalle técnico, ya pasado por safeError()
    // Para agrupar repeticiones del mismo problema en vez de llenar la bandeja.
    fingerprint: text("fingerprint").notNull(),
    occurrences: integer("occurrences").notNull().default(1),
    // Qué habría que reintentar; null si no es seguro reintentar.
    retryTarget: text("retry_target"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Un mismo problema abierto se acumula en una fila en vez de repetirse.
    uniqueIndex("incidents_fingerprint_key").on(t.fingerprint),
    index("incidents_org_status_idx").on(t.organizationId, t.status, t.lastSeenAt),
    index("incidents_module_idx").on(t.module, t.status),
  ],
);

export type IncidentStatus = (typeof incidentStatusEnum.enumValues)[number];
export type IncidentSeverity = (typeof incidentSeverityEnum.enumValues)[number];
