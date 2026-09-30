"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { organizations, propertyPublications } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { authorizeAction } from "@/lib/deals/guard";
import { getProperty } from "@/lib/properties/catalog";
import { BRAND_COLORS, normalizePhone, publishBlockers } from "@/lib/publications/logic";
import { ensurePublication, getOrgBranding } from "@/lib/publications/queries";

const text = (form: FormData, key: string, max = 300) => String(form.get(key) ?? "").trim().slice(0, max);
const back = (propertyId: string, query: string): never => redirect(`/propiedades/${propertyId}?${query}`);

// Publicar, guardar la configuración y pausar: la organización sale de la sesión y la propiedad
// se busca siempre con ella, así un id de otra inmobiliaria no se encuentra.
async function loadOwned(formData: FormData) {
  const { orgId } = await authorizeAction();
  const propertyId = text(formData, "propertyId", 64);
  if (!isUuid(propertyId)) redirect("/propiedades");
  const property = await getProperty(propertyId, orgId);
  if (!property) redirect("/propiedades");
  return { orgId, propertyId, property };
}

function settingsFrom(formData: FormData) {
  return {
    headline: text(formData, "headline", 120) || null,
    showAddress: formData.get("showAddress") === "on",
    brand: text(formData, "brand", 16) === "inmobiliaria" ? "inmobiliaria" : "cowin",
  };
}

export async function savePublicationSettings(formData: FormData) {
  const { orgId, propertyId } = await loadOwned(formData);
  const pub = await ensurePublication(orgId, propertyId);
  await getDb()
    .update(propertyPublications)
    .set({ ...settingsFrom(formData), updatedAt: sql`now()` })
    .where(and(eq(propertyPublications.id, pub.id), eq(propertyPublications.organizationId, orgId)));
  revalidatePath(`/propiedades/${propertyId}`);
  back(propertyId, "pub=guardada");
}

export async function publishProperty(formData: FormData) {
  const { orgId, propertyId, property } = await loadOwned(formData);
  const branding = await getOrgBranding(orgId);
  // Se revalida en el servidor: el botón deshabilitado de la pantalla no es una garantía.
  const blockers = publishBlockers(property, branding);
  if (blockers.length) back(propertyId, `pub=bloqueada`);

  const pub = await ensurePublication(orgId, propertyId);
  await getDb()
    .update(propertyPublications)
    .set({ ...settingsFrom(formData), status: "publicada", publishedAt: pub.publishedAt ?? new Date(), updatedAt: sql`now()` })
    .where(and(eq(propertyPublications.id, pub.id), eq(propertyPublications.organizationId, orgId)));
  revalidatePath(`/propiedades/${propertyId}`);
  back(propertyId, "pub=publicada");
}

export async function pauseProperty(formData: FormData) {
  const { orgId, propertyId } = await loadOwned(formData);
  await getDb()
    .update(propertyPublications)
    .set({ status: "pausada", updatedAt: sql`now()` })
    .where(and(eq(propertyPublications.propertyId, propertyId), eq(propertyPublications.organizationId, orgId)));
  revalidatePath(`/propiedades/${propertyId}`);
  back(propertyId, "pub=pausada");
}

// Marca de la inmobiliaria: solo administradores. Va en organizations.metadata, validada campo por campo.
export async function saveBranding(formData: FormData) {
  const session = await requireRole("admin");
  if (!session) redirect("/");

  const https = (raw: string) => {
    try {
      const u = new URL(raw);
      return u.protocol === "https:" ? u.toString() : null;
    } catch {
      return null;
    }
  };
  const colorRaw = text(formData, "colorId", 16);
  const branding = {
    name: text(formData, "name", 80) || null,
    logoUrl: https(text(formData, "logoUrl", 500)),
    phone: normalizePhone(text(formData, "phone", 30)),
    email: text(formData, "email", 120) || null,
    legal: text(formData, "legal", 600) || null,
    colorId: BRAND_COLORS.some((c) => c.id === colorRaw) ? colorRaw : null,
  };

  await getDb()
    .update(organizations)
    .set({ metadata: sql`coalesce(${organizations.metadata}, '{}'::jsonb) || ${JSON.stringify({ branding })}::jsonb`, updatedAt: sql`now()` })
    .where(eq(organizations.id, session.organizationId));

  revalidatePath("/configuracion");
  redirect("/configuracion?tab=marca&saved=1");
}
