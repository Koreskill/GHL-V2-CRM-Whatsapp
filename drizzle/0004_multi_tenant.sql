-- Multi-tenancy Fase 1. Reescrita a mano sobre lo generado por drizzle-kit para que sea
-- segura en producción: la columna organization_id nace con DEFAULT = inmobiliaria por defecto,
-- así los datos existentes se backfillean solos y el código ya deployado (que aún no manda
-- organization_id) sigue insertando sin romper. El código nuevo la setea explícito.
-- El DEFAULT es un puente de transición; se quita en el endurecimiento (RLS por tenant).

-- ── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE "public"."member_role" AS ENUM('admin', 'agente');--> statement-breakpoint
CREATE TYPE "public"."network_member_status" AS ENUM('activa', 'invitada', 'suspendida');--> statement-breakpoint

-- ── Tablas de tenancy ────────────────────────────────────────────────────────
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'activa' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'activa' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "networks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "network_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "network_member_status" DEFAULT 'invitada' NOT NULL,
	"collaboration_terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'agente' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"acting_as_organization_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "network_members" ADD CONSTRAINT "network_members_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_members" ADD CONSTRAINT "network_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_acting_as_organization_id_organizations_id_fk" FOREIGN KEY ("acting_as_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "network_members_network_org_key" ON "network_members" USING btree ("network_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_user_org_key" ON "organization_members" USING btree ("user_id","organization_id");--> statement-breakpoint

-- ── Inmobiliaria por defecto: los datos actuales pasan a ser el tenant #1 ─────
INSERT INTO "organizations" ("id", "name", "slug")
VALUES ('00000000-0000-0000-0000-000000000001', 'Kore Inmobiliaria', 'kore')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- ── organization_id en las tablas existentes (DEFAULT = puente de transición) ─
ALTER TABLE "contacts" ADD COLUMN "organization_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';--> statement-breakpoint
ALTER TABLE "contact_identities" ADD COLUMN "organization_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "organization_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "organization_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "organization_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "organization_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';--> statement-breakpoint

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ── agent_configs: PK (scope) -> PK (organization_id, scope) ──────────────────
ALTER TABLE "agent_configs" DROP CONSTRAINT "agent_configs_pkey";--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_organization_id_scope_pk" PRIMARY KEY("organization_id","scope");--> statement-breakpoint

-- ── Unicidad de identidad ahora por tenant ───────────────────────────────────
ALTER TABLE "channel_accounts" DROP CONSTRAINT "channel_accounts_external_id_unique";--> statement-breakpoint
DROP INDEX "contact_identities_channel_external_id_key";--> statement-breakpoint
DROP INDEX "conversations_provider_external_id_key";--> statement-breakpoint
DROP INDEX "messages_external_id_key";--> statement-breakpoint
CREATE UNIQUE INDEX "channel_accounts_org_external_id_key" ON "channel_accounts" USING btree ("organization_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_org_channel_external_id_key" ON "contact_identities" USING btree ("organization_id","channel","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_org_provider_external_id_key" ON "conversations" USING btree ("organization_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "conversations_org_idx" ON "conversations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_external_id_key" ON "messages" USING btree ("organization_id","external_id") WHERE "messages"."external_id" is not null;--> statement-breakpoint

-- ── RLS + permisos para las tablas nuevas (mismo modelo que el CRM: solo crm_app) ─
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "networks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "network_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, networks, network_members, organization_members, audit_logs TO crm_app;--> statement-breakpoint
GRANT USAGE ON TYPE member_role, network_member_status TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON organizations FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON networks FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON network_members FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON organization_members FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON audit_logs FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON organizations, networks, network_members, organization_members, audit_logs FROM anon, authenticated;
