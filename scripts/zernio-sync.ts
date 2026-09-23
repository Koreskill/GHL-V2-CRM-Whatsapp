// Copia a channel_accounts las cuentas de WhatsApp/Instagram/Facebook conectadas en Zernio.
// Uso: npm run zernio:sync
import { config } from "dotenv";
config({ path: ".env.local" });

import { getDb } from "../src/db";
import { channelAccounts } from "../src/db/schema";
import { syncChannelAccounts } from "../src/lib/zernio/accounts";

async function main() {
  const db = getDb();
  const res = await syncChannelAccounts(db);
  if (!res.success) {
    console.error("ERROR", res.error);
    process.exit(1);
  }
  const rows = await db.select().from(channelAccounts);
  console.log(`Sincronizadas: ${res.data.synced}`);
  for (const r of rows) console.log(`  ${r.channel.padEnd(10)} ${r.externalId}  ${r.handle ?? "-"}  ${r.status}`);
  process.exit(0);
}

main();
