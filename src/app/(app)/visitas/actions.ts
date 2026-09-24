"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { deals, visitEvents, visits } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { authorizeAction } from "@/lib/deals/guard";

const text = (form: FormData, key: string, max = 500) => String(form.get(key) ?? "").trim().slice(0, max);

function fail(path: string, motivo: string): never {
  redirect(`${path}?error=${encodeURIComponent(motivo)}`);
}

// El input datetime-local manda "2026-09-30T15:30" sin zona: se interpreta como hora local del
// servidor. Se valida que sea una fecha real antes de guardarla.
function parseWhen(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function logEvent(input: {
  orgId: string;
  visitId: string;
  actorUserId: string;
  action: string;
  from?: string | null;
  to?: string | null;
}) {
  await getDb()
    .insert(visitEvents)
    .values({
      organizationId: input.orgId,
      visitId: input.visitId,
      actorUserId: input.actorUserId,
      action: input.action,
      fromValue: input.from ?? null,
      toValue: input.to ?? null,
    })
    .catch(() => {});
}

// Solicitar una visita. Nace "solicitada": pedir NO es tener fecha.
// Si el asesor ya carga fecha en el mismo paso, nace directamente "agendada".
export async function requestVisit(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const back = text(formData, "back", 200) || "/visitas";

  const dealId = text(formData, "dealId", 64);
  const propertyId = text(formData, "propertyId", 64);
  if (!isUuid(dealId) || !isUuid(propertyId)) fail(back, "Elige la oportunidad y la propiedad.");

  // El contacto sale de la oportunidad, no del formulario: así no se puede colar otro tenant.
  const [deal] = await getDb()
    .select({ contactId: deals.contactId })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)));
  if (!deal) fail(back, "La oportunidad no existe.");

  const scheduledAt = parseWhen(text(formData, "scheduledAt", 40));
  const assignedRaw = text(formData, "assignedUserId", 64);

  const [created] = await getDb()
    .insert(visits)
    .values({
      organizationId: orgId,
      dealId,
      contactId: deal.contactId,
      propertyId,
      status: scheduledAt ? "agendada" : "solicitada",
      scheduledAt,
      assignedUserId: isUuid(assignedRaw) ? assignedRaw : null,
      notes: text(formData, "notes", 2000) || null,
    })
    .returning({ id: visits.id });

  await logEvent({
    orgId,
    visitId: created.id,
    actorUserId: session.user.id,
    action: scheduledAt ? "agendada" : "solicitada",
    to: scheduledAt?.toISOString() ?? null,
  });

  revalidatePath("/visitas");
  revalidatePath(`/pipeline/${dealId}`);
  redirect(back);
}

// Confirmar o reprogramar: las dos son el mismo movimiento (fijar scheduled_at). Reprogramar NO es
// un estado aparte; queda registrado en el historial con la fecha anterior y la nueva.
export async function scheduleVisit(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const visitId = text(formData, "visitId", 64);
  const back = text(formData, "back", 200) || "/visitas";
  if (!isUuid(visitId)) redirect("/visitas");

  const scheduledAt = parseWhen(text(formData, "scheduledAt", 40));
  if (!scheduledAt) fail(back, "Pon una fecha y hora válidas.");

  const db = getDb();
  const [current] = await db
    .select({ status: visits.status, scheduledAt: visits.scheduledAt, dealId: visits.dealId })
    .from(visits)
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, orgId)));
  if (!current) redirect("/visitas");

  await db
    .update(visits)
    .set({ status: "agendada", scheduledAt, completedAt: null, cancelReason: null })
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, orgId)));

  await logEvent({
    orgId,
    visitId,
    actorUserId: session.user.id,
    action: current.scheduledAt ? "reprogramada" : "agendada",
    from: current.scheduledAt?.toISOString() ?? null,
    to: scheduledAt.toISOString(),
  });

  revalidatePath("/visitas");
  revalidatePath(`/pipeline/${current.dealId}`);
  redirect(back);
}

// Resultado después de la cita: realizada o no asistió, con nota de seguimiento.
export async function closeVisit(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const visitId = text(formData, "visitId", 64);
  const outcome = text(formData, "outcome", 16);
  const back = text(formData, "back", 200) || "/visitas";
  if (!isUuid(visitId) || (outcome !== "realizada" && outcome !== "no_asistio")) redirect("/visitas");

  const db = getDb();
  const [current] = await db
    .select({ status: visits.status, dealId: visits.dealId })
    .from(visits)
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, orgId)));
  if (!current) redirect("/visitas");

  const notes = text(formData, "notes", 2000);
  await db
    .update(visits)
    .set({ status: outcome, completedAt: new Date(), notes: notes || null })
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, orgId)));

  await logEvent({
    orgId,
    visitId,
    actorUserId: session.user.id,
    action: outcome,
    from: current.status,
    to: notes || null,
  });

  revalidatePath("/visitas");
  revalidatePath(`/pipeline/${current.dealId}`);
  redirect(back);
}

// Cancelar conserva el historial: la visita no se borra, cambia de estado con su motivo.
export async function cancelVisit(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const visitId = text(formData, "visitId", 64);
  const back = text(formData, "back", 200) || "/visitas";
  if (!isUuid(visitId)) redirect("/visitas");

  const reason = text(formData, "cancelReason", 500);
  if (!reason) fail(back, "Escribe el motivo de la cancelación.");

  const db = getDb();
  const [current] = await db
    .select({ status: visits.status, dealId: visits.dealId })
    .from(visits)
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, orgId)));
  if (!current) redirect("/visitas");

  await db
    .update(visits)
    .set({ status: "cancelada", cancelReason: reason, completedAt: new Date() })
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, orgId)));

  await logEvent({
    orgId,
    visitId,
    actorUserId: session.user.id,
    action: "cancelada",
    from: current.status,
    to: reason,
  });

  revalidatePath("/visitas");
  revalidatePath(`/pipeline/${current.dealId}`);
  redirect(back);
}

export async function assignVisit(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const visitId = text(formData, "visitId", 64);
  const back = text(formData, "back", 200) || "/visitas";
  if (!isUuid(visitId)) redirect("/visitas");

  const assignedRaw = text(formData, "assignedUserId", 64);
  const assignedUserId = isUuid(assignedRaw) ? assignedRaw : null;

  await getDb()
    .update(visits)
    .set({ assignedUserId })
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, orgId)));

  await logEvent({ orgId, visitId, actorUserId: session.user.id, action: "responsable", to: assignedUserId });
  revalidatePath("/visitas");
  redirect(back);
}
