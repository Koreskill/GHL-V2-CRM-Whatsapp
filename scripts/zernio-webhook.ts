// Registra o actualiza (por nombre) el webhook de Zernio con el secreto y los eventos del CRM.
// Uso: npm run zernio:webhook -- https://korecrm.estudiantehibrido.com/webhooks/zernio/ [Nombre]
import { config } from "dotenv";
config({ path: ".env.local" });

import { upsertWebhook } from "../src/lib/zernio/webhooks";

async function main() {
  const [url, name = "Koreskill"] = process.argv.slice(2);
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!url || !secret) {
    console.error("Falta la URL o ZERNIO_WEBHOOK_SECRET");
    process.exit(1);
  }
  const res = await upsertWebhook({ name, url, secret });
  if (!res.success) {
    console.error("ERROR", res.error);
    process.exit(1);
  }
  console.log(`Webhook ${res.data.action}: ${res.data.webhook?.name} -> ${res.data.webhook?.url}`);
  console.log(`Eventos: ${res.data.webhook?.events?.join(", ")}`);
}

main();
