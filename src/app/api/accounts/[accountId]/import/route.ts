import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { authorize, isUuid, jsonError } from "@/lib/api";

export async function POST(_req: Request, ctx: RouteContext<"/api/accounts/[accountId]/import">) {
  const auth = await authorize("admin", { name: "accounts", max: 10, windowMs: 60_000 });
  if ("response" in auth) return auth.response;

  const { accountId } = await ctx.params;
  if (!isUuid(accountId)) return jsonError(400, "Cuenta inválida");
  const db = getDb();
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, accountId), eq(channelAccounts.organizationId, auth.session.organizationId)));
  if (!account) return jsonError(404, "Cuenta inexistente");
  if (account.status !== "connected") return jsonError(409, "La cuenta está desconectada");

  after(async () => {
    const { importAccountHistory } = await import("@/lib/inbox/import");
    const r = await importAccountHistory(db, account).catch(() => null);
    console.log(`[import] ${account.channel}: ${r ? `${r.conversations} conversaciones, ${r.messages} mensajes` : "falló"}`);
  });
  return Response.json({ ok: true }, { status: 202 });
}
