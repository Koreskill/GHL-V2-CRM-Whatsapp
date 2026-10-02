-- Aplica la migración 0017 y la registra en drizzle.__drizzle_migrations.
-- Ejecutar con el rol DUEÑO (SQL Editor de Supabase). Una sola transacción.
BEGIN;

CREATE TABLE "lead_property_score_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"previous_score" integer,
	"new_score" integer NOT NULL,
	"changed_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggering_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "lead_property_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"property_id" uuid,
	"network_listing_id" uuid,
	"score" integer NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"matched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicting" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hard_conflicts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_property_scores_one_target" CHECK (("lead_property_scores"."property_id" is not null and "lead_property_scores"."network_listing_id" is null and "lead_property_scores"."kind" = 'cartera')
        or ("lead_property_scores"."network_listing_id" is not null and "lead_property_scores"."property_id" is null and "lead_property_scores"."kind" = 'red'))
);

CREATE TABLE "news_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"network_id" uuid,
	"organization_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"event_type" text DEFAULT 'custom' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"meeting_url" text,
	"property_id" uuid,
	"assigned_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reminder_at" timestamp with time zone,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"recurrence_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_events_scope_target" CHECK (("news_events"."scope" = 'network' and "news_events"."network_id" is not null and "news_events"."organization_id" is null)
        or ("news_events"."scope" = 'client' and "news_events"."organization_id" is not null and "news_events"."network_id" is null)
        or ("news_events"."scope" = 'internal' and "news_events"."network_id" is null and "news_events"."organization_id" is null))
);

ALTER TABLE "prospect_requirements" ADD COLUMN "criteria" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "lead_property_score_history" ADD CONSTRAINT "lead_property_score_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lead_property_score_history" ADD CONSTRAINT "lead_property_score_history_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lead_property_scores" ADD CONSTRAINT "lead_property_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lead_property_scores" ADD CONSTRAINT "lead_property_scores_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lead_property_scores" ADD CONSTRAINT "lead_property_scores_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lead_property_scores" ADD CONSTRAINT "lead_property_scores_network_listing_id_network_property_listings_id_fk" FOREIGN KEY ("network_listing_id") REFERENCES "public"."network_property_listings"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "lead_property_score_history_conv_idx" ON "lead_property_score_history" USING btree ("conversation_id","created_at");
CREATE UNIQUE INDEX "lead_property_scores_conv_property_key" ON "lead_property_scores" USING btree ("conversation_id","property_id") WHERE "lead_property_scores"."property_id" is not null;
CREATE UNIQUE INDEX "lead_property_scores_conv_listing_key" ON "lead_property_scores" USING btree ("conversation_id","network_listing_id") WHERE "lead_property_scores"."network_listing_id" is not null;
CREATE INDEX "lead_property_scores_conv_score_idx" ON "lead_property_scores" USING btree ("conversation_id","kind","score");
CREATE INDEX "news_events_scope_start_idx" ON "news_events" USING btree ("scope","start_at");
CREATE INDEX "news_events_org_start_idx" ON "news_events" USING btree ("organization_id","start_at");
CREATE INDEX "news_events_network_start_idx" ON "news_events" USING btree ("network_id","start_at");
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "news_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_property_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_property_score_history" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON news_events, lead_property_scores, lead_property_score_history TO crm_app;
CREATE POLICY crm_app_all ON news_events FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON lead_property_scores FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON lead_property_score_history FOR ALL TO crm_app USING (true) WITH CHECK (true);
REVOKE ALL ON news_events, lead_property_scores, lead_property_score_history FROM anon, authenticated;


INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '89cf773d1f9128f40314afe7c40ffe7c49d130a7abe8bd70d085076437a97015', 1790950962333 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '89cf773d1f9128f40314afe7c40ffe7c49d130a7abe8bd70d085076437a97015');

COMMIT;
