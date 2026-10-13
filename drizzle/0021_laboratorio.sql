CREATE TABLE "lab_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"scenario_key" text NOT NULL,
	"turn_idx" integer,
	"severity" text NOT NULL,
	"rule" text NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scenario_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"scenario_key" text NOT NULL,
	"idx" integer NOT NULL,
	"client_text" text NOT NULL,
	"disposition" text,
	"route" text,
	"intent" text,
	"source" text,
	"reply_text" text,
	"shown_property_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"simulated_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_findings" ADD CONSTRAINT "lab_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_findings" ADD CONSTRAINT "lab_findings_run_id_lab_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."lab_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_runs" ADD CONSTRAINT "lab_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_turns" ADD CONSTRAINT "lab_turns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_turns" ADD CONSTRAINT "lab_turns_run_id_lab_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."lab_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_findings_run_idx" ON "lab_findings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "lab_runs_org_created_idx" ON "lab_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "lab_turns_run_idx" ON "lab_turns" USING btree ("run_id","scenario_key","idx");--> statement-breakpoint
ALTER TABLE "lab_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lab_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lab_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON lab_runs, lab_turns, lab_findings TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON lab_runs FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON lab_turns FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON lab_findings FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON lab_runs, lab_turns, lab_findings FROM anon, authenticated;
