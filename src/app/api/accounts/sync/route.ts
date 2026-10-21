import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { authorize, jsonError } from "@/lib/api";
import { enqueue } from "@/lib/jobs/queue";
import { syncChannelAccounts } from "@/lib/zernio/accounts";

export async function POST() {
  const auth = await authorize("admin", { name: "accounts", max: 10, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  const orgId = auth.session.organizationId;

  // Refresca el estado de las cuentas contra Zernio (solo actualiza las que ya tienen dueño; las
  // desconocidas quedan como incidente de agencia, nunca asignadas a quien apretó el botón).
  const db = getDb();
  const res = await syncChannelAccounts(db);
  if (!res.success) return jsonError(502, "No se pudieron leer las cuentas de Zernio.");

  // Historial de las cuentas recién conectadas DE ESTA inmobiliaria, por la cola (sin disparar el agente).
  const pending = await db
    .select({ id: channelAccounts.id })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.organizationId, orgId), eq(channelAccounts.status, "connected"), isNull(channelAccounts.historyImportedAt)));
  for (const a of pending) {
    await enqueue({ organizationId: orgId, kind: "account_import", dedupeKey: `account_import:${a.id}`, payload: { channelAccountId: a.id } });
  }

  const [{ n }] = await db.$count(channelAccounts, eq(channelAccounts.organizationId, orgId)).then((n) => [{ n }]);
  // El conteo de cuentas sin asignar es de toda la agencia: solo lo ve la agencia.
  return Response.json({ synced: n, importing: pending.length, ...(auth.session.isAgencyAdmin ? { unassigned: res.data.unassigned } : {}) });
}
