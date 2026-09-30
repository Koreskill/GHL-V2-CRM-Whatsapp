import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, properties, visitBookings, visits } from "@/db/schema";
import { calcomBookingUrl, listUpcomingBookings } from "@/lib/calcom";
import { listUpcoming, type CalBooking } from "./calcom-api";
import { credsOf, getIntegration, type Integration } from "./integration";

// Un tenant explícito puede seguir usando las variables globales CALCOM_URL / CALCOM_API_KEY
// (transición). Cualquier otra inmobiliaria ve SOLO lo de su propia integración: nunca las reservas
// de una cuenta compartida.
export const isLegacyTenant = (orgId: string) => Boolean(process.env.CALCOM_LEGACY_ORG_ID) && process.env.CALCOM_LEGACY_ORG_ID === orgId;

export type CalendarSource =
  | { kind: "integration"; integration: Integration; bookingUrl: URL | null }
  | { kind: "legacy"; bookingUrl: URL | null }
  | { kind: "none" };

export async function resolveCalendar(orgId: string): Promise<CalendarSource> {
  const integration = await getIntegration(orgId);
  if (integration) {
    let url: URL | null = null;
    try {
      url = integration.bookingUrl ? new URL(integration.bookingUrl) : null;
    } catch {}
    return { kind: "integration", integration, bookingUrl: url?.protocol === "https:" ? url : null };
  }
  if (isLegacyTenant(orgId)) return { kind: "legacy", bookingUrl: calcomBookingUrl() };
  return { kind: "none" };
}

export type RemoteList = { ok: true; data: CalBooking[] } | { ok: false; error: string } | null;

export async function loadRemoteBookings(source: CalendarSource): Promise<RemoteList> {
  if (source.kind === "integration") {
    const creds = credsOf(source.integration);
    if (!creds) return { ok: false, error: "No se pudo leer la clave de Cal.com (revisar la clave de cifrado del servidor)." };
    const res = await listUpcoming(creds);
    return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
  }
  if (source.kind === "legacy") {
    const res = await listUpcomingBookings();
    return res;
  }
  return null;
}

export type LocalVisit = {
  id: string;
  scheduledAt: string;
  status: string;
  contactName: string | null;
  propertyTitle: string | null;
  sync: { status: string; error: string | null; uid: string | null } | null;
};

/** Visitas agendadas próximas de ESTA inmobiliaria, con el estado de su reserva remota. */
export async function listUpcomingLocalVisits(orgId: string): Promise<LocalVisit[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: visits.id,
      scheduledAt: visits.scheduledAt,
      status: visits.status,
      contactName: contacts.name,
      propertyTitle: properties.title,
    })
    .from(visits)
    .leftJoin(contacts, eq(contacts.id, visits.contactId))
    .leftJoin(properties, eq(properties.id, visits.propertyId))
    .where(and(eq(visits.organizationId, orgId), eq(visits.status, "agendada"), gte(visits.scheduledAt, new Date(Date.now() - 3600_000))))
    .orderBy(asc(visits.scheduledAt))
    .limit(50);
  const links = rows.length
    ? await db
        .select()
        .from(visitBookings)
        .where(and(eq(visitBookings.organizationId, orgId), inArray(visitBookings.visitId, rows.map((r) => r.id))))
    : [];
  const byVisit = new Map(links.map((l) => [l.visitId, l]));
  return rows.map((r) => {
    const l = byVisit.get(r.id);
    return {
      id: r.id,
      scheduledAt: r.scheduledAt!.toISOString(),
      status: r.status,
      contactName: r.contactName,
      propertyTitle: r.propertyTitle,
      sync: l ? { status: l.syncStatus, error: l.lastError, uid: l.bookingUid } : null,
    };
  });
}
