import { and, asc, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { contactViews } from "@/db/schema";
import { contactFiltersToParams, contactFiltersFromJson } from "./contact-filters";

// Vistas guardadas: un nombre más los mismos filtros que lleva la URL. Las propias y las compartidas
// de la inmobiliaria; nunca las de otra organización.
export async function listContactViews(orgId: string, userId: string) {
  const rows = await getDb()
    .select()
    .from(contactViews)
    .where(and(eq(contactViews.organizationId, orgId), or(eq(contactViews.ownerUserId, userId), eq(contactViews.shared, true))))
    .orderBy(asc(contactViews.name));
  return rows.map((v) => ({
    id: v.id,
    name: v.name,
    shared: v.shared,
    mine: v.ownerUserId === userId,
    query: contactFiltersToParams(contactFiltersFromJson(v.filters)).toString(),
  }));
}
