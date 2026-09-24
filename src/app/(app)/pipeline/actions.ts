"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { dealEvents, dealProperties, deals, type DealStage } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { authorizeAction } from "@/lib/deals/guard";
import { DEAL_STAGES } from "@/lib/pipeline";

const MAX_TEXT = 2000;
const STAGES = new Set<string>(DEAL_STAGES.map((s) => s.id));

const text = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);

function fail(path: string, motivo: string): never {
  redirect(`${path}?error=${encodeURIComponent(motivo)}`);
}

// El valor es OPCIONAL a propósito: el precio de una propiedad no es el valor comercial del deal.
function parseValue(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Historial: cada cambio deja su rastro. Append-only, nunca se edita ni se borra.
async function logEvent(input: {
  orgId: string;
  dealId: string;
  actorUserId: string;
  action: string;
  from?: string | null;
  to?: string | null;
}) {
  await getDb()
    .insert(dealEvents)
    .values({
      organizationId: input.orgId,
      dealId: input.dealId,
      actorUserId: input.actorUserId,
      action: input.action,
      fromValue: input.from ?? null,
      toValue: input.to ?? null,
    })
    .catch(() => {});
}

export async function createDeal(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const back = "/pipeline/nueva";

  const contactId = text(formData, "contactId", 64);
  if (!isUuid(contactId)) fail(back, "Elige un contacto.");

  const stageRaw = text(formData, "stage", 32);
  const stage = (STAGES.has(stageRaw) ? stageRaw : "prospecto") as DealStage;
  const assignedRaw = text(formData, "assignedUserId", 64);
  const conversationId = text(formData, "conversationId", 64);

  const [created] = await getDb()
    .insert(deals)
    .values({
      organizationId: orgId,
      contactId,
      conversationId: isUuid(conversationId) ? conversationId : null,
      title: text(formData, "title") || null,
      stage,
      assignedUserId: isUuid(assignedRaw) ? assignedRaw : null,
      value: parseValue(text(formData, "value", 24))?.toString() ?? null,
      currency: text(formData, "currency", 8) || "USD",
      notes: text(formData, "notes", MAX_TEXT) || null,
    })
    .returning({ id: deals.id });

  // Propiedades de interés: una oportunidad puede nacer ya con varias.
  const propertyIds = formData.getAll("propertyIds").map(String).filter(isUuid).slice(0, 50);
  if (propertyIds.length) {
    await getDb()
      .insert(dealProperties)
      .values(propertyIds.map((propertyId) => ({ organizationId: orgId, dealId: created.id, propertyId })))
      .onConflictDoNothing();
  }

  await logEvent({ orgId, dealId: created.id, actorUserId: session.user.id, action: "creada", to: stage });
  revalidatePath("/pipeline");
  redirect(`/pipeline/${created.id}`);
}

// Mover entre etapas. Primera implementación por selector: el drag-and-drop se agrega después
// de comprobar que los cambios se guardan bien.
export async function moveDealStage(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const dealId = text(formData, "dealId", 64);
  const stageRaw = text(formData, "stage", 32);
  if (!isUuid(dealId) || !STAGES.has(stageRaw)) redirect("/pipeline");
  const stage = stageRaw as DealStage;

  const db = getDb();
  const [current] = await db
    .select({ stage: deals.stage, status: deals.status })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)));
  if (!current) redirect("/pipeline");
  if (current.stage === stage && current.status === "abierta") redirect("/pipeline");

  // Mover una oportunidad cerrada la reabre: el tablero solo muestra las abiertas.
  await db
    .update(deals)
    .set({ stage, status: "abierta", lostReason: null, closedAt: null })
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)));

  await logEvent({
    orgId,
    dealId,
    actorUserId: session.user.id,
    action: "etapa",
    from: current.stage,
    to: stage,
  });
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${dealId}`);
  redirect("/pipeline");
}

// Cerrar: ganada o perdida. Perder NO obliga a pasar por "Cerrado ganado": la etapa en la que
// estaba se conserva, que es el dato que sirve para saber dónde se caen las ventas.
export async function closeDeal(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const dealId = text(formData, "dealId", 64);
  const outcome = text(formData, "outcome", 16);
  if (!isUuid(dealId) || (outcome !== "ganada" && outcome !== "perdida")) redirect("/pipeline");
  const back = `/pipeline/${dealId}`;

  const lostReason = text(formData, "lostReason", 500);
  if (outcome === "perdida" && !lostReason) fail(back, "Escribe el motivo de la pérdida.");

  const db = getDb();
  const [current] = await db
    .select({ stage: deals.stage, status: deals.status })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)));
  if (!current) redirect("/pipeline");

  await db
    .update(deals)
    .set({
      status: outcome,
      // Ganar sí mueve la etapa al final del tablero; perder la deja donde estaba.
      stage: outcome === "ganada" ? "cerrado_ganado" : current.stage,
      lostReason: outcome === "perdida" ? lostReason : null,
      closedAt: new Date(),
    })
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)));

  await logEvent({
    orgId,
    dealId,
    actorUserId: session.user.id,
    action: outcome === "ganada" ? "ganada" : "perdida",
    from: current.stage,
    to: outcome === "perdida" ? lostReason : "cerrado_ganado",
  });
  revalidatePath("/pipeline");
  redirect(back);
}

export async function reopenDeal(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const dealId = text(formData, "dealId", 64);
  if (!isUuid(dealId)) redirect("/pipeline");

  await getDb()
    .update(deals)
    .set({ status: "abierta", lostReason: null, closedAt: null })
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)));

  await logEvent({ orgId, dealId, actorUserId: session.user.id, action: "reabierta" });
  revalidatePath("/pipeline");
  redirect(`/pipeline/${dealId}`);
}

export async function updateDeal(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const dealId = text(formData, "dealId", 64);
  if (!isUuid(dealId)) redirect("/pipeline");
  const back = `/pipeline/${dealId}`;

  const assignedRaw = text(formData, "assignedUserId", 64);
  const db = getDb();
  const [current] = await db
    .select({ assignedUserId: deals.assignedUserId })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)));
  if (!current) redirect("/pipeline");

  const assignedUserId = isUuid(assignedRaw) ? assignedRaw : null;
  await db
    .update(deals)
    .set({
      title: text(formData, "title") || null,
      assignedUserId,
      value: parseValue(text(formData, "value", 24))?.toString() ?? null,
      currency: text(formData, "currency", 8) || "USD",
      notes: text(formData, "notes", MAX_TEXT) || null,
    })
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)));

  if (current.assignedUserId !== assignedUserId) {
    await logEvent({
      orgId,
      dealId,
      actorUserId: session.user.id,
      action: "responsable",
      from: current.assignedUserId,
      to: assignedUserId,
    });
  }

  revalidatePath(back);
  redirect(`${back}?guardado=1`);
}

export async function linkProperty(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const dealId = text(formData, "dealId", 64);
  const propertyId = text(formData, "propertyId", 64);
  if (!isUuid(dealId) || !isUuid(propertyId)) redirect("/pipeline");

  await getDb()
    .insert(dealProperties)
    .values({ organizationId: orgId, dealId, propertyId })
    .onConflictDoNothing();

  await logEvent({ orgId, dealId, actorUserId: session.user.id, action: "propiedad_vinculada", to: propertyId });
  revalidatePath(`/pipeline/${dealId}`);
  redirect(`/pipeline/${dealId}`);
}

export async function unlinkProperty(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const dealId = text(formData, "dealId", 64);
  const propertyId = text(formData, "propertyId", 64);
  if (!isUuid(dealId) || !isUuid(propertyId)) redirect("/pipeline");

  await getDb()
    .delete(dealProperties)
    .where(
      and(
        eq(dealProperties.dealId, dealId),
        eq(dealProperties.propertyId, propertyId),
        eq(dealProperties.organizationId, orgId),
      ),
    );

  await logEvent({ orgId, dealId, actorUserId: session.user.id, action: "propiedad_desvinculada", from: propertyId });
  revalidatePath(`/pipeline/${dealId}`);
  redirect(`/pipeline/${dealId}`);
}
