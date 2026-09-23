-- Rol de la app. La contraseña NO va acá: se setea aparte con
-- ALTER ROLE crm_app PASSWORD '...' y se usa en DATABASE_URL (usuario crm_app.<project_ref>).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO crm_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts, contact_identities, channel_accounts, conversations, messages, agent_configs, webhook_events TO crm_app;--> statement-breakpoint
GRANT USAGE ON TYPE channel, provider, message_direction, message_status TO crm_app;--> statement-breakpoint
CREATE POLICY crm_app_all ON contacts FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON contact_identities FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON channel_accounts FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON conversations FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON messages FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON agent_configs FOR ALL TO crm_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY crm_app_all ON webhook_events FOR ALL TO crm_app USING (true) WITH CHECK (true);
