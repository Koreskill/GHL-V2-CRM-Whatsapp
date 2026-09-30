import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contactIdentities,
  contacts,
  conversations,
  dealProperties,
  deals,
  properties,
  prospectRequirements,
  visits,
} from "@/db/schema";
import { getContactTagSummaries } from "./tags";

// Detalle de UN contacto para el panel lateral. Toda consulta lleva organization_id: un id de otra
// inmobiliaria no devuelve nada, aunque alguien lo escriba a mano en la URL.
export async function getContactDetail(orgId: string, contactId: string) {
  const db = getDb();
  const [contact] = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, createdAt: contacts.createdAt })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, orgId)));
  if (!contact) return null;

  const [identities, convs, requirement, dealRows, visitRows, tags] = await Promise.all([
    db
      .select({ channel: contactIdentities.channel, handle: contactIdentities.handle })
      .from(contactIdentities)
      .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.organizationId, orgId))),
    db
      .select({
        id: conversations.id,
        channel: conversations.channel,
        lastMessageAt: conversations.lastMessageAt,
        participantName: conversations.participantName,
      })
      .from(conversations)
      .where(and(eq(conversations.contactId, contactId), eq(conversations.organizationId, orgId)))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(5),
    db
      .select()
      .from(prospectRequirements)
      .where(and(eq(prospectRequirements.contactId, contactId), eq(prospectRequirements.organizationId, orgId), eq(prospectRequirements.status, "activo")))
      .orderBy(desc(prospectRequirements.updatedAt))
      .limit(1),
    db
      .select({ id: deals.id, title: deals.title, stage: deals.stage, status: deals.status, value: deals.value, currency: deals.currency })
      .from(deals)
      .where(and(eq(deals.contactId, contactId), eq(deals.organizationId, orgId)))
      .orderBy(desc(deals.updatedAt))
      .limit(10),
    db
      .select({
        id: visits.id,
        status: visits.status,
        scheduledAt: visits.scheduledAt,
        propertyTitle: properties.title,
      })
      .from(visits)
      .leftJoin(properties, eq(properties.id, visits.propertyId))
      .where(and(eq(visits.contactId, contactId), eq(visits.organizationId, orgId)))
      .orderBy(desc(visits.requestedAt))
      .limit(10),
    getContactTagSummaries([contactId], orgId),
  ]);

  // Propiedades mostradas o de interés: las de sus oportunidades.
  const dealIds = dealRows.map((d) => d.id);
  const shown = dealIds.length
    ? await db
        .select({
          propertyId: properties.id,
          title: properties.title,
          interest: dealProperties.interest,
        })
        .from(dealProperties)
        .innerJoin(properties, eq(properties.id, dealProperties.propertyId))
        .where(and(inArray(dealProperties.dealId, dealIds), eq(properties.organizationId, orgId)))
        .orderBy(sql`${dealProperties.lastInterestAt} desc nulls last`)
        .limit(15)
    : [];

  return {
    contact,
    identities,
    conversations: convs,
    requirement: requirement[0] ?? null,
    deals: dealRows,
    visits: visitRows,
    properties: shown,
    tags: tags.get(contactId) ?? null,
  };
}
