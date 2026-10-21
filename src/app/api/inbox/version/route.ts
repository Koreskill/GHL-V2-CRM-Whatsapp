import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { authorize } from "@/lib/api";

export const dynamic = "force-dynamic";

// "¿Cambió algo en la bandeja?" en una consulta indexada (conversations_org_idx). La bandeja la consulta
// cada pocos segundos y recarga la página entera SOLO si la versión cambió. Antes recargaba siempre: cada
// 3 s por pestaña se volvían a correr todas las consultas del layout y de la página.
export async function GET() {
  const auth = await authorize("agent");
  if ("response" in auth) return auth.response;
  const [row] = await getDb().execute<{ v: string | null; n: number; triage: string | null }>(sql`
    select max(updated_at)::text as v, count(*)::int as n,
      (select max(updated_at)::text from message_triage where organization_id = ${auth.session.organizationId}) as triage
    from conversations where organization_id = ${auth.session.organizationId}
  `);
  return Response.json({ version: `${row?.v ?? "0"}|${row?.n ?? 0}|${row?.triage ?? "0"}` }, { headers: { "cache-control": "no-store" } });
}
