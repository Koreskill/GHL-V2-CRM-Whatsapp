import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, dealProperties, deals, properties, propertySyncConfigs, visits } from "@/db/schema";

export type PropertyFilters = {
  q?: string;
  operation?: string;
  propertyType?: string;
  zone?: string;
  status?: string;
  priceMin?: number;
  priceMax?: number;
};

export type PropertyCard = {
  id: string;
  externalId: string | null;
  title: string;
  operation: string;
  propertyType: string;
  status: string;
  price: number | null;
  currency: string;
  zone: string | null;
  city: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  areaM2: number | null;
  coverUrl: string | null;
  syncIssues: string[];
  syncedAt: string | null;
  source: string;
  deals: number;
  visits: number;
};

function buildWhere(orgId: string, f: PropertyFilters): SQL {
  const where: SQL[] = [eq(properties.organizationId, orgId)];
  if (f.operation) where.push(sql`${properties.operation}::text = ${f.operation}`);
  if (f.propertyType) where.push(sql`${properties.propertyType}::text = ${f.propertyType}`);
  if (f.status) where.push(sql`${properties.status}::text = ${f.status}`);
  if (f.zone) where.push(ilike(properties.zone, `%${f.zone.replace(/[\\%_]/g, (m) => `\\${m}`)}%`));
  if (f.priceMin !== undefined) where.push(gte(properties.price, String(f.priceMin)));
  if (f.priceMax !== undefined) where.push(lte(properties.price, String(f.priceMax)));
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(
      or(
        ilike(properties.title, like),
        ilike(properties.zone, like),
        ilike(properties.city, like),
        ilike(properties.addressPublic, like),
        ilike(properties.externalId, like),
      )!,
    );
  }
  return and(...where)!;
}

export async function listCatalog(orgId: string, f: PropertyFilters, limit = 120): Promise<PropertyCard[]> {
  const rows = await getDb()
    .select({
      id: properties.id,
      externalId: properties.externalId,
      title: properties.title,
      operation: properties.operation,
      propertyType: properties.propertyType,
      status: properties.status,
      price: properties.price,
      currency: properties.currency,
      zone: properties.zone,
      city: properties.city,
      bedrooms: properties.bedrooms,
      bathrooms: properties.bathrooms,
      parking: properties.parking,
      areaM2: properties.areaM2,
      coverUrl: properties.coverUrl,
      syncIssues: properties.syncIssues,
      syncedAt: properties.syncedAt,
      source: properties.source,
      deals: sql<number>`(select count(*)::int from ${dealProperties} dp where dp.property_id = ${properties.id})`,
      visits: sql<number>`(select count(*)::int from ${visits} v where v.property_id = ${properties.id})`,
    })
    .from(properties)
    .where(buildWhere(orgId, f))
    .orderBy(asc(properties.status), desc(properties.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    title: r.title ?? "Sin título",
    price: r.price === null ? null : Number(r.price),
    areaM2: r.areaM2 === null ? null : Number(r.areaM2),
    syncedAt: r.syncedAt?.toISOString() ?? null,
  }));
}

export async function countCatalog(orgId: string, f: PropertyFilters) {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(properties)
    .where(buildWhere(orgId, f));
  return row.n;
}

// Zonas existentes, para el filtro. Salen de los datos, no de una lista fija.
export async function listZones(orgId: string) {
  const rows = await getDb()
    .selectDistinct({ zone: properties.zone })
    .from(properties)
    .where(and(eq(properties.organizationId, orgId), sql`${properties.zone} is not null`))
    .orderBy(asc(properties.zone));
  return rows.map((r) => r.zone!).filter(Boolean);
}

export async function getProperty(id: string, orgId: string) {
  const [row] = await getDb()
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), eq(properties.organizationId, orgId)));
  if (!row) return null;
  return {
    ...row,
    price: row.price === null ? null : Number(row.price),
    areaM2: row.areaM2 === null ? null : Number(row.areaM2),
    areaCoveredM2: row.areaCoveredM2 === null ? null : Number(row.areaCoveredM2),
    externalUpdatedAt: row.externalUpdatedAt?.toISOString() ?? null,
    syncedAt: row.syncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Quiénes consultaron por esta propiedad: sale de las oportunidades que la tienen vinculada.
export async function listPropertyInterest(propertyId: string, orgId: string) {
  const rows = await getDb()
    .select({
      dealId: deals.id,
      dealTitle: deals.title,
      stage: deals.stage,
      status: deals.status,
      contactId: contacts.id,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      updatedAt: deals.updatedAt,
      // La conversación de la que salió la oportunidad, si nació de una.
      conversationId: deals.conversationId,
    })
    .from(dealProperties)
    .innerJoin(deals, eq(deals.id, dealProperties.dealId))
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(eq(dealProperties.propertyId, propertyId), eq(dealProperties.organizationId, orgId)))
    .orderBy(desc(deals.updatedAt));

  return rows.map((r) => ({
    ...r,
    dealTitle: r.dealTitle?.trim() || r.contactName?.trim() || "Sin nombre",
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getSyncConfig(orgId: string) {
  const [row] = await getDb()
    .select()
    .from(propertySyncConfigs)
    .where(eq(propertySyncConfigs.organizationId, orgId));
  return row
    ? { ...row, lastRunAt: row.lastRunAt?.toISOString() ?? null }
    : null;
}

// Resumen para la vista de agencia: cuántas activas y cuándo se sincronizó por última vez.
export async function getCatalogSummary(orgId: string) {
  const [row] = await getDb().execute<{
    total: number;
    disponibles: number;
    con_avisos: number;
    ultima_sync: Date | null;
    sync_status: string | null;
  }>(sql`
    select
      (select count(*)::int from properties where organization_id = ${orgId}) as total,
      (select count(*)::int from properties where organization_id = ${orgId} and status = 'disponible') as disponibles,
      (select count(*)::int from properties where organization_id = ${orgId}
         and jsonb_array_length(sync_issues) > 0) as con_avisos,
      (select last_run_at from property_sync_configs where organization_id = ${orgId}) as ultima_sync,
      (select last_status from property_sync_configs where organization_id = ${orgId}) as sync_status
  `);
  return {
    total: row.total,
    disponibles: row.disponibles,
    conAvisos: row.con_avisos,
    ultimaSync: row.ultima_sync ? new Date(row.ultima_sync).toISOString() : null,
    syncStatus: row.sync_status,
  };
}
