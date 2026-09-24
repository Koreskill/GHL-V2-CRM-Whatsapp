import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { networkMembers, networkPropertyListings, properties } from "@/db/schema";

type PropertyInsert = typeof properties.$inferInsert;
export type Property = typeof properties.$inferSelect;
export type NetworkListing = typeof networkPropertyListings.$inferSelect;

// Solo estos campos son compartibles en la red. address_full, internal_notes, documents
// y owner_contact_id NUNCA se proyectan: quedan privados del tenant dueño.
function shareableFrom(p: Property) {
  return {
    operation: p.operation,
    propertyType: p.propertyType,
    price: p.price,
    currency: p.currency,
    zone: p.zone,
    city: p.city,
    lat: p.lat,
    lng: p.lng,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    areaM2: p.areaM2,
    features: p.features,
    photos: p.photos,
  };
}

export type PropertyFilters = {
  status?: Property["status"];
  operation?: Property["operation"];
  propertyType?: Property["propertyType"];
  limit?: number;
};

export async function listProperties(orgId: string, filters: PropertyFilters = {}) {
  const where = [eq(properties.organizationId, orgId)];
  if (filters.status) where.push(eq(properties.status, filters.status));
  if (filters.operation) where.push(eq(properties.operation, filters.operation));
  if (filters.propertyType) where.push(eq(properties.propertyType, filters.propertyType));
  return getDb()
    .select()
    .from(properties)
    .where(and(...where))
    .orderBy(desc(properties.updatedAt))
    .limit(filters.limit ?? 200);
}

export async function getProperty(id: string, orgId: string): Promise<Property | null> {
  const [row] = await getDb()
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), eq(properties.organizationId, orgId)));
  return row ?? null;
}

// El tenant es del servidor: nunca se confía en un organizationId que venga del cliente.
export async function createProperty(
  orgId: string,
  input: Omit<PropertyInsert, "id" | "organizationId" | "createdAt" | "updatedAt">,
): Promise<Property> {
  const [row] = await getDb()
    .insert(properties)
    .values({ ...input, organizationId: orgId })
    .returning();
  return row;
}

export async function updateProperty(
  id: string,
  orgId: string,
  input: Partial<Omit<PropertyInsert, "id" | "organizationId" | "createdAt" | "updatedAt">>,
): Promise<Property | null> {
  const [row] = await getDb()
    .update(properties)
    .set(input)
    .where(and(eq(properties.id, id), eq(properties.organizationId, orgId)))
    .returning();
  return row ?? null;
}

export type PublishInput = {
  commercialDescription?: string | null;
  presentationLink?: string | null;
  collaborationTerms?: Record<string, unknown>;
};

export type PublishResult =
  | { ok: true; listing: NetworkListing }
  | { ok: false; error: "property_not_found" | "not_network_member" };

// Publicar en la red = crear/actualizar la proyección compartible, NO abrir acceso a la propiedad.
// owner_organization_id queda fijo en el tenant dueño.
export async function publishToNetwork(
  orgId: string,
  propertyId: string,
  networkId: string,
  input: PublishInput = {},
): Promise<PublishResult> {
  const db = getDb();
  const property = await getProperty(propertyId, orgId);
  if (!property) return { ok: false, error: "property_not_found" };

  const [member] = await db
    .select({ id: networkMembers.id })
    .from(networkMembers)
    .where(
      and(
        eq(networkMembers.networkId, networkId),
        eq(networkMembers.organizationId, orgId),
        eq(networkMembers.status, "activa"),
      ),
    );
  if (!member) return { ok: false, error: "not_network_member" };

  const shared = shareableFrom(property);
  const availability = property.status === "disponible" ? "disponible" : property.status;
  const description = input.commercialDescription ?? property.description ?? null;
  const [listing] = await db
    .insert(networkPropertyListings)
    .values({
      networkId,
      propertyId,
      ownerOrganizationId: orgId,
      ...shared,
      commercialDescription: description,
      presentationLink: input.presentationLink ?? null,
      collaborationTerms: input.collaborationTerms ?? {},
      availability,
      status: "publicada",
      publishedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [networkPropertyListings.networkId, networkPropertyListings.propertyId],
      set: {
        ...shared,
        commercialDescription: description,
        ...(input.presentationLink !== undefined ? { presentationLink: input.presentationLink } : {}),
        ...(input.collaborationTerms !== undefined ? { collaborationTerms: input.collaborationTerms } : {}),
        availability,
        status: "publicada",
        updatedAt: new Date(),
      },
    })
    .returning();
  return { ok: true, listing };
}

// Retirar de la red: no se borra la fila (las presentaciones pueden referenciarla), se marca retirada.
export async function unpublishFromNetwork(orgId: string, propertyId: string, networkId: string) {
  await getDb()
    .update(networkPropertyListings)
    .set({ status: "retirada", updatedAt: new Date() })
    .where(
      and(
        eq(networkPropertyListings.networkId, networkId),
        eq(networkPropertyListings.propertyId, propertyId),
        eq(networkPropertyListings.ownerOrganizationId, orgId),
      ),
    );
}

// Catálogo de red visible para una inmobiliaria: las publicaciones activas de las redes donde
// es miembro activo. Es la fuente del motor de matching (Fase 5). No expone datos privados.
export async function listNetworkCatalog(
  orgId: string,
  filters: { operation?: Property["operation"]; propertyType?: Property["propertyType"]; limit?: number } = {},
): Promise<NetworkListing[]> {
  const db = getDb();
  const memberships = await db
    .select({ networkId: networkMembers.networkId })
    .from(networkMembers)
    .where(and(eq(networkMembers.organizationId, orgId), eq(networkMembers.status, "activa")));
  const networkIds = memberships.map((m) => m.networkId);
  if (networkIds.length === 0) return [];

  const where = [
    inArray(networkPropertyListings.networkId, networkIds),
    eq(networkPropertyListings.status, "publicada"),
  ];
  if (filters.operation) where.push(eq(networkPropertyListings.operation, filters.operation));
  if (filters.propertyType) where.push(eq(networkPropertyListings.propertyType, filters.propertyType));

  return db
    .select()
    .from(networkPropertyListings)
    .where(and(...where))
    .orderBy(desc(networkPropertyListings.publishedAt))
    .limit(filters.limit ?? 200);
}
