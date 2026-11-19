import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { contactGroupMembers, contactGroups, contactLabelLinks, contactLabels, contactViews, contacts } from "@/db/schema";
import { contactFiltersFromJson, contactWhere, type ContactFilters } from "./contact-filters";

// Cuatro cosas distintas, cada una con su lugar:
// - ETIQUETA (contact_labels): un atributo del contacto. Muchos contactos, muchas etiquetas.
// - GRUPO (contact_groups): un conjunto armado a mano. Selección FIJA: no cambia sola.
// - SEGMENTO (contact_views): un criterio guardado. DINÁMICO: se reevalúa cada vez que se usa.
// - LOTE (campaign_recipients + CHUNK en campaigns/run.ts): división técnica para enviar. No es de negocio.
// Al confirmar una campaña, la audiencia (de cualquiera de las tres primeras) se CONGELA en sus destinatarios.
//
// Todo va filtrado por organization_id, también dentro de cada subconsulta. Borrar una etiqueta o un
// grupo borra SOLO sus asignaciones (ON DELETE CASCADE sobre las tablas de vínculo), nunca contactos.

export const LABEL_COLORS = ["slate", "blue", "green", "amber", "orange", "red", "purple", "cyan"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];
export const labelColor = (v: string | null | undefined): LabelColor => ((LABEL_COLORS as readonly string[]).includes(v ?? "") ? (v as LabelColor) : "slate");

export type AudienceSources = { groupIds?: string[]; labelIds?: string[]; segmentIds?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cleanIds = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 50) : [];

export function normalizeSources(v: unknown): AudienceSources {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { groupIds: cleanIds(o.groupIds), labelIds: cleanIds(o.labelIds), segmentIds: cleanIds(o.segmentIds) };
}

export const hasSources = (s: AudienceSources) => Boolean(s.groupIds?.length || s.labelIds?.length || s.segmentIds?.length);

// ── Etiquetas ───────────────────────────────────────────────────────────────

export async function listLabels(orgId: string) {
  const rows = await getDb().execute<{ id: string; name: string; color: string; n: number }>(sql`
    select l.id, l.name, l.color, count(ll.contact_id)::int as n
    from contact_labels l left join contact_label_links ll on ll.label_id = l.id and ll.organization_id = ${orgId}
    where l.organization_id = ${orgId}
    group by l.id order by l.name
  `);
  return rows.map((r) => ({ ...r, color: labelColor(r.color) }));
}

export async function saveLabel(orgId: string, input: { id?: string; name: string; color: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 40);
  if (!name) return { ok: false, error: "La etiqueta necesita un nombre." };
  try {
    if (input.id) {
      await getDb()
        .update(contactLabels)
        .set({ name, color: labelColor(input.color) })
        .where(and(eq(contactLabels.id, input.id), eq(contactLabels.organizationId, orgId)));
    } else {
      await getDb().insert(contactLabels).values({ organizationId: orgId, name, color: labelColor(input.color) });
    }
    return { ok: true };
  } catch (err) {
    if (isUnique(err)) return { ok: false, error: "Ya hay una etiqueta con ese nombre." };
    throw err;
  }
}

export async function deleteLabel(orgId: string, id: string) {
  await getDb().delete(contactLabels).where(and(eq(contactLabels.id, id), eq(contactLabels.organizationId, orgId)));
}

// ── Grupos ──────────────────────────────────────────────────────────────────

export async function listGroups(orgId: string) {
  return getDb().execute<{ id: string; name: string; description: string | null; n: number; updated_at: string }>(sql`
    select g.id, g.name, g.description, count(gm.contact_id)::int as n, g.updated_at::text
    from contact_groups g left join contact_group_members gm on gm.group_id = g.id and gm.organization_id = ${orgId}
    where g.organization_id = ${orgId}
    group by g.id order by g.name
  `);
}

export async function saveGroup(
  orgId: string,
  userId: string,
  input: { id?: string; name: string; description?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, error: "El grupo necesita un nombre." };
  const description = input.description?.trim().slice(0, 300) || null;
  try {
    if (input.id) {
      const [row] = await getDb()
        .update(contactGroups)
        .set({ name, description })
        .where(and(eq(contactGroups.id, input.id), eq(contactGroups.organizationId, orgId)))
        .returning({ id: contactGroups.id });
      return row ? { ok: true, id: row.id } : { ok: false, error: "No se encontró el grupo." };
    }
    const [row] = await getDb().insert(contactGroups).values({ organizationId: orgId, name, description, createdBy: userId }).returning({ id: contactGroups.id });
    return { ok: true, id: row.id };
  } catch (err) {
    if (isUnique(err)) return { ok: false, error: "Ya hay un grupo con ese nombre." };
    throw err;
  }
}

export async function deleteGroup(orgId: string, id: string) {
  await getDb().delete(contactGroups).where(and(eq(contactGroups.id, id), eq(contactGroups.organizationId, orgId)));
}

// ── Asignaciones (de a uno o en bloque) ─────────────────────────────────────

