import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, organizations } from "@/db/schema";
import type { Session } from "@/lib/auth";

// Registro de auditoría del plano de control. Todo cambio de contexto o acción sensible del
// admin de la agencia queda acá.
export async function writeAudit(input: {
  actorUserId: string;
  actingAsOrganizationId?: string | null;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await getDb()
    .insert(auditLogs)
    .values({
      actorUserId: input.actorUserId,
      actingAsOrganizationId: input.actingAsOrganizationId ?? null,
      action: input.action,
      target: input.target ?? null,
      metadata: input.metadata ?? {},
    })
    .catch(() => {});
}

// Resuelve sobre qué inmobiliaria actúa una request. Un usuario normal solo puede sobre la suya.
// El admin de la agencia puede pasar un orgId explícito (cambio de contexto), que queda auditado.
export async function resolveActiveOrg(session: Session, requestedOrgId?: string | null): Promise<string | null> {
  if (!requestedOrgId || requestedOrgId === session.organizationId) return session.organizationId;
  if (!session.isAgencyAdmin) return null;
  // El admin de la agencia entra a otra inmobiliaria: se registra el cambio de contexto.
  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: requestedOrgId,
    action: "context_switch",
    target: `organization:${requestedOrgId}`,
  });
  return requestedOrgId;
}

// Catálogo de inmobiliarias. Solo para el admin de la agencia (el llamador valida el permiso).
export async function listOrganizations() {
  return getDb()
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status })
    .from(organizations)
    .orderBy(organizations.name);
}

export async function listAuditLogs(limit = 100) {
  return getDb().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

// Vista cross-tenant de una inmobiliaria puntual (solo agencia).
export async function getOrganization(orgId: string) {
  const [row] = await getDb().select().from(organizations).where(eq(organizations.id, orgId));
  return row ?? null;
}
