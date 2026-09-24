CREATE TYPE "public"."ai_call_status" AS ENUM('ok', 'error', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."ai_function" AS ENUM('conversacional', 'extraccion', 'calificacion', 'fallback');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('publicada', 'pausada', 'retirada');--> statement-breakpoint
CREATE TYPE "public"."operation_type" AS ENUM('venta', 'alquiler', 'temporario');--> statement-breakpoint
CREATE TYPE "public"."property_status" AS ENUM('borrador', 'disponible', 'reservada', 'vendida', 'alquilada', 'pausada');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('departamento', 'casa', 'ph', 'terreno', 'local', 'oficina', 'cochera', 'otro');--> statement-breakpoint
CREATE TABLE "ai_model_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"function" "ai_function" NOT NULL,
	"provider" text DEFAULT 'openrouter' NOT NULL,
	"model" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"function" "ai_function" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"status" "ai_call_status" NOT NULL,
	"error" text,
	"request_ref" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_property_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"owner_organization_id" uuid NOT NULL,
	"operation" "operation_type" NOT NULL,
	"property_type" "property_type" NOT NULL,
	"price" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"zone" text,
	"city" text,
	"lat" numeric,
	"lng" numeric,
	"bedrooms" integer,
	"bathrooms" integer,
	"area_m2" numeric,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commercial_description" text,
	"availability" text DEFAULT 'disponible' NOT NULL,
	"presentation_link" text,
	"collaboration_terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "listing_status" DEFAULT 'publicada' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_contact_id" uuid,
	"operation" "operation_type" NOT NULL,
	"property_type" "property_type" NOT NULL,
	"status" "property_status" DEFAULT 'borrador' NOT NULL,
	"title" text,
	"description" text,
	"price" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"address_full" text,
	"zone" text,
	"city" text,
	"lat" numeric,
	"lng" numeric,
	"bedrooms" integer,
	"bathrooms" integer,
	"area_m2" numeric,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal_notes" text,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_model_configs" ADD CONSTRAINT "ai_model_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_property_listings" ADD CONSTRAINT "network_property_listings_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_property_listings" ADD CONSTRAINT "network_property_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_property_listings" ADD CONSTRAINT "network_property_listings_owner_organization_id_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_contact_id_contacts_id_fk" FOREIGN KEY ("owner_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_configs_org_function_priority_key" ON "ai_model_configs" USING btree ("organization_id","function","priority");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_org_created_idx" ON "ai_usage_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "network_property_listings_network_property_key" ON "network_property_listings" USING btree ("network_id","property_id");--> statement-breakpoint
CREATE INDEX "network_property_listings_network_idx" ON "network_property_listings" USING btree ("network_id","status");--> statement-breakpoint
CREATE INDEX "network_property_listings_owner_org_idx" ON "network_property_listings" USING btree ("owner_organization_id");--> statement-breakpoint
CREATE INDEX "properties_org_status_idx" ON "properties" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "properties_org_operation_type_idx" ON "properties" USING btree ("organization_id","operation","property_type");--> statement-breakpoint
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "network_property_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_model_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON properties, network_property_listings, ai_model_configs, ai_usage_logs TO crm_app;--> statement-breakpoint
GRANT USAGE ON TYPE operation_type, property_type, property_status, listing_status, ai_function, ai_call_status TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON properties FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON network_property_listings FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON ai_model_configs FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON ai_usage_logs FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON properties, network_property_listings, ai_model_configs, ai_usage_logs FROM anon, authenticated;
