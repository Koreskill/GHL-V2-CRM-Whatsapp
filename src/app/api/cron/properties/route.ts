import { isCronAuthorized } from "@/lib/cron-auth";
import { jsonError } from "@/lib/api";
import { safeError } from "@/lib/safe-error";

// Barrido de la cartera: sincroniza la hoja de Google de cada inmobiliaria que la tenga activa.
// Se programa con el Scheduler de Dokploy (cada 30 min alcanza). Es red de seguridad además del
// botón manual de Agencia; la hoja sigue siendo la fuente en los dos casos.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return jsonError(401, "No autorizado");

  try {
    const { syncAllOrganizations } = await import("@/lib/sheets/properties-sync");
    const runs = await syncAllOrganizations();
    return Response.json({
      organizations: runs.length,
      // Sin datos de las propiedades: solo el recuento por inmobiliaria.
      results: runs.map((r) => ({
        organizationId: r.orgId,
        ok: r.result.ok,
        upserted: r.result.upserted,
        skipped: r.result.skipped,
        issues: r.result.issues.length,
      })),
    });
  } catch (error) {
    return jsonError(500, safeError(error));
  }
}