/** Contactos que de verdad son de esta organización: un id ajeno o inventado se descarta en silencio. */
async function ownedContacts(orgId: string, contactIds: string[]): Promise<string[]> {
  const ids = [...new Set(contactIds.filter((x) => UUID.test(x)))].slice(0, 1000);
  if (!ids.length) return [];
  const rows = await getDb()
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.organizationId, orgId), inArray(contacts.id, ids)));
  return rows.map((r) => r.id);
}

async function ownedOne(table: typeof contactLabels | typeof contactGroups, orgId: string, id: string) {
  if (!UUID.test(id)) return false;
  const [row] = await getDb().select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.organizationId, orgId)));
  return Boolean(row);
}

export type BulkResult = { ok: true; changed: number } | { ok: false; error: string };

export async function setLabel(orgId: string, userId: string, labelId: string, contactIds: string[], on: boolean): Promise<BulkResult> {
  if (!(await ownedOne(contactLabels, orgId, labelId))) return { ok: false, error: "No se encontró la etiqueta." };
  const ids = await ownedContacts(orgId, contactIds);
  if (!ids.length) return { ok: true, changed: 0 };
  if (on) {
    const rows = await getDb()
      .insert(contactLabelLinks)
      .values(ids.map((contactId) => ({ organizationId: orgId, labelId, contactId, createdBy: userId })))
      .onConflictDoNothing()
      .returning({ c: contactLabelLinks.contactId });
    return { ok: true, changed: rows.length };
  }
  const rows = await getDb()
    .delete(contactLabelLinks)
    .where(and(eq(contactLabelLinks.organizationId, orgId), eq(contactLabelLinks.labelId, labelId), inArray(contactLabelLinks.contactId, ids)))
    .returning({ c: contactLabelLinks.contactId });
  return { ok: true, changed: rows.length };
}

export async function setGroupMembership(orgId: string, userId: string, groupId: string, contactIds: string[], on: boolean): Promise<BulkResult> {
  if (!(await ownedOne(contactGroups, orgId, groupId))) return { ok: false, error: "No se encontró el grupo." };
  const ids = await ownedContacts(orgId, contactIds);
  if (!ids.length) return { ok: true, changed: 0 };
  if (on) {
    const rows = await getDb()
      .insert(contactGroupMembers)
      .values(ids.map((contactId) => ({ organizationId: orgId, groupId, contactId, addedBy: userId })))
      .onConflictDoNothing()
      .returning({ c: contactGroupMembers.contactId });
    await getDb().update(contactGroups).set({ updatedAt: new Date() }).where(and(eq(contactGroups.id, groupId), eq(contactGroups.organizationId, orgId)));
    return { ok: true, changed: rows.length };
  }
  const rows = await getDb()
    .delete(contactGroupMembers)
    .where(and(eq(contactGroupMembers.organizationId, orgId), eq(contactGroupMembers.groupId, groupId), inArray(contactGroupMembers.contactId, ids)))
    .returning({ c: contactGroupMembers.contactId });
  return { ok: true, changed: rows.length };
}

/** Etiquetas y grupos de un contacto, para su ficha. */
export async function contactMemberships(orgId: string, contactId: string) {
  const [labels, groups] = await Promise.all([
    getDb()
      .select({ id: contactLabels.id, name: contactLabels.name, color: contactLabels.color })
      .from(contactLabelLinks)
      .innerJoin(contactLabels, eq(contactLabels.id, contactLabelLinks.labelId))
      .where(and(eq(contactLabelLinks.organizationId, orgId), eq(contactLabelLinks.contactId, contactId)))
      .orderBy(asc(contactLabels.name)),
    getDb()
      .select({ id: contactGroups.id, name: contactGroups.name })
      .from(contactGroupMembers)
      .innerJoin(contactGroups, eq(contactGroups.id, contactGroupMembers.groupId))
      .where(and(eq(contactGroupMembers.organizationId, orgId), eq(contactGroupMembers.contactId, contactId)))
      .orderBy(asc(contactGroups.name)),
  ]);
  return { labels: labels.map((l) => ({ ...l, color: labelColor(l.color) })), groups };
}

/** Etiquetas de varios contactos a la vez (para el listado). */
export async function labelsForContacts(orgId: string, contactIds: string[]) {
  const out = new Map<string, { id: string; name: string; color: LabelColor }[]>();
  if (!contactIds.length) return out;
  const rows = await getDb()
    .select({ contactId: contactLabelLinks.contactId, id: contactLabels.id, name: contactLabels.name, color: contactLabels.color })
    .from(contactLabelLinks)
    .innerJoin(contactLabels, eq(contactLabels.id, contactLabelLinks.labelId))
    .where(and(eq(contactLabelLinks.organizationId, orgId), inArray(contactLabelLinks.contactId, contactIds)))
    .orderBy(asc(contactLabels.name));
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    list.push({ id: r.id, name: r.name, color: labelColor(r.color) });
    out.set(r.contactId, list);
  }
  return out;
}

