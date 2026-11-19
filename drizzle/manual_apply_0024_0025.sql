-- Aplica las migraciones 0024 y 0025 y las registra en drizzle.__drizzle_migrations.
-- Ejecutar con el rol DUEÑO (SQL Editor de Supabase). Es una sola transacción: si algo falla, no queda nada a medias.
-- Generado a partir de drizzle/0024_*.sql y drizzle/0025_*.sql; el hash es el sha256 de cada archivo.
BEGIN;

-- ── 0024_operacion_campanas_seguimientos ──
CREATE TABLE "agent_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "agent_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"kind" text NOT NULL,
	"customer_text" text,
	"bot_text" text,
	"corrected_text" text,
	"note" text,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "contact_group_members" (
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_group_members_group_id_contact_id_pk" PRIMARY KEY("group_id","contact_id")
);

CREATE TABLE "contact_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "contact_label_links" (
	"organization_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_label_links_label_id_contact_id_pk" PRIMARY KEY("label_id","contact_id")
);

CREATE TABLE "contact_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "followup_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'activa' NOT NULL,
	"next_position" integer DEFAULT 1 NOT NULL,
	"anchor_at" timestamp with time zone NOT NULL,
	"next_run_at" timestamp with time zone,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"stop_reason" text,
	"last_message_id" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "followup_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"channel_account_id" uuid,
	"trigger" text DEFAULT 'sin_respuesta' NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timezone" text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"allowed_start_hour" integer DEFAULT 8 NOT NULL,
	"allowed_end_hour" integer DEFAULT 22 NOT NULL,
	"max_per_day" integer DEFAULT 5 NOT NULL,
	"min_gap_minutes" integer DEFAULT 60 NOT NULL,
	"window_margin_minutes" integer DEFAULT 15 NOT NULL,
	"stop_on_handoff" boolean DEFAULT true NOT NULL,
	"stop_on_deal_closed" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "followup_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"delay_minutes" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "campaign_batches" ADD COLUMN "channel_account_id" uuid;
