import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/db";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { safeError } from "@/lib/safe-error";

// Cola persistente en Postgres. Reglas:
// - Encolar es idempotente por `dedupeKey`: el mismo mensaje entrante encolado dos veces es UN trabajo.
// - Reclamar es atómico (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)): dos procesos
//   nunca toman el mismo trabajo. Funciona con el pooler de transacciones porque es una sola sentencia.
// - Un trabajo `running` cuyo lease venció (el proceso murió) vuelve a ser reclamable.
// - Un fallo reintenta con espera creciente; al agotar `maxAttempts` queda `dead` y visible.

export type JobKind = "triage" | "campaign" | "account_import";
export type Job = typeof jobs.$inferSelect;

export const LEASE_MS: Record<JobKind, number> = {
  triage: 4 * 60_000, // compone + envía: cubre la espera de los modelos con margen
  campaign: 10 * 60_000, // un tramo de envío con presupuesto de tiempo propio (ver campaigns/run.ts)
  account_import: 15 * 60_000,
};

export type EnqueueInput = {
  organizationId: string | null;
  kind: JobKind;
  dedupeKey: string;
  payload?: Record<string, unknown>;
  runAfter?: Date;
  maxAttempts?: number;
  /** Si ya existía terminado (done/dead/skipped), lo vuelve a poner en cola. Para reanudar campañas. */
  requeueFinished?: boolean;
};

export async function enqueue(input: EnqueueInput, db: DbExecutor = getDb()): Promise<void> {
  const runAfter = (input.runAfter ?? new Date()).toISOString();
  const values = {
    organizationId: input.organizationId,
    kind: input.kind,
    dedupeKey: input.dedupeKey,
    payload: input.payload ?? {},
    runAfter: sql`${runAfter}::timestamptz`,
    maxAttempts: input.maxAttempts ?? 5,
  };
  if (input.requeueFinished) {
    await db
      .insert(jobs)
      .values(values)
      .onConflictDoUpdate({
        target: jobs.dedupeKey,
        set: { status: "queued", runAfter: sql`${runAfter}::timestamptz`, attempts: 0, leaseUntil: null, lastError: null, updatedAt: sql`now()` },
        // Uno que está corriendo o ya en cola no se toca: se reprograma solo al terminar.
        setWhere: sql`${jobs.status} in ('done', 'dead', 'skipped')`,
      });
    return;
  }
  await db.insert(jobs).values(values).onConflictDoNothing({ target: jobs.dedupeKey });
}

/** Reclama hasta `limit` trabajos vencidos (o con lease caído) de los tipos pedidos. */
export async function claimDue(kinds: JobKind[], limit: number): Promise<Job[]> {
  if (!kinds.length || limit <= 0) return [];
  const kindList = sql.join(kinds.map((k) => sql`${k}`), sql`, `);
  // El lease depende del tipo: se calcula en SQL para que todo sea una sola sentencia.
  const lease = sql`case kind ${sql.join(
    kinds.map((k) => sql`when ${k} then interval '${sql.raw(String(Math.round(LEASE_MS[k] / 1000)))} seconds'`),
    sql` `,
  )} else interval '5 minutes' end`;
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    update jobs set status = 'running', attempts = attempts + 1, lease_until = now() + ${lease}, updated_at = now()
    where id in (
      select id from jobs
      where kind in (${kindList})
        and (
          (status in ('queued', 'failed') and run_after <= now())
          or (status = 'running' and lease_until < now())
        )
      order by run_after
      limit ${limit}
      for update skip locked
    )
    returning id, organization_id, kind, payload, dedupe_key, status, run_after, attempts, max_attempts, lease_until, last_error, result, created_at, updated_at
  `);
  return rows.map(toJob);
}

function toJob(r: Record<string, unknown>): Job {
  return {
    id: r.id as string,
    organizationId: (r.organization_id as string | null) ?? null,
    kind: r.kind as string,
    payload: (r.payload as Record<string, unknown>) ?? {},
    dedupeKey: r.dedupe_key as string,
    status: r.status as string,
    runAfter: new Date(r.run_after as string),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    leaseUntil: r.lease_until ? new Date(r.lease_until as string) : null,
    lastError: (r.last_error as string | null) ?? null,
    result: (r.result as Record<string, unknown> | null) ?? null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

/** Espera antes del próximo intento: 30 s, 1, 2, 4, 8… minutos, con tope de 30. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
}

export async function completeJob(id: string, result: Record<string, unknown> = {}) {
  await getDb().execute(sql`
    update jobs set status = 'done', lease_until = null, result = ${JSON.stringify(result)}::jsonb, last_error = null, updated_at = now()
    where id = ${id} and status = 'running'
  `);
}

export async function skipJob(id: string, reason: string) {
  await getDb().execute(sql`
    update jobs set status = 'skipped', lease_until = null, result = ${JSON.stringify({ reason })}::jsonb, updated_at = now()
    where id = ${id} and status = 'running'
  `);
}

/** Vuelve a poner en cola para más tarde SIN contar como fallo (p. ej. una campaña que sigue). */
export async function rescheduleJob(id: string, runAfter: Date, result: Record<string, unknown> = {}) {
  await getDb().execute(sql`
    update jobs set status = 'queued', attempts = 0, lease_until = null, run_after = ${runAfter.toISOString()}::timestamptz,
      result = ${JSON.stringify(result)}::jsonb, updated_at = now()
    where id = ${id} and status = 'running'
  `);
}

export async function failJob(job: Pick<Job, "id" | "attempts" | "maxAttempts">, err: unknown): Promise<"failed" | "dead"> {
  const dead = job.attempts >= job.maxAttempts;
  const next = new Date(Date.now() + backoffMs(job.attempts)).toISOString();
  await getDb().execute(sql`
    update jobs set status = ${dead ? "dead" : "failed"}, lease_until = null, last_error = ${safeError(err).slice(0, 500)},
      run_after = ${next}::timestamptz, updated_at = now()
    where id = ${job.id} and status = 'running'
  `);
  return dead ? "dead" : "failed";
}

/** Resumen para el panel de operación: cuántos hay en cada estado, por tipo. */
export async function queueSummary(orgId: string | null) {
  const rows = await getDb().execute<{ kind: string; status: string; n: number; oldest: string | null }>(sql`
    select kind, status, count(*)::int as n, min(run_after)::text as oldest from jobs
    where ${orgId ? sql`organization_id = ${orgId}` : sql`true`}
      and (status in ('queued', 'running', 'failed', 'dead') or updated_at > now() - interval '24 hours')
    group by kind, status
  `);
  return rows;
}
