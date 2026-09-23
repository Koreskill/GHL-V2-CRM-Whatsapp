import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { getDb } from "../src/db";

const tables = [
  "contacts",
  "contact_identities",
  "channel_accounts",
  "conversations",
  "messages",
  "agent_configs",
  "webhook_events",
];

async function main() {
  const db = getDb();
  for (const table of tables) {
    const [row] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from ${sql.identifier(table)}`,
    );
    console.log(`${table.padEnd(20)} ${row.count}`);
  }
  const configs = await db.execute(sql`select scope, enabled from agent_configs order by scope`);
  console.log("\nagent_configs:", configs);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
