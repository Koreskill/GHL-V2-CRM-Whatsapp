import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations, properties, propertyPublications } from "@/db/schema";
import { newSlug, resolveBranding, type Branding } from "./logic";

export type Publication = typeof propertyPublications.$inferSelect;

export async function getPublication(orgId: string, propertyId: string): Promise<Publication | null> {
  const [row] = await getDb()
    .select()
    .from(propertyPublications)
    .where(and(eq(propertyPublications.propertyId, propertyId), eq(propertyPublications.organizationId, orgId)));
  return row ?? null;
}

export async function getOrgBranding(orgId: string): Promise<Branding> {
  const [row] = await getDb().select({ metadata: organizations.metadata }).from(organizations).where(eq(organizations.id, orgId));
  return resolveBranding(row?.metadata);
}

/** Crea el borrador si no existe. El slug se genera una sola vez y no cambia: el link ya compartido sigue valiendo. */
export async function ensurePublication(orgId: string, propertyId: string): Promise<Publication> {
  const existing = await getPublication(orgId, propertyId);
  if (existing) return existing;
  const [created] = await getDb()
    .insert(propertyPublications)
    .values({ organizationId: orgId, propertyId, slug: newSlug() })
    .onConflictDoNothing({ target: propertyPublications.propertyId })
    .returning();
  // Carrera: otra petición la creó entre el select y el insert.
  return created ?? (await getPublication(orgId, propertyId))!;
}

/**
 * Lo que ve un visitante sin login. Se busca SOLO por slug y SOLO si está publicada, y se devuelven
 * únicamente campos comerciales: nunca notas internas, documentos, dueño ni la dirección completa.
 */
export async function getPublicListing(slug: string, opts: { previewOrgId?: string } = {}) {
  const [row] = await getDb()
    .select({
      pubId: propertyPublications.id,
      orgId: propertyPublications.organizationId,
      headline: propertyPublications.headline,
      showAddress: propertyPublications.showAddress,
      brand: propertyPublications.brand,
      orgName: organizations.name,
      orgMetadata: organizations.metadata,
      title: properties.title,
      description: properties.description,
      operation: properties.operation,
      propertyType: properties.propertyType,
      status: properties.status,
      price: properties.price,
      currency: properties.currency,
      zone: properties.zone,
      city: properties.city,
      addressPublic: properties.addressPublic,
      bedrooms: properties.bedrooms,
      bathrooms: properties.bathrooms,
      parking: properties.parking,
      areaM2: properties.areaM2,
      areaCoveredM2: properties.areaCoveredM2,
      amenities: properties.amenities,
      coverUrl: properties.coverUrl,
      galleryUrls: properties.galleryUrls,
      photos: properties.photos,
      videoUrl: properties.videoUrl,
      tour360Url: properties.tour360Url,
      mapUrl: properties.mapUrl,
    })
    .from(propertyPublications)
    .innerJoin(properties, eq(properties.id, propertyPublications.propertyId))
    .innerJoin(organizations, eq(organizations.id, propertyPublications.organizationId))
    .where(and(eq(propertyPublications.slug, slug), opts.previewOrgId
        ? or(sql`${propertyPublications.status}::text = 'publicada'`, eq(propertyPublications.organizationId, opts.previewOrgId))
        : sql`${propertyPublications.status}::text = 'publicada'`,
    ));
  if (!row) return null;
  return {
    ...row,
    price: row.price === null ? null : Number(row.price),
    areaM2: row.areaM2 === null ? null : Number(row.areaM2),
    areaCoveredM2: row.areaCoveredM2 === null ? null : Number(row.areaCoveredM2),
    branding: resolveBranding(row.orgMetadata),
  };
}

export async function countView(pubId: string) {
  await getDb()
    .update(propertyPublications)
    .set({ views: sql`${propertyPublications.views} + 1` })
    .where(eq(propertyPublications.id, pubId))
    .catch(() => {});
}

export async function countCta(slug: string) {
  const [row] = await getDb()
    .update(propertyPublications)
    .set({ ctaClicks: sql`${propertyPublications.ctaClicks} + 1` })
    .where(and(eq(propertyPublications.slug, slug), sql`${propertyPublications.status}::text = 'publicada'`))
    .returning({ orgId: propertyPublications.organizationId });
  return row ?? null;
}