/** Ids de los contactos que cumplen un filtro (para aplicar una acción en bloque a "todos los filtrados"). */
export async function contactIdsMatching(orgId: string, filters: ContactFilters, limit = 1000): Promise<string[]> {
  const rows = await getDb().execute<{ id: string }>(sql`
    select c.id from contacts c where ${contactWhere(orgId, filters)} order by c.created_at limit ${limit}
  `);
  return rows.map((r) => r.id);
}

// ── Segmentos (vistas guardadas) ────────────────────────────────────────────

export async function listSegments(orgId: string, userId: string) {
  return getDb()
    .select({ id: contactViews.id, name: contactViews.name, filters: contactViews.filters, shared: contactViews.shared, ownerUserId: contactViews.ownerUserId })
    .from(contactViews)
    .where(and(eq(contactViews.organizationId, orgId), sql`(${contactViews.ownerUserId} = ${userId} or ${contactViews.shared})`))
    .orderBy(asc(contactViews.name));
}

async function segmentFilters(orgId: string, segmentIds: string[]): Promise<ContactFilters[]> {
  if (!segmentIds.length) return [];
  const rows = await getDb()
    .select({ filters: contactViews.filters })
    .from(contactViews)
    .where(and(eq(contactViews.organizationId, orgId), inArray(contactViews.id, segmentIds)));
  return rows.map((r) => contactFiltersFromJson(r.filters));
}

/**
 * Condición SQL de una audiencia sobre `contacts c`:
 *   (en alguno de los grupos) OR (con alguna de las etiquetas) OR (cumple alguno de los segmentos)
 *   AND los filtros extra.
 * Sin grupos/etiquetas/segmentos, la audiencia son solo los filtros. Los ids que no son de la
 * organización no aportan nada: las subconsultas repiten organization_id.
 */
export async function audienceWhere(orgId: string, sources: AudienceSources, filters: ContactFilters = {}): Promise<SQL> {
  const any: SQL[] = [];
  if (sources.groupIds?.length) {
    any.push(sql`exists (select 1 from contact_group_members gm where gm.contact_id = c.id and gm.organization_id = ${orgId}
      and gm.group_id in (${sql.join(sources.groupIds.map((id) => sql`${id}::uuid`), sql`, `)}))`);
  }
  if (sources.labelIds?.length) {
    any.push(sql`exists (select 1 from contact_label_links ll where ll.contact_id = c.id and ll.organization_id = ${orgId}
      and ll.label_id in (${sql.join(sources.labelIds.map((id) => sql`${id}::uuid`), sql`, `)}))`);
  }
  for (const f of await segmentFilters(orgId, sources.segmentIds ?? [])) any.push(sql`(${contactWhere(orgId, f)})`);

  const base = contactWhere(orgId, filters);
  if (!hasSources(sources)) return base;
  // Se pidieron fuentes pero ninguna existe en esta organización: audiencia vacía, no "todos".
  if (!any.length) return sql`false`;
  return sql`(${base}) and (${sql.join(any, sql` or `)})`;
}

// ── Duplicados ──────────────────────────────────────────────────────────────

/**
 * Posibles duplicados: contactos distintos de la misma inmobiliaria con el mismo teléfono (solo
 * dígitos, últimos 10 para no separar +54 9 11 de 11) o el mismo email. La identidad por canal
 * (contact_identities) ya impide duplicar a alguien DENTRO de un canal; esto encuentra a la misma
 * persona que escribió por dos canales o que alguien cargó a mano. Se muestra, no se fusiona solo.
 */
export async function findDuplicates(orgId: string, limit = 100) {
  return getDb().execute<{ key: string; kind: "telefono" | "email"; ids: string[]; names: (string | null)[] }>(sql`
    with keyed as (
      select id, name, 'telefono' as kind, right(regexp_replace(phone, '\\D', '', 'g'), 10) as key
      from contacts where organization_id = ${orgId} and anonymized_at is null and length(regexp_replace(coalesce(phone, ''), '\\D', '', 'g')) >= 8
      union all
      select id, name, 'email' as kind, lower(trim(email)) as key
      from contacts where organization_id = ${orgId} and anonymized_at is null and email like '%@%'
    )
    select key, kind, array_agg(id order by id) as ids, array_agg(name order by id) as names
    from keyed group by kind, key having count(*) > 1
    order by count(*) desc limit ${limit}
  `);
}

// ── Baja manual ─────────────────────────────────────────────────────────────

export async function setOptOut(orgId: string, contactIds: string[], optOut: boolean): Promise<BulkResult> {
  const ids = await ownedContacts(orgId, contactIds);
  if (!ids.length) return { ok: true, changed: 0 };
  const rows = await getDb()
    .update(contacts)
    .set(optOut ? { marketingOptOutAt: sql`coalesce(${contacts.marketingOptOutAt}, now())`, marketingOptOutSource: "manual" } : { marketingOptOutAt: null, marketingOptOutSource: null })
    .where(and(eq(contacts.organizationId, orgId), inArray(contacts.id, ids)))
    .returning({ id: contacts.id });
  return { ok: true, changed: rows.length };
}

function isUnique(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
