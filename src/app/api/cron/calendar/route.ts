import { isCronAuthorized } from "@/lib/cron-auth";
import { retryFailedSyncs } from "@/lib/calendar/sync";

export const dynamic = "force-dynamic";

// Conciliación periódica (Dokploy Scheduler, cada 30 min alcanza): reintenta las visitas cuya reserva
// quedó en error o pendiente. Es red de seguridad: el camino normal es la sincronización al agendar.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await retryFailedSyncs());
}
