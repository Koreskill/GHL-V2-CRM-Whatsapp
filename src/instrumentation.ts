// Arranque del servidor. El worker de la cola persistente (triaje, campañas, importaciones) y los
// seguimientos corren dentro del proceso de Node. Con JOBS_WORKER=off no arranca (por ejemplo, en una
// réplica que solo atiende HTTP) y el trabajo lo toma el Scheduler de Dokploy con GET /api/cron/jobs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.JOBS_WORKER === "off") return;
  // En el build no hay base: el worker solo arranca con DATABASE_URL.
  if (!process.env.DATABASE_URL) return;
  const { startWorker } = await import("@/lib/jobs/worker");
  startWorker();
}
