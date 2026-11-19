ALTER TYPE "public"."ai_function" ADD VALUE 'transcripcion';--> statement-breakpoint
ALTER TYPE "public"."ai_function" ADD VALUE 'vision';--> statement-breakpoint
CREATE TABLE "message_derivations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"text" text,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "reply_delay_seconds" integer;--> statement-breakpoint
ALTER TABLE "message_derivations" ADD CONSTRAINT "message_derivations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_derivations" ADD CONSTRAINT "message_derivations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_derivations_message_key" ON "message_derivations" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "message_derivations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON message_derivations TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON message_derivations FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON message_derivations FROM anon, authenticated;
