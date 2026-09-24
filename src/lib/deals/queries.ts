import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contacts,
  dealEvents,
  dealProperties,
  deals,
  properties,
  prospectRequirements,
  type DealStage,
  type DealStatus,
} from "@/db/schema";

// Toda query lleva organizationId: el aislamiento entre inmobiliarias se hace acá, a nivel app.
// Olvidarlo no da error, da datos de otro cliente.

export type DealCard = {
  id: string;
  title: string;
  stage: DealStage;
  status: DealStatus;
  contactId: string;
  contactName: string;
  assignedUserId: string | null;
  value: number | null;
  currency: string;
  propertyCount: number;
  lastInteractionAt: string | null;
  updatedAt: string;
};

function cardTitle(row: { title: string | null; contactName: string | null }) {
  return row.title?.trim() || row.contactName?.trim() || "Sin nombre";
}

// Tablero: solo las oportunidades ABIERTAS. Las ganadas y perdidas no ocupan columna.
export async function listBoardDeals(orgId: string): Promise<DealCard[]> {
  const rows = await getDb()
    .select({
      id: deals.id,
      title: deals.title,
      stage: deals.stage,
      status: deals.status,
      contactId: deals.contactId,
      contactName: contacts.name,
      assignedUserId: deals.assignedUserId,
      value: deals.value,
      currency: deals.currency,
      updatedAt: deals.updatedAt,
      propertyCount: sql<number>`(
        select count(*)::int from ${dealProperties} dp where dp.deal_id = ${deals.id}
      )`,
      // Última señal de vida: el mensaje más reciente del contacto en cualquiera de sus conversaciones.
      lastInteractionAt: sql<Date | null>`(
        select max(c.last_message_at) from conversations c
        where c.contact_id = ${deals.contactId} and c.organization_id = ${orgId}
      )`,
    })
    .from(deals)
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(eq(deals.organizationId, orgId), eq(deals.status, "abierta")))
    .orderBy(desc(deals.updatedAt));

  return rows.map((r) => ({
    id: r.id,
    title: cardTitle(r),
    stage: r.stage,
    status: r.status,
    contactId: r.contactId,
    contactName: r.contactName ?? "Sin nombre",
    assignedUserId: r.assignedUserId,
    value: r.value === null ? null : Number(r.value),
    currency: r.currency,
    propertyCount: r.propertyCount,
    lastInteractionAt: r.lastInteractionAt ? new Date(r.lastInteractionAt).toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

// Cerradas (ganadas y perdidas), para el panel de abajo del tablero.
export async function listClosedDeals(orgId: string, limit = 30): Promise<(DealCard & { lostReason: string | null })[]> {
  const rows = await getDb()
    .select({
      id: deals.id,
      title: deals.title,
      stage: deals.stage,
      status: deals.status,
      contactId: deals.contactId,
      contactName: contacts.name,
      assignedUserId: deals.assignedUserId,
      value: deals.value,
      currency: deals.currency,
      lostReason: deals.lostReason,
      updatedAt: deals.updatedAt,
    })
    .from(deals)
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(eq(deals.organizationId, orgId), inArray(deals.status, ["ganada", "perdida"])))
    .orderBy(desc(deals.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    title: cardTitle(r),
    stage: r.stage,
    status: r.status,
    contactId: r.contactId,
    contactName: r.contactName ?? "Sin nombre",
    assignedUserId: r.assignedUserId,
    value: r.value === null ? null : Number(r.value),
    currency: r.currency,
    lostReason: r.lostReason,
    propertyCount: 0,
    lastInteractionAt: null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export type DealDetail = {
  id: string;
  title: string;
  stage: DealStage;
  status: DealStatus;
  lostReason: string | null;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  conversationId: string | null;
  assignedUserId: string | null;
  value: number | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  // Qué busca el contacto: NO se guarda en la oportunidad, sale de prospect_requirements.
  requirement: {
    operation: string | null;
    zones: string[];
    priceMin: number | null;
    priceMax: number | null;
    currency: string;
    bedroomsMin: number | null;
    bathroomsMin: number | null;
    mustHave: string[];
  } | null;
};

export async function getDeal(id: string, orgId: string): Promise<DealDetail | null> {
  const [r] = await getDb()
    .select({
      deal: deals,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      req: prospectRequirements,
    })
    .from(deals)
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(prospectRequirements, eq(prospectRequirements.id, deals.prospectRequirementId))
    .where(and(eq(deals.id, id), eq(deals.organizationId, orgId)));
  if (!r) return null;

  const d = r.deal;
  return {
    id: d.id,
    title: d.title?.trim() || r.contactName?.trim() || "Sin nombre",
    stage: d.stage,
    status: d.status,
    lostReason: d.lostReason,
    contactId: d.contactId,
    contactName: r.contactName ?? "Sin nombre",
    contactPhone: r.contactPhone,
    conversationId: d.conversationId,
    assignedUserId: d.assignedUserId,
    value: d.value === null ? null : Number(d.value),
    currency: d.currency,
    notes: d.notes,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    closedAt: d.closedAt?.toISOString() ?? null,
    requirement: r.req
      ? {
          operation: r.req.operation,
          zones: r.req.zones,
          priceMin: r.req.priceMin === null ? null : Number(r.req.priceMin),
          priceMax: r.req.priceMax === null ? null : Number(r.req.priceMax),
          currency: r.req.currency,
          bedroomsMin: r.req.bedroomsMin,
          bathroomsMin: r.req.bathroomsMin,
          mustHave: r.req.mustHave,
        }
      : null,
  };
}

export type DealProperty = {
  id: string;
  propertyId: string;
  title: string;
  operation: string;
  propertyType: string;
  status: string;
  price: number | null;
  currency: string;
  zone: string | null;
  city: string | null;
  photo: string | null;
};

export async function listDealProperties(dealId: string, orgId: string): Promise<DealProperty[]> {
  const rows = await getDb()
    .select({
      id: dealProperties.id,
      propertyId: properties.id,
      title: properties.title,
      operation: properties.operation,
      propertyType: properties.propertyType,
      status: properties.status,
      price: properties.price,
      currency: properties.currency,
      zone: properties.zone,
      city: properties.city,
      photos: properties.photos,
    })
    .from(dealProperties)
    .innerJoin(properties, eq(properties.id, dealProperties.propertyId))
    .where(and(eq(dealProperties.dealId, dealId), eq(dealProperties.organizationId, orgId)))
    .orderBy(desc(dealProperties.addedAt));

  return rows.map((r) => ({
    id: r.id,
    propertyId: r.propertyId,
    title: r.title ?? "Sin título",
    operation: r.operation,
    propertyType: r.propertyType,
    status: r.status,
    price: r.price === null ? null : Number(r.price),
    currency: r.currency,
    zone: r.zone,
    city: r.city,
    photo: r.photos[0] ?? null,
  }));
}

export type DealEvent = {
  id: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  actorUserId: string | null;
  createdAt: string;
};

export async function listDealEvents(dealId: string, orgId: string, limit = 50): Promise<DealEvent[]> {
  const rows = await getDb()
    .select({
      id: dealEvents.id,
      action: dealEvents.action,
      fromValue: dealEvents.fromValue,
      toValue: dealEvents.toValue,
      actorUserId: dealEvents.actorUserId,
      createdAt: dealEvents.createdAt,
    })
    .from(dealEvents)
    .where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.organizationId, orgId)))
    .orderBy(desc(dealEvents.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

// Propiedades disponibles para vincular, menos las que la oportunidad ya tiene.
export async function listLinkableProperties(orgId: string, dealId: string, limit = 100) {
  const rows = await getDb()
    .select({
      id: properties.id,
      title: properties.title,
      operation: properties.operation,
      propertyType: properties.propertyType,
      price: properties.price,
      currency: properties.currency,
      zone: properties.zone,
    })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        sql`${properties.id} not in (select dp.property_id from ${dealProperties} dp where dp.deal_id = ${dealId})`,
      ),
    )
    .orderBy(desc(properties.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, price: r.price === null ? null : Number(r.price) }));
}

// Contactos para el selector al crear una oportunidad.
export async function listContactOptions(orgId: string, limit = 200) {
  return getDb()
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.organizationId, orgId))
    .orderBy(desc(contacts.updatedAt))
    .limit(limit);
}

// Oportunidades de un contacto: se usa desde la ficha del contacto y desde la conversación.
export async function listDealsByContact(contactId: string, orgId: string) {
  return getDb()
    .select({
      id: deals.id,
      title: deals.title,
      stage: deals.stage,
      status: deals.status,
      updatedAt: deals.updatedAt,
    })
    .from(deals)
    .where(and(eq(deals.contactId, contactId), eq(deals.organizationId, orgId)))
    .orderBy(desc(deals.updatedAt));
}
