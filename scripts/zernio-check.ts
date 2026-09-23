// Prueba contra la API real que las credenciales y los tipos están bien.
// Uso: npm run zernio:check
import { config } from "dotenv";
config({ path: ".env.local" });

import { listAccounts } from "../src/lib/zernio/accounts";
import { listConversationsPage } from "../src/lib/zernio/inbox";
import { listWebhooks } from "../src/lib/zernio/webhooks";

async function main() {
  const accounts = await listAccounts();
  if (!accounts.success) {
    console.error("Cuentas: ERROR", accounts.error);
    process.exit(1);
  }
  console.log(`\nCuentas (${accounts.data.length}):`);
  for (const a of accounts.data) {
    console.log(`  ${a.platform.padEnd(10)} ${a._id}  @${a.username ?? "-"}  ${a.isActive ? "activa" : "inactiva"}`);
  }

  const convs = await listConversationsPage({ limit: 10 });
  if (!convs.success) {
    console.error("\nConversaciones: ERROR", convs.error);
  } else {
    console.log(`\nConversaciones (primeras ${convs.data.data?.length ?? 0}, hasMore=${convs.data.pagination?.hasMore}):`);
    for (const c of convs.data.data ?? []) {
      console.log(`  ${String(c.platform).padEnd(10)} ${c.id}  ${c.participantName ?? "-"}  ${c.updatedTime ?? ""}`);
    }
  }

  const hooks = await listWebhooks();
  if (!hooks.success) {
    console.error("\nWebhooks: ERROR", hooks.error);
  } else {
    console.log(`\nWebhooks (${hooks.data.webhooks?.length ?? 0}):`);
    for (const w of hooks.data.webhooks ?? []) {
      console.log(`  ${w.name}  ${w.url}  activo=${w.isActive}  eventos=${w.events?.length ?? 0}`);
    }
  }
}

main();
