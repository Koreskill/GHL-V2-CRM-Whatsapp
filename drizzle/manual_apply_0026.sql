-- Aplica la migración 0026 (medios entrantes y espera antes de responder) y la registra en drizzle.__drizzle_migrations.
-- Ejecutar con el rol DUEÑO (SQL Editor de Supabase). Una sola transacción: si algo falla, no queda nada a medias.
-- Aplicar ANTES de desplegar: sin ella falla toda lectura de la configuración del agente y la lista de mensajes.
-- Seguro de repetir: los valores del enum usan IF NOT EXISTS; la tabla y la columna NO (si ya existen, falla y no cambia nada).
BEGIN;

ALTER TYPE "public"."ai_function" ADD VALUE IF NOT EXISTS 'transcripcion';
ALTER TYPE "public"."ai_function" ADD VALUE IF NOT EXISTS 'vision';
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

ALTER TABLE "agent_configs" ADD COLUMN "reply_delay_seconds" integer;
ALTER TABLE "message_derivations" ADD CONSTRAINT "message_derivations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "message_derivations" ADD CONSTRAINT "message_derivations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "message_derivations_message_key" ON "message_derivations" USING btree ("message_id");
ALTER TABLE "message_derivations" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON message_derivations TO crm_app;
CREATE POLICY crm_app_all ON message_derivations FOR ALL TO crm_app USING (true) WITH CHECK (true);
REVOKE ALL ON message_derivations FROM anon, authenticated;

INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '8d7a1d56e729b3322ec24884a846b3c35fe88c6e857bb760f4b5ab76a3dee652', 1794826069259 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '8d7a1d56e729b3322ec24884a846b3c35fe88c6e857bb760f4b5ab76a3dee652');

COMMIT;
