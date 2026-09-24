import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, deals, properties, visitEvents, visits, type VisitStatus } from "@/db/schema";

// Toda query lleva organizationId: el aislamiento entre inmobiliarias se hace acá.

export type VisitRow = {
  id: string;
  status: VisitStatus;
  dealId: string;
  dealTitle: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  propertyId: string;
  propertyTitle: string;
  propertyZone: string | null;
  propertyStatus: string;
  assignedUserId: string | null;
  requestedAt: string;
  scheduledAt: string | null;
  completedAt: string | null;
  notes: string | null;
  cancelReason: string | null;
  fromPresentation: boolean;
};

const selection = {
  id: visits.id,
  status: visits.status,
  dealId: visits.dealId,
  dealTitle: deals.title,
  contactId: visits.contactId,
  contactName: contacts.name,
  contactPhone: contacts.phone,
  propertyId: visits.propertyId,
  propertyTitle: properties.title,
  propertyZone: properties.zone,
  propertyStatus: properties.status,
  assignedUserId: visits.assignedUserId,
  requestedAt: visits.requestedAt,
  scheduledAt: visits.scheduledAt,
  completedAt: visits.completedAt,
  notes: visits.notes,
  cancelReason: visits.cancelReason,
  propertyPresentationId: visits.propertyPresentationId,
};

const withJoins = () =>
  getDb()
    .select(selection)
    .from(visits)
    .innerJoin(deals, eq(deals.id, visits.dealId))
    .innerJoin(contacts, eq(contacts.id, visits.contactId))
    .innerJoin(properties, eq(properties.id, visits.propertyId));

type VisitJoinRow = Awaited<ReturnType<typeof withJoins>>[number];

function toRow(r: VisitJoinRow): VisitRow {
  return {
    id: r.id,
    status: r.status,
    dealId: r.dealId,
    dealTitle: r.dealTitle?.trim() || r.contactName?.trim() || "Sin nombre",
    contactId: r.contactId,
    contactName: r.contactName ?? "Sin nombre",
    contactPhone: r.contactPhone,
    propertyId: r.propertyId,
    propertyTitle: r.propertyTitle ?? "Sin título",
    propertyZone: r.propertyZone,
    propertyStatus: r.propertyStatus,
    assignedUserId: r.assignedUserId,
    requestedAt: r.requestedAt.toISOString(),
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    notes: r.notes,
    cancelReason: r.cancelReason,
    fromPresentation: Boolean(r.propertyPresentationId),
  };
}


// Las dos secciones de la página de Visitas: pedidas sin fecha, y ya agendadas.
export async function listVisitsByStatus(orgId: string, statuses: VisitStatus[]): Promise<VisitRow[]> {
  const rows = await withJoins()
    .where(and(eq(visits.organizationId, orgId), inArray(visits.status, statuses)))
    // Las agendadas por fecha ascendente (lo más próximo primero); las solicitadas, por pedido.
    .orderBy(asc(visits.scheduledAt), desc(visits.requestedAt));
  return rows.map(toRow);
}

// Cerradas: realizadas, no asistió y canceladas.
export async function listVisitHistory(orgId: string, limit = 40): Promise<VisitRow[]> {
  const rows = await withJoins()
    .where(
      and(eq(visits.organizationId, orgId), inArray(visits.status, ["realizada", "no_asistio", "cancelada"])),
    )
    .orderBy(desc(visits.completedAt), desc(visits.updatedAt))
    .limit(limit);
  return rows.map(toRow);
}

export async function listVisitsByDeal(dealId: string, orgId: string): Promise<VisitRow[]> {
  const rows = await withJoins()
    .where(and(eq(visits.dealId, dealId), eq(visits.organizationId, orgId)))
    .orderBy(desc(visits.requestedAt));
  return rows.map(toRow);
}

export async function listVisitsByProperty(propertyId: string, orgId: string): Promise<VisitRow[]> {
  const rows = await withJoins()
    .where(and(eq(visits.propertyId, propertyId), eq(visits.organizationId, orgId)))
    .orderBy(desc(visits.requestedAt));
  return rows.map(toRow);
}

export async function getVisit(id: string, orgId: string): Promise<VisitRow | null> {
  const [r] = await withJoins().where(and(eq(visits.id, id), eq(visits.organizationId, orgId)));
  return r ? toRow(r) : null;
}

export type VisitEvent = {
  id: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  actorUserId: string | null;
  createdAt: string;
};

export async function listVisitEvents(visitId: string, orgId: string, limit = 50): Promise<VisitEvent[]> {
  const rows = await getDb()
    .select({
      id: visitEvents.id,
      action: visitEvents.action,
      fromValue: visitEvents.fromValue,
      toValue: visitEvents.toValue,
      actorUserId: visitEvents.actorUserId,
      createdAt: visitEvents.createdAt,
    })
    .from(visitEvents)
    .where(and(eq(visitEvents.visitId, visitId), eq(visitEvents.organizationId, orgId)))
    .orderBy(desc(visitEvents.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

// Contadores para el encabezado de la página y para la vista de agencia.
export async function countVisits(orgId: string) {
  const [row] = await getDb().execute<{
    solicitadas: number;
    agendadas: number;
    proximas: number;
  }>(sql`
    select
      (select count(*)::int from visits where organization_id = ${orgId} and status = 'solicitada') as solicitadas,
      (select count(*)::int from visits where organization_id = ${orgId} and status = 'agendada') as agendadas,
      (select count(*)::int from visits where organization_id = ${orgId} and status = 'agendada'
         and scheduled_at between now() and now() + interval '7 days') as proximas
  `);
  return row;
}

// Oportunidades abiertas con sus propiedades, para el formulario de nueva visita:
// una visita es SIEMPRE a una propiedad dentro de una oportunidad.
export async function listVisitTargets(orgId: string) {
  const rows = await getDb().execute<{
    deal_id: string;
    deal_title: string | null;
    contact_id: string;
    contact_name: string | null;
    property_id: string;
    property_title: string | null;
    property_zone: string | null;
  }>(sql`
    select d.id as deal_id, d.title as deal_title, d.contact_id, c.name as contact_name,
           p.id as property_id, p.title as property_title, p.zone as property_zone
    from deals d
    join deal_properties dp on dp.deal_id = d.id
    join properties p on p.id = dp.property_id
    left join contacts c on c.id = d.contact_id
    where d.organization_id = ${orgId} and d.status = 'abierta'
    order by d.updated_at desc, p.title
  `);

  // Se agrupa por oportunidad: el formulario elige primero la oportunidad y después la propiedad.
  const byDeal = new Map<
    string,
    { dealId: string; label: string; contactId: string; properties: { id: string; label: string }[] }
  >();
  for (const r of rows) {
    const label = r.deal_title?.trim() || r.contact_name || "Sin nombre";
    if (!byDeal.has(r.deal_id)) {
      byDeal.set(r.deal_id, { dealId: r.deal_id, label, contactId: r.contact_id, properties: [] });
    }
    byDeal.get(r.deal_id)!.properties.push({
      id: r.property_id,
      label: `${r.property_title ?? "Sin título"}${r.property_zone ? ` · ${r.property_zone}` : ""}`,
    });
  }
  return [...byDeal.values()];
}

