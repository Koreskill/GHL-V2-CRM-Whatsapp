CREATE TYPE "public"."lead_temperature" AS ENUM('frio', 'tibio', 'caliente');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('contado', 'credito');--> statement-breakpoint
CREATE TYPE "public"."prospect_urgency" AS ENUM('explorando', 'meses', 'ya');--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "temperature" "lead_temperature";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "temperature_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_properties" ADD COLUMN "interest" "lead_temperature";--> statement-breakpoint
ALTER TABLE "deal_properties" ADD COLUMN "last_interest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_triage" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "sync_status" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "manually_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospect_requirements" ADD COLUMN "urgency" "prospect_urgency";--> statement-breakpoint
ALTER TABLE "prospect_requirements" ADD COLUMN "payment_method" "payment_method";--> statement-breakpoint
ALTER TABLE "prospect_requirements" ADD COLUMN "credit_type" text;--> statement-breakpoint
-- Tipos nuevos: crm_app tiene que poder usarlos. No hay tablas nuevas, así que los GRANT y
-- políticas de las tablas afectadas ya existen de migraciones anteriores.
GRANT USAGE ON TYPE lead_temperature, prospect_urgency, payment_method TO crm_app;
