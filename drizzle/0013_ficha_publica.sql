CREATE TYPE "public"."publication_status" AS ENUM('borrador', 'publicada', 'pausada');--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "property_publications" ADD CONSTRAINT "property_publications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_publications" ADD CONSTRAINT "property_publications_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_publications_slug_key" ON "property_publications" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "property_publications_property_key" ON "property_publications" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_publications_org_idx" ON "property_publications" USING btree ("organization_id","status");--> statement-breakpoint
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "property_publications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON property_publications TO crm_app;--> statement-breakpoint
GRANT USAGE ON TYPE publication_status TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON property_publications FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON property_publications FROM anon, authenticated;
