import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, prospectRequirements, type OperationType, type ProspectUrgency } from "@/db/schema";
import { type ContactTagSummary, type TagPatch } from "./tag-labels";

/**
 * Lectura y edición MANUAL de las etiquetas del contacto, para la interfaz. SERVER-ONLY: importa
 * `@/db`. Los tipos y textos van en `tag-labels.ts`, que sí puede importar un componente cliente.
 *
 * La fuente de datos es la misma que ya escribe el agente en `triage/tags.ts`: `contacts.temperature`
 * y `prospect_requirements`. No hay una tabla `contact_tags` aparte (ver CLAUDE.md, Fase 13) — dos
 * lugares con la zona y el presupuesto del mismo contacto terminan diciendo cosas distintas. Un
 * usuario editando a mano y el bot completando por conversación escriben sobre el mismo registro.
 */

export type { ContactTagSummary, TagPatch };

function empty(contactId: string): ContactTagSummary {
  return {
    contactId,
    temperature: null,
    operation: null,
    urgency: null,
    zones: [],
    propertyTypes: [],
    priceMin: null,
    priceMax: null,
    currency: "USD",
    requirementId: null,
  };
}

/** Etiquetas de UN contacto. Usado en el header de la conversación. */
export async function getContactTagSummary(contactId: string, orgId: string): Promise<ContactTagSummary> {
  const db = getDb();
  const [row] = await db
    .select({
      temperature: contacts.temperature,
      operation: prospectRequirements.operation,
      urgency: prospectRequirements.urgency,
      zones: prospectRequirements.zones,
      propertyTypes: prospectRequirements.propertyTypes,
      priceMin: prospectRequirements.priceMin,
      priceMax: prospectRequirements.priceMax,
      currency: prospectRequirements.currency,
      requirementId: prospectRequirements.id,
    })
    .from(contacts)
    .leftJoin(
      prospectRequirements,
      and(eq(prospectRequirements.contactId, contacts.id), eq(prospectRequirements.status, "activo")),
    )
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, orgId)))
    .orderBy(desc(prospectRequirements.updatedAt))
    .limit(1);

  if (!row) return empty(contactId);
  return {
    contactId,
    temperature: row.temperature,
    operation: row.operation ?? null,
    urgency: row.urgency ?? null,
    zones: row.zones ?? [],
    propertyTypes: row.propertyTypes ?? [],
    priceMin: row.priceMin === null || row.priceMin === undefined ? null : Number(row.priceMin),
    priceMax: row.priceMax === null || row.priceMax === undefined ? null : Number(row.priceMax),
    currency: row.currency ?? "USD",
    requirementId: row.requirementId ?? null,
  };
}

/** Etiquetas de VARIOS contactos en una sola consulta, para listas (Contactos, Pipeline). */
export async function getContactTagSummaries(contactIds: string[], orgId: string): Promise<Map<string, ContactTagSummary>> {
  const ids = [...new Set(contactIds)];
  const map = new Map<string, ContactTagSummary>();
  if (!ids.length) return map;

  // El perfil "vigente" de cada contacto es su fila activa más reciente: puede haber filas viejas
  // (`status` distinto de "activo") de una oportunidad anterior que ya se cerró.
  const req = sql`(
    select distinct on (pr.contact_id) pr.*
    from ${prospectRequirements} pr
    where pr.status = 'activo'
    order by pr.contact_id, pr.updated_at desc
  ) as req`;

  const db = getDb();
  const rows = await db
    .select({
      contactId: contacts.id,
      temperature: contacts.temperature,
      operation: sql<OperationType | null>`req.operation`,
      urgency: sql<ProspectUrgency | null>`req.urgency`,
      zones: sql<string[] | null>`req.zones`,
      propertyTypes: sql<string[] | null>`req.property_types`,
      priceMin: sql<string | null>`req.price_min`,
      priceMax: sql<string | null>`req.price_max`,
      currency: sql<string | null>`req.currency`,
      requirementId: sql<string | null>`req.id`,
    })
    .from(contacts)
    .leftJoin(req, sql`req.contact_id = ${contacts.id}`)
    .where(and(eq(contacts.organizationId, orgId), inArray(contacts.id, ids)));

  for (const row of rows) {
    map.set(row.contactId, {
      contactId: row.contactId,
      temperature: row.temperature,
      operation: row.operation ?? null,
      urgency: row.urgency ?? null,
      zones: row.zones ?? [],
      propertyTypes: row.propertyTypes ?? [],
      priceMin: row.priceMin === null ? null : Number(row.priceMin),
      priceMax: row.priceMax === null ? null : Number(row.priceMax),
      currency: row.currency ?? "USD",
      requirementId: row.requirementId ?? null,
    });
  }
  for (const id of ids) if (!map.has(id)) map.set(id, empty(id));
  return map;
}

/**
 * Edición MANUAL de las etiquetas, desde la interfaz.
 *
 * A diferencia de `applyTags` (agente, incremental: lo que no vino no se toca), acá cada campo
 * presente en el patch es una decisión explícita de la persona que edita y pisa lo que hubiera,
 * incluso para vaciarlo (`null`). Lo que no viene en el patch (`undefined`) se deja como está.
 */
export async function updateContactTags(input: {
  organizationId: string;
  contactId: string;
  patch: TagPatch;
}): Promise<ContactTagSummary> {
  const db = getDb();
  const { organizationId, contactId, patch } = input;

  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
  if (!contact) throw new Error("Contacto no encontrado en esta inmobiliaria");

  if (patch.temperature !== undefined) {
    await db
      .update(contacts)
      .set({ temperature: patch.temperature, temperatureAt: patch.temperature ? new Date() : null })
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
  }

  const requirementPatch: Record<string, unknown> = {};
  const setIf = (key: string, value: unknown) => {
    if (value !== undefined) requirementPatch[key] = value;
  };
  setIf("operation", patch.operation);
  setIf("urgency", patch.urgency);
  setIf("zones", patch.zones);
  setIf("propertyTypes", patch.propertyTypes);
  setIf("priceMin", patch.priceMin === null || patch.priceMin === undefined ? patch.priceMin : String(patch.priceMin));
  setIf("priceMax", patch.priceMax === null || patch.priceMax === undefined ? patch.priceMax : String(patch.priceMax));
  setIf("currency", patch.currency);

  if (Object.keys(requirementPatch).length) {
    const [existing] = await db
      .select({ id: prospectRequirements.id })
      .from(prospectRequirements)
      .where(
        and(
          eq(prospectRequirements.contactId, contactId),
          eq(prospectRequirements.organizationId, organizationId),
          eq(prospectRequirements.status, "activo"),
        ),
      )
      .orderBy(desc(prospectRequirements.updatedAt))
      .limit(1);

    if (existing) {
      await db
        .update(prospectRequirements)
        .set({ ...requirementPatch, updatedAt: sql`now()` })
        .where(eq(prospectRequirements.id, existing.id));
    } else {
      await db.insert(prospectRequirements).values({ organizationId, contactId, ...requirementPatch });
    }
  }

  return getContactTagSummary(contactId, organizationId);
}
