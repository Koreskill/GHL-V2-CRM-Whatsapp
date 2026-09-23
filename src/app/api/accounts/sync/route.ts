import { isNull } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { authorize, jsonError } from "@/lib/api";
import { syncChannelAccounts } from "@/lib/zernio/accounts";

export async function POST() {
  const auth = await authorize("admin");
  if ("response" in auth) return auth.response;

  const db = getDb();
  const res = await syncChannelAccounts(db);
  if (!res.success) return jsonError(502, "No se pudieron leer las cuentas de Zernio.");

  // Cuentas recién conectadas: su historial se importa en segundo plano, sin disparar el agente.
  const pending = await db.select().from(channelAccounts).where(isNull(channelAccounts.historyImportedAt));
  if (pending.length) {
    after(async () => {
      const { importAccountHistory } = await import("@/lib/inbox/import");
      for (const account of pending.filter((a) => a.status === "connected")) {
        const r = await importAccountHistory(db, account).catch(() => null);
        console.log(`[import] ${account.channel}: ${r ? `${r.conversations} conversaciones, ${r.messages} mensajes` : "falló"}`);
      }
    });
  }
  return Response.json({ synced: res.data.synced, importing: pending.length });
}
