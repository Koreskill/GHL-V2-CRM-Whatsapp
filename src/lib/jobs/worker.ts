import { safeError } from "@/lib/safe-error";
import { claimDue, completeJob, failJob, rescheduleJob, skipJob, type Job, type JobKind } from "./queue";

// Worker de la cola. Corre DENTRO del servidor (lo arranca src/instrumentation.ts) y además se puede
// disparar desde el Scheduler de Dokploy con GET /api/cron/jobs: los dos caminos usan el mismo reclamo
// atómico, así que conviven sin pisarse (y con varias réplicas también).
//
// Concurrencia por tipo, para que una campaña grande no demore las respuestas del bot:
const MAX_INFLIGHT: Record<JobKind, number> = { triage: 4, campaign: 2, account_import: 1 };
const TICK_MS = 2_000;
const FOLLOWUPS_EVERY_MS = 60_000;

export type HandlerResult =
  | { outcome: "done"; result?: Record<string, unknown> }
  | { outcome: "skip"; reason: string }
  | { outcome: "later"; runAfter: Date; result?: Record<string, unknown> };

type Handler = (job: Job) => Promise<HandlerResult>;

// Imports perezosos: el grafo del agente y de Zernio no entra hasta que hay un trabajo.
const HANDLERS: Record<JobKind, Handler> = {
  triage: async (job) => (await import("./handlers")).handleTriage(job),
  campaign: async (job) => (await import("./handlers")).handleCampaign(job),
  account_import: async (job) => (await import("./handlers")).handleAccountImport(job),
};

const state = globalThis as unknown as {
  __jobsWorker?: { timer: NodeJS.Timeout | null; inflight: Record<JobKind, number>; lastFollowups: number; ticking: boolean; stopping: boolean };
};

function worker() {
  return (state.__jobsWorker ??= {
    timer: null,
    inflight: { triage: 0, campaign: 0, account_import: 0 },
    lastFollowups: 0,
    ticking: false,
    stopping: false,
  });
}

async function runJob(job: Job): Promise<void> {
  const kind = job.kind as JobKind;
  const handler = HANDLERS[kind];
  if (!handler) {
    await skipJob(job.id, `tipo desconocido: ${job.kind}`);
    return;
  }
  try {
    const r = await handler(job);
    if (r.outcome === "done") await completeJob(job.id, r.result);
    else if (r.outcome === "skip") await skipJob(job.id, r.reason);
    else await rescheduleJob(job.id, r.runAfter, r.result);
  } catch (err) {
    const status = await failJob(job, err).catch(() => "failed" as const);
    console.error(`[jobs] ${job.kind} ${job.id} falló (intento ${job.attempts}/${job.maxAttempts}, ${status}): ${safeError(err)}`);
    if (status === "dead") {
      const { reportIncident } = await import("@/lib/incidents/report");
      await reportIncident({
        organizationId: job.organizationId,
        module: "cola",
        key: `job-dead:${job.kind}`,
        message: `Un trabajo de tipo ${job.kind} agotó sus reintentos`,
        detail: err,
        context: { jobId: job.id, kind: job.kind },
      }).catch(() => {});
    }
  }
}

/** Un pase: reclama lo vencido respetando la concurrencia y lo ejecuta. Devuelve cuántos tomó. */
export async function runDueJobs(opts: { wait?: boolean } = {}): Promise<number> {
  const w = worker();
  const started: Promise<void>[] = [];
  for (const kind of Object.keys(MAX_INFLIGHT) as JobKind[]) {
    const free = MAX_INFLIGHT[kind] - w.inflight[kind];
    if (free <= 0) continue;
    const claimed = await claimDue([kind], free).catch((err: unknown) => {
      console.error(`[jobs] no se pudo reclamar ${kind}: ${safeError(err)}`);
      return [] as Job[];
    });
    for (const job of claimed) {
      w.inflight[kind]++;
      started.push(runJob(job).finally(() => void w.inflight[kind]--));
    }
  }
  if (opts.wait) await Promise.allSettled(started);
  return started.length;
}

/** Seguimientos: inscribe conversaciones nuevas y envía los pasos vencidos. Idempotente. */
export async function runFollowups(): Promise<Record<string, number>> {
  const { runFollowupsTick } = await import("@/lib/followups/run");
  return runFollowupsTick();
}

async function tick() {
  const w = worker();
  if (w.ticking || w.stopping) return;
  w.ticking = true;
  try {
    await runDueJobs();
    if (Date.now() - w.lastFollowups >= FOLLOWUPS_EVERY_MS) {
      w.lastFollowups = Date.now();
      await runFollowups().catch((err: unknown) => console.error(`[seguimientos] ${safeError(err)}`));
    }
  } finally {
    w.ticking = false;
  }
}

export function startWorker() {
  const w = worker();
  if (w.timer) return;
  w.timer = setInterval(() => void tick(), TICK_MS);
  // No mantiene vivo el proceso por sí solo: el servidor HTTP es el que manda.
  w.timer.unref?.();
  // Parada ordenada: no se toma nada nuevo; lo que está en curso tiene lease y otro lo retoma si no termina.
  const stop = () => {
    w.stopping = true;
    if (w.timer) clearInterval(w.timer);
    w.timer = null;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.log("[jobs] worker iniciado");
}

export const workerInflight = () => ({ ...worker().inflight });
