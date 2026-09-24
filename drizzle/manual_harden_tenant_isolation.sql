-- ENDURECIMIENTO multi-tenant. Correr SOLO DESPUÉS de que el código nuevo (Fase 2) esté
-- deployado en producción. No forma parte del flujo normal de drizzle: se aplica a mano
-- (MCP de Supabase / rol dueño), porque quita los puentes de transición de la migración 0004.
--
-- Qué hace:
--   1. Elimina los índices únicos "globales" que existían antes del multi-tenant. Se habían
--      recreado a mano como puente para que el código VIEJO siguiera funcionando durante el
--      deploy. Ya con el código nuevo (que usa las claves por tenant), sobran y además impiden
--      que dos inmobiliarias compartan un mismo external_id.
--   2. Quita el DEFAULT de organization_id: a partir de acá, todo INSERT debe traer su
--      organización explícita (el código nuevo ya lo hace). Sin el default, un olvido falla
--      ruidosamente en vez de caer en silencio en la org por defecto.
--
-- NO incluye todavía el RLS por tenant (SET LOCAL app.current_org). Eso es un paso aparte,
-- posterior, una vez validado el filtrado a nivel app en producción.

DROP INDEX IF EXISTS "conversations_provider_external_id_key";
DROP INDEX IF EXISTS "messages_external_id_key";
DROP INDEX IF EXISTS "contact_identities_channel_external_id_key";
DROP INDEX IF EXISTS "channel_accounts_external_id_unique";

ALTER TABLE "contacts" ALTER COLUMN "organization_id" DROP DEFAULT;
ALTER TABLE "contact_identities" ALTER COLUMN "organization_id" DROP DEFAULT;
ALTER TABLE "channel_accounts" ALTER COLUMN "organization_id" DROP DEFAULT;
ALTER TABLE "conversations" ALTER COLUMN "organization_id" DROP DEFAULT;
ALTER TABLE "messages" ALTER COLUMN "organization_id" DROP DEFAULT;
ALTER TABLE "agent_configs" ALTER COLUMN "organization_id" DROP DEFAULT;
