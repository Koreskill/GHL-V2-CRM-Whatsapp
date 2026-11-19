import { sql } from "drizzle-orm";
import { getDb } from "@/db";

// Estado operativo de una inmobiliaria en una consulta por bloque: cuentas, hoja, cola, bot y costo.
// Lo medido y lo estimado van separados: una llamada a la IA sin costo informado NO cuenta como 0.

export async function clientHealth(orgId: string) {
  const db = getDb();
  const [accounts, sheet, jobs, ai, auto] = await Promise.all([
    db.execute<{ channel: string; name: string | null; handle: string | null; status: string }>(sql`
      select channel::text, name, handle, status from channel_accounts where organization_id = ${orgId} order by channel
    `),
    db.execute<{ last_status: string | null; last_run_at: string | null; last_error: string | null; enabled: boolean }>(sql`
      select last_status, last_run_at::text, last_error, enabled from property_sync_configs where organization_id = ${orgId}
    `),
    db.execute<{ queued: number; failed: number; dead: number; oldest_queued_min: number | null }>(sql`
      select
        count(*) filter (where status in ('queued', 'running'))::int as queued,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'dead' and updated_at > now() - interval '7 days')::int as dead,
        (extract(epoch from now() - min(run_after) filter (where status = 'queued' and run_after <= now())) / 60)::int as oldest_queued_min
      from jobs where organization_id = ${orgId}
    `),
    db.execute<{ calls: number; measured_usd: string | null; without_cost: number; errors: number }>(sql`
      select count(*)::int as calls, sum(cost_usd)::text as measured_usd,
        count(*) filter (where cost_usd is null and status = 'ok')::int as without_cost,
        count(*) filter (where status <> 'ok')::int as errors
      from ai_usage_logs where organization_id = ${orgId} and created_at > date_trunc('month', now())
    `),
    db.execute<{ campaigns: number; sequences: number; enrollments: number }>(sql`
      select
        (select count(*)::int from campaign_batches where organization_id = ${orgId} and status in ('enviando', 'programada', 'pausada')) as campaigns,
        (select count(*)::int from followup_sequences where organization_id = ${orgId} and enabled) as sequences,
        (select count(*)::int from followup_enrollments where organization_id = ${orgId} and status = 'activa') as enrollments
    `),
  ]);
  return {
    accounts,
    sheet: sheet[0] ?? null,
    jobs: jobs[0],
    ai: { ...ai[0], measuredUsd: ai[0].measured_usd === null ? null : Number(ai[0].measured_usd) },
    automation: auto[0],
  };
}
