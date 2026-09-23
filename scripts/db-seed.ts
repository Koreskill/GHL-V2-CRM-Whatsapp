import { config } from "dotenv";
config({ path: ".env.local" });

import { getDb, schema } from "../src/db";

// WhatsApp es el canal principal; Instagram y Messenger arrancan apagados.
const rows = [
  { scope: "global", enabled: true },
  { scope: "whatsapp", enabled: true },
  { scope: "instagram", enabled: false },
  { scope: "facebook", enabled: false },
];

async function main() {
  const db = getDb();
  const inserted = await db
    .insert(schema.agentConfigs)
    .values(rows)
    .onConflictDoNothing()
    .returning({ scope: schema.agentConfigs.scope });
  console.log(`agent_configs: ${inserted.length} filas nuevas`, inserted.map((r) => r.scope));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
