import { sql } from "drizzle-orm";
import { getDb } from "@/db";

// Métricas de operación de una inmobiliaria en una ventana de días. Reglas de honestidad:
// - "Aceptado" (Zernio lo tomó) no es "entregado" (WhatsApp lo confirmó). Se cuentan aparte.
// - "Respondió" no es "venta": es que el contacto escribió después.
// - El costo de IA suma SOLO lo que el proveedor informó; las llamadas sin costo se cuentan aparte.

export async function getOpsMetrics(orgId: string, days: number) {
  const since = sql`now() - (${days} * interval '1 day')`;
  const db = getDb();
  const [triage, campaigns, followups, ai, models, queue] = await Promise.all([
    db.execute<{ received: number; processed: number; sent: number; drafts: number; handoffs: number; errors: number; stale: number }>(sql`
      select
        (select count(*)::int from messages where organization_id = ${orgId} and direction = 'inbound' and sent_at > ${since}) as received,
        count(*)::int as processed,
        count(*) filter (where status = 'enviado')::int as sent,
        count(*) filter (where status = 'borrador')::int as drafts,
        count(*) filter (where status = 'derivado')::int as handoffs,
        count(*) filter (where status = 'error')::int as errors,
        count(*) filter (where status = 'derivado' and route_reason like 'No se respondió a tiempo%')::int as stale
      from message_triage where organization_id = ${orgId} and created_at > ${since}
    `),
    db.execute<{ batches: number; accepted: number; delivered: number; read: number; failed: number; responded: number }>(sql`
      select
        count(distinct r.batch_id)::int as batches,
        count(*) filter (where r.status = 'enviado')::int as accepted,
        count(*) filter (where r.status = 'enviado' and m.status in ('delivered', 'read'))::int as delivered,
        count(*) filter (where r.status = 'enviado' and m.status = 'read')::int as read,
        count(*) filter (where r.status = 'fallido' or m.status = 'failed')::int as failed,
        count(*) filter (where r.status = 'enviado' and exists (
          select 1 from messages i where i.conversation_id = r.conversation_id and i.organization_id = ${orgId}
            and i.direction = 'inbound' and i.sent_at > r.sent_at
        ))::int as responded
      from campaign_recipients r left join messages m on m.id = r.message_id
      where r.organization_id = ${orgId} and r.sent_at > ${since}
    `),
    db.execute<{ sent: number; enrolled: number; reactivated: number }>(sql`
      select
        (select count(*)::int from messages where organization_id = ${orgId} and direction = 'outbound' and raw_payload->>'source' = 'followup' and sent_at > ${since}) as sent,
        count(*)::int as enrolled,
        count(*) filter (where status = 'respondio' and sent_count > 0)::int as reactivated
      from followup_enrollments where organization_id = ${orgId} and created_at > ${since}
    `),
    db.execute<{ calls: number; measured: string | null; unmeasured: number; tokens: string | null }>(sql`
      select count(*)::int as calls, sum(cost_usd)::text as measured,
        count(*) filter (where cost_usd is null and status = 'ok')::int as unmeasured,
        sum(total_tokens)::text as tokens
      from ai_usage_logs where organization_id = ${orgId} and created_at > ${since}
    `),
    db.execute<{ fn: string; model: string; calls: number; measured: string | null; unmeasured: number; errors: number }>(sql`
      select function::text as fn, model, count(*)::int as calls, sum(cost_usd)::text as measured,
        count(*) filter (where cost_usd is null and status = 'ok')::int as unmeasured,
        count(*) filter (where status <> 'ok')::int as errors
      from ai_usage_logs where organization_id = ${orgId} and created_at > ${since}
      group by function, model order by calls desc limit 12
    `),
    db.execute<{ pending: number; failed: number; dead: number }>(sql`
      select count(*) filter (where status in ('queued', 'running'))::int as pending,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'dead' and updated_at > ${since})::int as dead
      from jobs where organization_id = ${orgId}
    `),
  ]);
  const manual = await db.execute<{ human: number }>(sql`
    select count(*)::int as human from messages
    where organization_id = ${orgId} and direction = 'outbound' and raw_payload->>'source' = 'human' and sent_at > ${since}
  `);
  return {
    triage: triage[0],
    campaigns: campaigns[0],
    followups: followups[0],
    ai: { calls: ai[0].calls, measuredUsd: ai[0].measured === null ? null : Number(ai[0].measured), unmeasured: ai[0].unmeasured, tokens: ai[0].tokens === null ? 0 : Number(ai[0].tokens) },
    models: models.map((m) => ({ ...m, measuredUsd: m.measured === null ? null : Number(m.measured) })),
    queue: queue[0],
    humanMessages: manual[0].human,
  };
}
