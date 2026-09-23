// Sincroniza cuentas e importa el historial que Zernio ya replicó. No dispara el agente.
// Uso: npm run zernio:import
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { channelAccounts } from "../src/db/schema";
import { importAccountHistory } from "../src/lib/inbox/import";
import { syncChannelAccounts } from "../src/lib/zernio/accounts";

async function main() {
  const db = getDb();
  const sync = await syncChannelAccounts(db);
  if (!sync.success) throw new Error(sync.error.message);

  const accounts = await db.select().from(channelAccounts).where(eq(channelAccounts.status, "connected"));
  for (const account of accounts) {
    const r = await importAccountHistory(db, account);
    console.log(`${account.channel} ${account.handle}: ${r.conversations} conversaciones, ${r.messages} mensajes nuevos${r.errors.length ? `, errores: ${r.errors.join(" | ")}` : ""}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
