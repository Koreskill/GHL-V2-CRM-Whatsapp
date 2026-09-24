import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { properties } from "@/db/schema";

export type PropertyOption = {
  id: string;
  title: string;
  operation: string;
  propertyType: string;
  status: string;
  price: number | null;
  currency: string;
  zone: string | null;
};

// Cartera de la inmobiliaria para los selectores de propiedades de una oportunidad.
export async function listPropertyOptions(orgId: string, limit = 300): Promise<PropertyOption[]> {
  const rows = await getDb()
    .select({
      id: properties.id,
      title: properties.title,
      operation: properties.operation,
      propertyType: properties.propertyType,
      status: properties.status,
      price: properties.price,
      currency: properties.currency,
      zone: properties.zone,
    })
    .from(properties)
    .where(eq(properties.organizationId, orgId))
    .orderBy(desc(properties.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    title: r.title ?? "Sin título",
    price: r.price === null ? null : Number(r.price),
  }));
}
