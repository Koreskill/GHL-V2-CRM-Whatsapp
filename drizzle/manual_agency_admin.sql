-- Plano de agencia: marca a un usuario como dueño del CRM.
-- Se aplica A MANO con el rol dueño (MCP de Supabase o postgres). No es una migración de drizzle:
-- toca auth.users, que crm_app no puede escribir, y depende de qué persona sea el dueño.
--
-- is_agency_admin habilita /agencia: ver a todos los clientes, sus conversaciones (solo lectura),
-- el estado del agente y el uso de IA, y crear clientes con su usuario administrador.
-- Cambiar el email por el del dueño real antes de correrlo.

UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"is_agency_admin": true}'::jsonb
WHERE email = 'nexkore.arg@gmail.com';

-- Para quitarle el permiso a alguien:
-- UPDATE auth.users
-- SET raw_app_meta_data = raw_app_meta_data - 'is_agency_admin'
-- WHERE email = 'persona@ejemplo.com';

-- Comprobar quién lo tiene:
-- SELECT email, raw_app_meta_data->>'is_agency_admin' AS agencia FROM auth.users ORDER BY email;
