CREATE TYPE "public"."triage_status" AS ENUM('enviado', 'borrador', 'derivado', 'descartado', 'error');--> statement-breakpoint
CREATE TABLE "message_triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"intent" text,
	"intent_confidence" numeric,
	"intent_probabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contains_visit_request" numeric,
	"requires_human" numeric,
	"urgency" text,
	"decision_model" text,
	"decision_id" text,
	"route" text,
	"route_reason" text,
	"reply_model" text,
	"draft_text" text,
	"internal_summary" text,
	"missing_information" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_crm_updates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"handoff_reason" text,
	"status" "triage_status" NOT NULL,
	"sent_message_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "auto_reply" text;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "min_confidence" numeric;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "human_threshold" numeric;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "decision_model" text;--> statement-breakpoint
ALTER TABLE "message_triage" ADD CONSTRAINT "message_triage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_triage" ADD CONSTRAINT "message_triage_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_triage" ADD CONSTRAINT "message_triage_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_triage" ADD CONSTRAINT "message_triage_sent_message_id_messages_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_triage_message_key" ON "message_triage" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_triage_org_status_idx" ON "message_triage" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "message_triage_conversation_idx" ON "message_triage" USING btree ("conversation_id");--> statement-breakpoint
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "message_triage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_triage TO crm_app;--> statement-breakpoint
GRANT USAGE ON TYPE triage_status TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON message_triage FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON message_triage FROM anon, authenticated;
