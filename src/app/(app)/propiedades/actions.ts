"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { properties } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { authorizeAction } from "@/lib/deals/guard";

const OPERATIONS = new Set(["venta", "alquiler", "temporario"]);
const TYPES = new Set(["departamento", "casa", "ph", "terreno", "local", "oficina", "cochera", "otro"]);
const STATUSES = new Set(["borrador", "disponible", "reservada", "vendida", "alquilada", "pausada"]);

const text = (form: FormData, key: string, max = 300) => String(form.get(key) ?? "").trim().slice(0, max);

function fail(path: string, motivo: string): never {
  redirect(`${path}?error=${encodeURIComponent(motivo)}`);
}

// Números tolerantes: "USD 120.000" y "120000" valen lo mismo.
function num(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const normalized =
    cleaned.includes(",") && cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? String(n) : null;
}

const int = (raw: string): number | null => {
  const n = num(raw);
  return n === null ? null : Math.round(Number(n));
};

// Solo https: una URL con javascript: o data: no tiene por qué terminar en el navegador de nadie.
function url(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const list = (raw: string): string[] =>
  raw
    .split(/[\n,;|]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 30);

function readForm(formData: FormData, back: string) {
  const operation = text(formData, "operation", 20);
  const propertyType = text(formData, "propertyType", 20);
  const status = text(formData, "status", 20);

  if (!OPERATIONS.has(operation)) fail(back, "Elige la operación.");
  if (!TYPES.has(propertyType)) fail(back, "Elige el tipo de inmueble.");
  if (!STATUSES.has(status)) fail(back, "Elige el estado.");

  const title = text(formData, "title", 200);
  if (title.length < 3) fail(back, "Escribe un título de al menos 3 caracteres.");

  const coverRaw = text(formData, "coverUrl", 500);
  const coverUrl = url(coverRaw);
  if (coverRaw && !coverUrl) fail(back, "La portada tiene que ser un enlace https.");

  return {
    operation: operation as "venta",
    propertyType: propertyType as "otro",
    status: status as "disponible",
    title,
    description: text(formData, "description", 4000) || null,
    price: num(text(formData, "price", 30)),
    currency: (text(formData, "currency", 8) || "USD").toUpperCase(),
    addressPublic: text(formData, "addressPublic", 300) || null,
    zone: text(formData, "zone", 120) || null,
    city: text(formData, "city", 120) || null,
    mapUrl: url(text(formData, "mapUrl", 500)),
    bedrooms: int(text(formData, "bedrooms", 10)),
    bathrooms: int(text(formData, "bathrooms", 10)),
    parking: int(text(formData, "parking", 10)),
    areaM2: num(text(formData, "areaM2", 20)),
    areaCoveredM2: num(text(formData, "areaCoveredM2", 20)),
    amenities: list(text(formData, "amenities", 1000)),
    coverUrl,
    galleryUrls: list(text(formData, "galleryUrls", 3000))
      .map((u) => url(u))
      .filter((u): u is string => u !== null),
    videoUrl: url(text(formData, "videoUrl", 500)),
    tour360Url: url(text(formData, "tour360Url", 500)),
    sourceUrl: url(text(formData, "sourceUrl", 500)),
    internalNotes: text(formData, "internalNotes", 4000) || null,
  };
}

export async function createProperty(formData: FormData) {
  const { orgId } = await authorizeAction();
  const back = "/propiedades/nueva";
  const values = readForm(formData, back);

  const [created] = await getDb()
    .insert(properties)
    .values({
      organizationId: orgId,
      source: "manual",
      // Cargada a mano: no tiene external_id y la sincronización no la toca nunca.
      externalId: null,
      manuallyEditedAt: new Date(),
      syncStatus: "ok",
      syncIssues: [],
      ...values,
    })
    .returning({ id: properties.id });

  revalidatePath("/propiedades");
  redirect(`/propiedades/${created.id}?guardado=1`);
}

/**
 * Edición desde el CRM.
 *
 * Al guardar se marca `manually_edited_at`, y desde ese momento la sincronización con la hoja
 * NO pisa esta propiedad: la edición manual prevalece hasta que alguien pida explícitamente
 * volver a tomarla de la fuente.
 */
export async function updateProperty(formData: FormData) {
  const { orgId } = await authorizeAction();
  const id = text(formData, "propertyId", 64);
  if (!isUuid(id)) redirect("/propiedades");
  const back = `/propiedades/${id}/editar`;

  const values = readForm(formData, back);

  const updated = await getDb()
    .update(properties)
    .set({ ...values, manuallyEditedAt: new Date(), updatedAt: sql`now()` })
    .where(and(eq(properties.id, id), eq(properties.organizationId, orgId)))
    .returning({ id: properties.id });

  if (!updated.length) redirect("/propiedades");

  revalidatePath("/propiedades");
  revalidatePath(`/propiedades/${id}`);
  redirect(`/propiedades/${id}?guardado=1`);
}

/**
 * Devuelve la propiedad al control de la hoja: borra la marca de edición manual, así la próxima
 * sincronización la vuelve a escribir con lo que diga la fuente.
 */
export async function resyncProperty(formData: FormData) {
  const { orgId } = await authorizeAction();
  const id = text(formData, "propertyId", 64);
  if (!isUuid(id)) redirect("/propiedades");

  await getDb()
    .update(properties)
    .set({ manuallyEditedAt: null, updatedAt: sql`now()` })
    .where(and(eq(properties.id, id), eq(properties.organizationId, orgId)));

  revalidatePath(`/propiedades/${id}`);
  redirect(`/propiedades/${id}?resync=1`);
}

/** Sincronización manual desde la sección Propiedades, no solo desde Agencia. */
export async function syncOwnProperties() {
  const { orgId } = await authorizeAction();
  const { syncPropertiesFromSheet } = await import("@/lib/sheets/properties-sync");
  const result = await syncPropertiesFromSheet(orgId);

  revalidatePath("/propiedades");
  if (!result.ok) fail("/propiedades", result.error ?? "La sincronización falló");
  redirect(`/propiedades?sync=${result.upserted}`);
}
