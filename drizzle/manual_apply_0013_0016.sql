-- Aplica las migraciones 0013 a 0016 y las registra en drizzle.__drizzle_migrations.
-- Ejecutar con el rol DUEÑO (SQL Editor de Supabase). Es una sola transacción: si algo falla, no queda nada a medias.
BEGIN;

-- ── 0013_ficha_publica ──
CREATE TYPE "public"."publication_status" AS ENUM('borrador', 'publicada', 'pausada');
CREATE TABLE "property_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"status" "publication_status" DEFAULT 'borrador' NOT NULL,
	"headline" text,
	"show_address" boolean DEFAULT false NOT NULL,
	"brand" text DEFAULT 'cowin' NOT NULL,
	"published_at" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"cta_clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "property_publications" ADD CONSTRAINT "property_publications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "property_publications" ADD CONSTRAINT "property_publications_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "property_publications_slug_key" ON "property_publications" USING btree ("slug");
CREATE UNIQUE INDEX "property_publications_property_key" ON "property_publications" USING btree ("property_id");
CREATE INDEX "property_publications_org_idx" ON "property_publications" USING btree ("organization_id","status");
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "property_publications" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON property_publications TO crm_app;
GRANT USAGE ON TYPE publication_status TO crm_app;
CREATE POLICY crm_app_all ON property_publications FOR ALL TO crm_app USING (true) WITH CHECK (true);
REVOKE ALL ON property_publications FROM anon, authenticated;

INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '119f9d7ec1f461c067a709e50e2184218b926fab821798eb282f299ef24b4416', 1790801558615 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '119f9d7ec1f461c067a709e50e2184218b926fab821798eb282f299ef24b4416');

-- ── 0014_contactos_vistas_campanas ──
CREATE TABLE "campaign_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "channel" DEFAULT 'whatsapp' NOT NULL,
	"template_name" text NOT NULL,
	"template_language" text NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'estimada' NOT NULL,
	"audience_count" integer DEFAULT 0 NOT NULL,
	"excluded" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"unit_price" numeric(12, 4) DEFAULT '0' NOT NULL,
	"tax_pct" numeric(6, 2) DEFAULT '0' NOT NULL,
	"surcharge_pct" numeric(6, 2) DEFAULT '0' NOT NULL,
	"rate_source" text DEFAULT 'manual' NOT NULL,
	"rate_date" timestamp with time zone,
	"estimated_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"message_id" uuid,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "contact_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "campaign_batches" ADD CONSTRAINT "campaign_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "contact_views" ADD CONSTRAINT "contact_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "campaign_batches_org_idx" ON "campaign_batches" USING btree ("organization_id","created_at");
CREATE UNIQUE INDEX "campaign_recipients_batch_contact_key" ON "campaign_recipients" USING btree ("batch_id","contact_id");
CREATE INDEX "campaign_recipients_batch_status_idx" ON "campaign_recipients" USING btree ("batch_id","status");
CREATE INDEX "contact_views_org_idx" ON "contact_views" USING btree ("organization_id","owner_user_id");
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "contact_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_views, campaign_batches, campaign_recipients TO crm_app;
CREATE POLICY crm_app_all ON contact_views FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON campaign_batches FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON campaign_recipients FOR ALL TO crm_app USING (true) WITH CHECK (true);
REVOKE ALL ON contact_views, campaign_batches, campaign_recipients FROM anon, authenticated;

INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '232e46b9f3b8f8b1473e574f255526aeea1e44189cb2936373a5383ecccd37ab', 1790801861923 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '232e46b9f3b8f8b1473e574f255526aeea1e44189cb2936373a5383ecccd37ab');

