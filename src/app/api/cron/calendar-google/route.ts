import { ensureWatchChannels, processDueJobs } from "@/lib/calendar/google/outbox";
import { isCronAuthorized } from "@/lib/cron-auth";
import { requestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

// Dokploy Scheduler, cada 5 minutos: ejecuta el outbox de Google Calendar y renueva canales por vencer.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const jobs = await processDueJobs(25);
  const channels = await ensureWatchChannels(requestOrigin(req)).catch(() => ({ created: 0 }));
  return Response.json({ ...jobs, channels: channels.created });
}
