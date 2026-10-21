import { isCronAuthorized } from "@/lib/cron-auth";
import { runDueJobs, runFollowups } from "@/lib/jobs/worker";

export const dynamic = "force-dynamic";

// Respaldo del worker interno: toma lo vencido de la cola y corre los seguimientos. Seguro de llamar
// en paralelo con el worker (el reclamo es atómico). Programar en Dokploy cada 1-5 minutos.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const jobs = await runDueJobs({ wait: true });
  const followups = await runFollowups().catch(() => ({ error: 1 }));
  return Response.json({ ok: true, jobs, followups });
}