-- ── 0015_estados_y_delegacion ──
CREATE TABLE "conversation_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"source_organization_id" uuid NOT NULL,
	"source_conversation_id" uuid NOT NULL,
	"target_organization_id" uuid,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"note" text,
	"scope" jsonb DEFAULT '{"history":false,"phone":false}'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"taken_by_organization_id" uuid,
	"taken_by_user_id" uuid,
	"taken_at" timestamp with time zone,
	"taken_conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "conversations" ADD COLUMN "status" text DEFAULT 'activa' NOT NULL;
ALTER TABLE "conversations" ADD COLUMN "status_changed_at" timestamp with time zone;
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_source_organization_id_organizations_id_fk" FOREIGN KEY ("source_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_target_organization_id_organizations_id_fk" FOREIGN KEY ("target_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_taken_by_organization_id_organizations_id_fk" FOREIGN KEY ("taken_by_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_taken_conversation_id_conversations_id_fk" FOREIGN KEY ("taken_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "conversation_delegations_network_status_idx" ON "conversation_delegations" USING btree ("network_id","status");
CREATE INDEX "conversation_delegations_source_idx" ON "conversation_delegations" USING btree ("source_organization_id","source_conversation_id");
CREATE UNIQUE INDEX "conversation_delegations_one_open_key" ON "conversation_delegations" USING btree ("source_conversation_id") WHERE "conversation_delegations"."status" = 'pendiente';
CREATE INDEX "conversation_events_conv_idx" ON "conversation_events" USING btree ("conversation_id","created_at");
CREATE INDEX "conversations_org_status_idx" ON "conversations" USING btree ("organization_id","status","last_message_at");
-- Las conversaciones que ya existían quedan como activas (el default de la columna lo hace).
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "conversation_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_delegations" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_events, conversation_delegations TO crm_app;
CREATE POLICY crm_app_all ON conversation_events FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON conversation_delegations FOR ALL TO crm_app USING (true) WITH CHECK (true);
REVOKE ALL ON conversation_events, conversation_delegations FROM anon, authenticated;

INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT 'e7ef760a176562e8f9eea7cdb63d5b441b2b837318948f30e498a8f97c4fc063', 1790802176455 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'e7ef760a176562e8f9eea7cdb63d5b441b2b837318948f30e498a8f97c4fc063');

-- ── 0016_calendario_por_organizacion ──
CREATE TABLE "calendar_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text DEFAULT 'calcom' NOT NULL,
	"api_key_enc" text NOT NULL,
	"webhook_secret_enc" text NOT NULL,
	"event_type_id" integer NOT NULL,
	"booking_url" text,
	"time_zone" text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"fallback_email" text,
	"status" text DEFAULT 'conectada' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "visit_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"booking_uid" text,
	"start_at" timestamp with time zone,
	"sync_status" text DEFAULT 'pendiente' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "calendar_integrations" ADD CONSTRAINT "calendar_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "visit_bookings" ADD CONSTRAINT "visit_bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "visit_bookings" ADD CONSTRAINT "visit_bookings_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "calendar_integrations_org_key" ON "calendar_integrations" USING btree ("organization_id");
CREATE UNIQUE INDEX "visit_bookings_visit_key" ON "visit_bookings" USING btree ("visit_id");
CREATE UNIQUE INDEX "visit_bookings_org_uid_key" ON "visit_bookings" USING btree ("organization_id","booking_uid") WHERE "visit_bookings"."booking_uid" is not null;
CREATE INDEX "visit_bookings_org_status_idx" ON "visit_bookings" USING btree ("organization_id","sync_status");
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "calendar_integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visit_bookings" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_integrations, visit_bookings TO crm_app;
CREATE POLICY crm_app_all ON calendar_integrations FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON visit_bookings FOR ALL TO crm_app USING (true) WITH CHECK (true);
REVOKE ALL ON calendar_integrations, visit_bookings FROM anon, authenticated;

INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT 'a9d46d64ded83f318e13613eaba53f8bc3362b41dd54ae3481d044d08f86a470', 1790802413545 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'a9d46d64ded83f318e13613eaba53f8bc3362b41dd54ae3481d044d08f86a470');

COMMIT;
