import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { isCronAuthorized } from "@/lib/cron-auth";
import { importAccountHistory } from "@/lib/inbox/import";
import { syncChannelAccounts } from "@/lib/zernio/accounts";

export const dynamic = "force-dynamic";

// Barrido de recuperación: re-sincroniza cuentas y trae lo reciente que no llegó por webhook
// (Meta termina de replicar historial después de conectar). No dispara el agente.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return Response.json({ error: "No autorizado" }, { status: 401 });

  const db = getDb();
  const sync = await syncChannelAccounts(db);
  const accounts = await db.select().from(channelAccounts).where(eq(channelAccounts.status, "connected"));

  const summary: Record<string, { conversations: number; messages: number; errors: number }> = {};
  for (const account of accounts) {
    const r = await importAccountHistory(db, account, { maxConversations: 50, maxMessagesPerConversation: 50 });
    summary[`${account.channel}:${account.handle ?? account.externalId}`] = {
      conversations: r.conversations,
      messages: r.messages,
      errors: r.errors.length,
    };
  }
  return Response.json({ accountsSynced: sync.success ? sync.data.synced : 0, accounts: summary });
}
