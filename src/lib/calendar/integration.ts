import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarIntegrations } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import type { CalendarCreds } from "./calcom-api";

export type Integration = typeof calendarIntegrations.$inferSelect;

export async function getIntegration(orgId: string): Promise<Integration | null> {
  const [row] = await getDb().select().from(calendarIntegrations).where(eq(calendarIntegrations.organizationId, orgId));
  return row ?? null;
}

export async function getIntegrationById(id: string): Promise<Integration | null> {
  const [row] = await getDb().select().from(calendarIntegrations).where(eq(calendarIntegrations.id, id));
  return row ?? null;
}

/** La clave de API descifrada, solo en el servidor. Null si falta la clave de cifrado o el valor no es válido. */
export function credsOf(integration: Integration): CalendarCreds | null {
  const apiKey = decryptSecret(integration.apiKeyEnc);
  return apiKey ? { apiKey } : null;
}

export const webhookSecretOf = (integration: Integration) => decryptSecret(integration.webhookSecretEnc);

// Solo https: la URL termina en un iframe y en mensajes a clientes.
export function parseHttpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export type SaveInput = {
  orgId: string;
  /** Vacío = conservar la clave ya guardada (editar sin volver a pegarla). */
  apiKey: string;
  eventTypeId: number;
  bookingUrl: string | null;
  timeZone: string;
  fallbackEmail: string | null;
};

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("es-AR", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function saveIntegration(input: SaveInput): Promise<{ ok: true; integration: Integration } | { ok: false; error: string }> {
  const existing = await getIntegration(input.orgId);
  if (!input.apiKey && !existing) return { ok: false, error: "Pegá la clave de API de Cal.com." };
  if (!isValidTimeZone(input.timeZone)) return { ok: false, error: "Zona horaria inválida." };

  const values = {
    eventTypeId: input.eventTypeId,
    bookingUrl: input.bookingUrl,
    timeZone: input.timeZone,
    fallbackEmail: input.fallbackEmail,
    status: "conectada",
    lastError: null,
    updatedAt: new Date(),
  };
  try {
    if (existing) {
      const [row] = await getDb()
        .update(calendarIntegrations)
        .set({ ...values, ...(input.apiKey ? { apiKeyEnc: encryptSecret(input.apiKey) } : {}) })
        .where(eq(calendarIntegrations.id, existing.id))
        .returning();
      return { ok: true, integration: row };
    }
    const [row] = await getDb()
      .insert(calendarIntegrations)
      .values({
        ...values,
        organizationId: input.orgId,
        apiKeyEnc: encryptSecret(input.apiKey),
        // Secreto propio de esta inmobiliaria para firmar sus webhooks.
        webhookSecretEnc: encryptSecret(randomBytes(24).toString("base64url")),
      })
      .returning();
    return { ok: true, integration: row };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message.includes("INTEGRATIONS_ENCRYPTION_KEY") ? err.message : "No se pudo guardar la integración." };
  }
}

export async function removeIntegration(orgId: string) {
  await getDb().delete(calendarIntegrations).where(eq(calendarIntegrations.organizationId, orgId));
}

export async function markStatus(id: string, status: "conectada" | "error", error: string | null) {
  await getDb()
    .update(calendarIntegrations)
    .set({ status, lastError: error?.slice(0, 300) ?? null, lastCheckedAt: new Date() })
    .where(eq(calendarIntegrations.id, id))
    .catch(() => {});
}

/** Firma de Cal.com: HMAC-SHA256 hex del body CRUDO en x-cal-signature-256. Sin secreto, rechaza. */
export function verifyCalSignature(rawBody: string, header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
