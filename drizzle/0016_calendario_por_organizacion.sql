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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "calendar_integrations" ADD CONSTRAINT "calendar_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_bookings" ADD CONSTRAINT "visit_bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_bookings" ADD CONSTRAINT "visit_bookings_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_integrations_org_key" ON "calendar_integrations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_bookings_visit_key" ON "visit_bookings" USING btree ("visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_bookings_org_uid_key" ON "visit_bookings" USING btree ("organization_id","booking_uid") WHERE "visit_bookings"."booking_uid" is not null;--> statement-breakpoint
CREATE INDEX "visit_bookings_org_status_idx" ON "visit_bookings" USING btree ("organization_id","sync_status");--> statement-breakpoint
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "calendar_integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visit_bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_integrations, visit_bookings TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON calendar_integrations FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON visit_bookings FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON calendar_integrations, visit_bookings FROM anon, authenticated;
