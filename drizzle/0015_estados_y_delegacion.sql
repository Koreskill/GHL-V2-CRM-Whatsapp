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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "status" text DEFAULT 'activa' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_source_organization_id_organizations_id_fk" FOREIGN KEY ("source_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_target_organization_id_organizations_id_fk" FOREIGN KEY ("target_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_taken_by_organization_id_organizations_id_fk" FOREIGN KEY ("taken_by_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_delegations" ADD CONSTRAINT "conversation_delegations_taken_conversation_id_conversations_id_fk" FOREIGN KEY ("taken_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_delegations_network_status_idx" ON "conversation_delegations" USING btree ("network_id","status");--> statement-breakpoint
CREATE INDEX "conversation_delegations_source_idx" ON "conversation_delegations" USING btree ("source_organization_id","source_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_delegations_one_open_key" ON "conversation_delegations" USING btree ("source_conversation_id") WHERE "conversation_delegations"."status" = 'pendiente';--> statement-breakpoint
CREATE INDEX "conversation_events_conv_idx" ON "conversation_events" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_org_status_idx" ON "conversations" USING btree ("organization_id","status","last_message_at");--> statement-breakpoint
-- Las conversaciones que ya existían quedan como activas (el default de la columna lo hace).
-- Toda tabla nueva: RLS + GRANT y política SOLO para crm_app. anon y authenticated no tocan nada.
ALTER TABLE "conversation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_delegations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_events, conversation_delegations TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON conversation_events FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON conversation_delegations FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON conversation_events, conversation_delegations FROM anon, authenticated;
