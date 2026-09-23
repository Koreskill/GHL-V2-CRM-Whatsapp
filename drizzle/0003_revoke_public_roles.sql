-- Defensa en profundidad: además de RLS, los roles públicos de Supabase (anon = cualquiera con la
-- clave publicable, authenticated = cualquier usuario registrado) no tienen permisos sobre el CRM.
-- La app entra con crm_app, que conserva los suyos.
REVOKE ALL ON contacts, contact_identities, channel_accounts, conversations, messages, agent_configs, webhook_events FROM anon, authenticated;--> statement-breakpoint
-- Tablas del bot anterior: cualquier usuario registrado podía leerlas por la API de Supabase.
DROP POLICY IF EXISTS "Authenticated users can read messages" ON legacy_messages;--> statement-breakpoint
DROP POLICY IF EXISTS "Authenticated users can read conversations" ON legacy_conversations;--> statement-breakpoint
REVOKE ALL ON legacy_messages, legacy_conversations FROM anon, authenticated;--> statement-breakpoint
-- Función del bot anterior con search_path mutable (aviso del linter de Supabase).
ALTER FUNCTION public.touch_conversation_updated_at() SET search_path = public, pg_temp;
