-- OPCIONAL. Aplicar con el rol dueño. Permite que /api/health compare las migraciones aplicadas con las
-- que espera el código (journal) y responda 503 si falta alguna. Sin esto el health responde
-- migrations.status = "desconocido" y NO falla: solo pierde ese control.
-- Solo lectura sobre la tabla de registro de migraciones; no da acceso a ningún dato del CRM.
GRANT USAGE ON SCHEMA drizzle TO crm_app;
GRANT SELECT ON drizzle.__drizzle_migrations TO crm_app;