ALTER TABLE "campaign_batches" ADD COLUMN "audience" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "campaign_batches" ADD COLUMN "scheduled_at" timestamp with time zone;
ALTER TABLE "campaign_batches" ADD COLUMN "started_at" timestamp with time zone;
ALTER TABLE "campaign_batches" ADD COLUMN "paused_at" timestamp with time zone;
ALTER TABLE "campaign_batches" ADD COLUMN "completed_at" timestamp with time zone;
ALTER TABLE "campaign_recipients" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "campaign_recipients" ADD COLUMN "next_attempt_at" timestamp with time zone;
ALTER TABLE "contacts" ADD COLUMN "marketing_opt_out_at" timestamp with time zone;
ALTER TABLE "contacts" ADD COLUMN "marketing_opt_out_source" text;
ALTER TABLE "contacts" ADD COLUMN "anonymized_at" timestamp with time zone;
ALTER TABLE "organizations" ADD COLUMN "status_changed_at" timestamp with time zone;
ALTER TABLE "organizations" ADD COLUMN "status_reason" text;
ALTER TABLE "agent_config_versions" ADD CONSTRAINT "agent_config_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "contact_group_members" ADD CONSTRAINT "contact_group_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "contact_group_members" ADD CONSTRAINT "contact_group_members_group_id_contact_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."contact_groups"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "contact_group_members" ADD CONSTRAINT "contact_group_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "contact_groups" ADD CONSTRAINT "contact_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "contact_label_links" ADD CONSTRAINT "contact_label_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "contact_label_links" ADD CONSTRAINT "contact_label_links_label_id_contact_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."contact_labels"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "contact_label_links" ADD CONSTRAINT "contact_label_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "contact_labels" ADD CONSTRAINT "contact_labels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "followup_enrollments" ADD CONSTRAINT "followup_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "followup_enrollments" ADD CONSTRAINT "followup_enrollments_sequence_id_followup_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."followup_sequences"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "followup_enrollments" ADD CONSTRAINT "followup_enrollments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "followup_enrollments" ADD CONSTRAINT "followup_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "followup_enrollments" ADD CONSTRAINT "followup_enrollments_last_message_id_messages_id_fk" FOREIGN KEY ("last_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "followup_sequences" ADD CONSTRAINT "followup_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "followup_sequences" ADD CONSTRAINT "followup_sequences_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "followup_steps" ADD CONSTRAINT "followup_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "followup_steps" ADD CONSTRAINT "followup_steps_sequence_id_followup_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."followup_sequences"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "agent_config_versions_key" ON "agent_config_versions" USING btree ("organization_id","scope","version");
CREATE INDEX "agent_feedback_org_idx" ON "agent_feedback" USING btree ("organization_id","kind","status");
CREATE INDEX "contact_group_members_contact_idx" ON "contact_group_members" USING btree ("contact_id");
CREATE UNIQUE INDEX "contact_groups_org_name_key" ON "contact_groups" USING btree ("organization_id","name");
CREATE INDEX "contact_label_links_contact_idx" ON "contact_label_links" USING btree ("contact_id");
CREATE UNIQUE INDEX "contact_labels_org_name_key" ON "contact_labels" USING btree ("organization_id","name");
CREATE UNIQUE INDEX "followup_enrollments_active_key" ON "followup_enrollments" USING btree ("sequence_id","conversation_id") WHERE "followup_enrollments"."status" = 'activa';
CREATE INDEX "followup_enrollments_due_idx" ON "followup_enrollments" USING btree ("status","next_run_at");
CREATE INDEX "followup_enrollments_conversation_idx" ON "followup_enrollments" USING btree ("conversation_id","status");
CREATE INDEX "followup_sequences_org_idx" ON "followup_sequences" USING btree ("organization_id","enabled");
CREATE UNIQUE INDEX "followup_steps_sequence_position_key" ON "followup_steps" USING btree ("sequence_id","position");
CREATE UNIQUE INDEX "jobs_dedupe_key" ON "jobs" USING btree ("dedupe_key");
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_after");
CREATE INDEX "jobs_org_kind_idx" ON "jobs" USING btree ("organization_id","kind","status");
ALTER TABLE "campaign_batches" ADD CONSTRAINT "campaign_batches_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE set null ON UPDATE no action;
-- Envíos automáticos (campañas, seguimientos) con clave de idempotencia estable: se busca la fila previa antes de insertar otra.
CREATE INDEX "messages_idempotency_key_idx" ON "messages" (("raw_payload"->>'idempotencyKey')) WHERE "raw_payload" ? 'idempotencyKey';
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_label_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_group_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "followup_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "followup_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "followup_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_config_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_feedback" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs, contact_labels, contact_label_links, contact_groups, contact_group_members, followup_sequences, followup_steps, followup_enrollments, agent_config_versions, agent_feedback TO crm_app;
CREATE POLICY crm_app_all ON jobs FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON contact_labels FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON contact_label_links FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON contact_groups FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON contact_group_members FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON followup_sequences FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON followup_steps FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON followup_enrollments FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON agent_config_versions FOR ALL TO crm_app USING (true) WITH CHECK (true);
CREATE POLICY crm_app_all ON agent_feedback FOR ALL TO crm_app USING (true) WITH CHECK (true);
REVOKE ALL ON jobs, contact_labels, contact_label_links, contact_groups, contact_group_members, followup_sequences, followup_steps, followup_enrollments, agent_config_versions, agent_feedback FROM anon, authenticated;

INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '04392da08ac18c6ba8da240628c836fc383c2777eb3eb98230843f76efe2423c', 1792504893771 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '04392da08ac18c6ba8da240628c836fc383c2777eb3eb98230843f76efe2423c');

-- ── 0025_primeras_respuestas ──
ALTER TABLE "agent_configs" ADD COLUMN "first_replies" jsonb;
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '80851d8bb468293d0eabb56b876c7905bac87a975456f607206f0f2ff034ce78', 1792617215180 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '80851d8bb468293d0eabb56b876c7905bac87a975456f607206f0f2ff034ce78');

COMMIT;
