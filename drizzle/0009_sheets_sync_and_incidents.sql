CREATE TYPE "public"."incident_severity" AS ENUM('info', 'advertencia', 'error');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('nuevo', 'en_revision', 'resuelto');--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"module" text NOT NULL,
	"severity" "incident_severity" DEFAULT 'error' NOT NULL,
	"status" "incident_status" DEFAULT 'nuevo' NOT NULL,
	"message" text NOT NULL,
	"detail" text,
	"fingerprint" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"retry_target" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_sync_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"sheet_gid" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"last_rows_seen" integer,
	"last_rows_upserted" integer,
	"last_rows_skipped" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "address_public" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "map_url" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "parking" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "area_covered_m2" numeric;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "amenities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "cover_url" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "gallery_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "tour_360_url" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "external_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "sync_issues" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_sync_configs" ADD CONSTRAINT "property_sync_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_fingerprint_key" ON "incidents" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "incidents_org_status_idx" ON "incidents" USING btree ("organization_id","status","last_seen_at");--> statement-breakpoint
CREATE INDEX "incidents_module_idx" ON "incidents" USING btree ("module","status");--> statement-breakpoint
CREATE UNIQUE INDEX "property_sync_configs_org_key" ON "property_sync_configs" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_org_external_id_key" ON "properties" USING btree ("organization_id","external_id") WHERE "properties"."external_id" is not null;--> statement-breakpoint
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "property_sync_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON property_sync_configs, incidents TO crm_app;--> statement-breakpoint
GRANT USAGE ON TYPE incident_status, incident_severity TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON property_sync_configs FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON incidents FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON property_sync_configs, incidents FROM anon, authenticated;
