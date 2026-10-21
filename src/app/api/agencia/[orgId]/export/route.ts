import { isUuid, jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/agency/queries";
import { requireAgencyAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Descarga de todos los datos de una inmobiliaria (JSON). Solo la agencia, y queda en audit_logs.
export async function GET(_req: Request, ctx: RouteContext<"/api/agencia/[orgId]/export">) {
  const session = await requireAgencyAdmin();
  if (!session) return jsonError(403, "Solo la agencia");
  const { orgId } = await ctx.params;
  if (!isUuid(orgId)) return jsonError(400, "Inmobiliaria inválida");
  const { exportOrganization } = await import("@/lib/agency/org-lifecycle");
  const data = await exportOrganization(orgId);
  if (!data.organization) return jsonError(404, "No existe la inmobiliaria");
  await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: orgId, action: "org.export", target: `organization:${orgId}`, metadata: { contacts: data.contacts.length, messages: data.messages.length } });
  const name = `${data.organization.slug}-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 1), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${name.replace(/[^a-z0-9._-]/gi, "_")}"`,
      "cache-control": "no-store",
    },
  });
}
