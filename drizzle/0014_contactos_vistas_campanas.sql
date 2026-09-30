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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "campaign_batches" ADD CONSTRAINT "campaign_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_views" ADD CONSTRAINT "contact_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_batches_org_idx" ON "campaign_batches" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_batch_contact_key" ON "campaign_recipients" USING btree ("batch_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_batch_status_idx" ON "campaign_recipients" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "contact_views_org_idx" ON "contact_views" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "contact_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_views, campaign_batches, campaign_recipients TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON contact_views FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON campaign_batches FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON campaign_recipients FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON contact_views, campaign_batches, campaign_recipients FROM anon, authenticated;
