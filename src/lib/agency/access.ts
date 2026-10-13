import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { accessRequests, channelAccounts, incidents, organizationMembers, type Channel } from "@/db/schema";
import { activeOrganizationOf } from "@/lib/agency/users";
import { resolveIncidents } from "@/lib/incidents/report";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { Role } from "@/lib/roles";

// Solicitudes de acceso (altas con Google sin invitación) y cuentas de mensajería sin dueño.
// Solo las llama el plano de agencia, que valida requireAgencyAdmin() antes.

export type AccessRequestRow = { id: string; email: string; fullName: string | null; status: string; createdAt: string };

export async function listAccessRequests(): Promise<AccessRequestRow[]> {
  const rows = await getDb()
    .select()
    .from(accessRequests)
    .where(eq(accessRequests.status, "pending"))
    .orderBy(asc(accessRequests.createdAt))
    .limit(100);
  return rows.map((r) => ({ id: r.id, email: r.email, fullName: r.fullName, status: r.status, createdAt: r.createdAt.toISOString() }));
}

export async function approveAccessRequest(input: {
  requestId: string;
  organizationId: string;
  role: Role;
  actorUserId: string;
}): Promise<{ error?: string }> {
  const db = getDb();
  const [req] = await db.select().from(accessRequests).where(eq(accessRequests.id, input.requestId));
  if (!req || req.status !== "pending") return { error: "La solicitud ya no está pendiente." };

  // Una cuenta con otra inmobiliaria activa no se mueve sola: app_metadata guarda una única pertenencia.
  const current = await activeOrganizationOf(req.userId);
  if (current.error) return { error: current.error };
  if (current.orgId && current.orgId !== input.organizationId) {
    return { error: "Esa cuenta ya pertenece a otra inmobiliaria. Dala de baja allí antes de aprobarla acá." };
  }

  // El rol y la organización se escriben en app_metadata (solo con clave de servicio) y en la tabla espejo.
  const admin = createSupabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(req.userId, {
    app_metadata: { crm_role: input.role, organization_id: input.organizationId },
  });
  if (error) return { error: error.message };

  const memberRole = input.role === "admin" ? "admin" : "agente";
  try {
    // Si había una fila vieja (baja o suspensión), aprobar la deja ACTIVA: no queda aprobado y marcado revocado.
    await db
      .insert(organizationMembers)
      .values({ userId: req.userId, organizationId: input.organizationId, role: memberRole, status: "active" })
      .onConflictDoUpdate({
        target: [organizationMembers.userId, organizationMembers.organizationId],
        set: { role: memberRole, status: "active", updatedAt: new Date() },
      });
  } catch {
    // Auth ya se había actualizado: se deshace para no dejar acceso sin fila espejo.
    await admin.auth.admin.updateUserById(req.userId, { app_metadata: { crm_role: null, organization_id: null } });
    return { error: "No se pudo registrar la membresía. No se otorgó el acceso; reintentá." };
  }
  await db
    .update(accessRequests)
    .set({ status: "approved", decidedBy: input.actorUserId, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(accessRequests.id, req.id));
  return {};
}

export async function rejectAccessRequest(requestId: string, actorUserId: string) {
  await getDb()
    .update(accessRequests)
    .set({ status: "rejected", decidedBy: actorUserId, decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(accessRequests.id, requestId), eq(accessRequests.status, "pending")));
}

export type UnassignedAccount = { externalId: string; channel: string; name: string | null; handle: string | null };

// Los incidentes abiertos "cuenta sin asignar" guardan en `context` lo que hace falta para crearla.
export async function listUnassignedAccounts(): Promise<UnassignedAccount[]> {
  const rows = await getDb()
    .select({ context: incidents.context })
    .from(incidents)
    .where(
      and(
        isNull(incidents.organizationId),
        eq(incidents.module, "mensajeria"),
        inArray(incidents.status, ["nuevo", "en_revision"]),
      ),
    )
    .orderBy(desc(incidents.lastSeenAt))
    .limit(50);
  const out: UnassignedAccount[] = [];
  for (const { context } of rows) {
    const c = context as Record<string, unknown>;
    if (typeof c.externalId === "string" && typeof c.channel === "string") {
      out.push({
        externalId: c.externalId,
        channel: c.channel,
        name: typeof c.name === "string" ? c.name : null,
        handle: typeof c.handle === "string" ? c.handle : null,
      });
    }
  }
  return out;
}

export async function assignAccount(account: UnassignedAccount, organizationId: string): Promise<{ error?: string }> {
  const db = getDb();
  // Una cuenta pertenece a UNA inmobiliaria: la ingesta la busca solo por su id externo.
  const [existing] = await db.select({ id: channelAccounts.id }).from(channelAccounts).where(eq(channelAccounts.externalId, account.externalId));
  if (existing) return { error: "Esa cuenta ya está asignada a una inmobiliaria." };
  await db.insert(channelAccounts).values({
    organizationId,
    provider: "zernio",
    channel: account.channel as Channel,
    externalId: account.externalId,
    name: account.name,
    handle: account.handle,
    status: "connected",
  });
  await resolveIncidents(null, "mensajeria", `cuenta-sin-asignar:${account.externalId}`);
  return {};
}
