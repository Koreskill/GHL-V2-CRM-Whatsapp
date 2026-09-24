CREATE TYPE "public"."match_status" AS ENUM('sugerida', 'presentada', 'descartada');--> statement-breakpoint
CREATE TYPE "public"."presentation_status" AS ENUM('presentada', 'visita_solicitada', 'visita_agendada', 'negociando', 'cerrada_ganada', 'cerrada_perdida', 'cancelada');--> statement-breakpoint
CREATE TABLE "property_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"prospect_requirement_id" uuid NOT NULL,
	"network_property_listing_id" uuid NOT NULL,
	"score" numeric NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "match_status" DEFAULT 'sugerida' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_presentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"network_property_listing_id" uuid NOT NULL,
	"owner_organization_id" uuid NOT NULL,
	"presenting_organization_id" uuid NOT NULL,
	"prospect_contact_id" uuid NOT NULL,
	"prospect_requirement_id" uuid,
	"match_id" uuid,
	"status" "presentation_status" DEFAULT 'presentada' NOT NULL,
	"presented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"visit_requested_at" timestamp with time zone,
	"owner_notified_at" timestamp with time zone,
	"commission_terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"operation" "operation_type",
	"property_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bedrooms_min" integer,
	"bathrooms_min" integer,
	"price_min" numeric(14, 2),
	"price_max" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"area_min" numeric,
	"must_have" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nice_to_have" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_extraction" jsonb,
	"confidence" numeric,
	"status" text DEFAULT 'activo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "property_matches" ADD CONSTRAINT "property_matches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_matches" ADD CONSTRAINT "property_matches_prospect_requirement_id_prospect_requirements_id_fk" FOREIGN KEY ("prospect_requirement_id") REFERENCES "public"."prospect_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_matches" ADD CONSTRAINT "property_matches_network_property_listing_id_network_property_listings_id_fk" FOREIGN KEY ("network_property_listing_id") REFERENCES "public"."network_property_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_presentations" ADD CONSTRAINT "property_presentations_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_presentations" ADD CONSTRAINT "property_presentations_network_property_listing_id_network_property_listings_id_fk" FOREIGN KEY ("network_property_listing_id") REFERENCES "public"."network_property_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_presentations" ADD CONSTRAINT "property_presentations_owner_organization_id_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_presentations" ADD CONSTRAINT "property_presentations_presenting_organization_id_organizations_id_fk" FOREIGN KEY ("presenting_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_presentations" ADD CONSTRAINT "property_presentations_prospect_contact_id_contacts_id_fk" FOREIGN KEY ("prospect_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_presentations" ADD CONSTRAINT "property_presentations_prospect_requirement_id_prospect_requirements_id_fk" FOREIGN KEY ("prospect_requirement_id") REFERENCES "public"."prospect_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_presentations" ADD CONSTRAINT "property_presentations_match_id_property_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."property_matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_requirements" ADD CONSTRAINT "prospect_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_requirements" ADD CONSTRAINT "prospect_requirements_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_requirements" ADD CONSTRAINT "prospect_requirements_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_matches_req_listing_key" ON "property_matches" USING btree ("prospect_requirement_id","network_property_listing_id");--> statement-breakpoint
CREATE INDEX "property_matches_org_idx" ON "property_matches" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "property_presentations_owner_idx" ON "property_presentations" USING btree ("owner_organization_id");--> statement-breakpoint
CREATE INDEX "property_presentations_presenting_idx" ON "property_presentations" USING btree ("presenting_organization_id");--> statement-breakpoint
CREATE INDEX "property_presentations_listing_idx" ON "property_presentations" USING btree ("network_property_listing_id");--> statement-breakpoint
CREATE INDEX "prospect_requirements_org_idx" ON "prospect_requirements" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "prospect_requirements_contact_idx" ON "prospect_requirements" USING btree ("contact_id");--> statement-breakpoint
ALTER TABLE "prospect_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "property_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "property_presentations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON prospect_requirements, property_matches, property_presentations TO crm_app;--> statement-breakpoint
GRANT USAGE ON TYPE match_status, presentation_status TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON prospect_requirements FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON property_matches FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON property_presentations FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON prospect_requirements, property_matches, property_presentations FROM anon, authenticated;
