import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, visitBookings, visitEvents, visits } from "@/db/schema";
import { safeError } from "@/lib/safe-error";
import { cancelBooking, createBooking, rescheduleBooking } from "./calcom-api";
import { credsOf, getIntegration, markStatus } from "./integration";

// Sincronización visita -> reserva de Cal.com de ESA inmobiliaria. Reglas:
//  - nunca tira: un fallo de Cal.com deja la visita local intacta y el error visible y reintentable;
//  - no se afirma "confirmada en Cal.com" hasta que la API devolvió el uid (sync_status = 'sincronizada');
//  - es idempotente: el vínculo es único por visita; una reserva ya creada se reprograma, no se duplica;
//  - Cal.com rechaza un horario ocupado y ese error queda registrado en vez de pisar otra reserva.

export type SyncOutcome = { ok: true; status: "sincronizada" | "cancelada" | "omitida" } | { ok: false; error: string };

const MAX_ATTEMPTS_PER_SWEEP = 5;

async function record(orgId: string, visitId: string, patch: Partial<typeof visitBookings.$inferInsert>) {
  const db = getDb();
  await db
    .insert(visitBookings)
    .values({ organizationId: orgId, visitId, ...patch })
    .onConflictDoUpdate({
      target: visitBookings.visitId,
      set: { ...patch, attempts: sql`${visitBookings.attempts} + 1`, updatedAt: sql`now()` },
    });
}

export async function syncVisit(orgId: string, visitId: string): Promise<SyncOutcome> {
  try {
    const integration = await getIntegration(orgId);
    // Sin integración no hay nada que sincronizar: la visita sigue siendo solo local.
    if (!integration || integration.status === "desconectada") return { ok: true, status: "omitida" };
    const creds = credsOf(integration);
    if (!creds) {
      await record(orgId, visitId, { syncStatus: "error", lastError: "No se pudo leer la clave de Cal.com (revisar la clave de cifrado del servidor)." });
      return { ok: false, error: "No se pudo leer la clave de Cal.com." };
    }

    const db = getDb();
    const [visit] = await db
      .select({ status: visits.status, scheduledAt: visits.scheduledAt, contactId: visits.contactId, cancelReason: visits.cancelReason })
      .from(visits)
      .where(and(eq(visits.id, visitId), eq(visits.organizationId, orgId)));
    if (!visit) return { ok: false, error: "Visita inexistente." };
    const [link] = await db.select().from(visitBookings).where(and(eq(visitBookings.visitId, visitId), eq(visitBookings.organizationId, orgId)));

    // ── Cancelada en el CRM: cancelar la reserva remota (si existe) ──
    if (visit.status === "cancelada") {
      if (!link?.bookingUid || link.syncStatus === "cancelada") return { ok: true, status: "omitida" };
      const res = await cancelBooking(creds, link.bookingUid, visit.cancelReason ?? "Cancelada desde el CRM");
      if (!res.ok) {
        await record(orgId, visitId, { syncStatus: "error", lastError: res.error });
        return { ok: false, error: res.error };
      }
      await record(orgId, visitId, { syncStatus: "cancelada", lastError: null, lastSyncedAt: new Date() });
      return { ok: true, status: "cancelada" };
    }

    // Solo las agendadas (con fecha) tienen reserva. Pedir una visita no es tener un horario.
    if (visit.status !== "agendada" || !visit.scheduledAt) return { ok: true, status: "omitida" };
    const start = visit.scheduledAt;
    // Ya está al día: no se vuelve a llamar (idempotencia ante reintentos y webhooks de eco).
    if (link?.syncStatus === "sincronizada" && link.bookingUid && link.startAt && link.startAt.getTime() === start.getTime()) {
      return { ok: true, status: "sincronizada" };
    }

    // ── Reprogramar una reserva existente ──
    if (link?.bookingUid && link.syncStatus !== "cancelada") {
      const res = await rescheduleBooking(creds, link.bookingUid, start.toISOString(), "Reprogramada desde el CRM");
      if (!res.ok) {
        await record(orgId, visitId, { syncStatus: "error", lastError: res.error });
        await markStatus(integration.id, "error", res.error);
        return { ok: false, error: res.error };
      }
      // Cal.com devuelve un uid nuevo al reprogramar.
      await record(orgId, visitId, { bookingUid: res.data.uid, startAt: start, syncStatus: "sincronizada", lastError: null, lastSyncedAt: new Date() });
      return { ok: true, status: "sincronizada" };
    }

    // ── Crear la reserva ──
    const [contact] = await db.select({ name: contacts.name, email: contacts.email, phone: contacts.phone }).from(contacts).where(and(eq(contacts.id, visit.contactId), eq(contacts.organizationId, orgId)));
    const email = contact?.email?.trim() || integration.fallbackEmail?.trim() || null;
    if (!email) {
      const error = "Falta un email: Cal.com lo exige. Cargalo en el contacto o configurá un email de respaldo en Calendario.";
      await record(orgId, visitId, { syncStatus: "error", lastError: error });
      return { ok: false, error };
    }
    const res = await createBooking(creds, {
      start: start.toISOString(),
      eventTypeId: integration.eventTypeId,
      attendee: { name: contact?.name?.trim() || "Visita", email, timeZone: integration.timeZone, phoneNumber: contact?.phone ?? null },
      metadata: { visitId, source: "setter-crm" },
    });
    if (!res.ok) {
      await record(orgId, visitId, { syncStatus: "error", lastError: res.error });
      await markStatus(integration.id, "error", res.error);
      return { ok: false, error: res.error };
    }
    await record(orgId, visitId, { bookingUid: res.data.uid, startAt: start, syncStatus: "sincronizada", lastError: null, lastSyncedAt: new Date() });
    await getDb()
      .insert(visitEvents)
      .values({ organizationId: orgId, visitId, action: "calendario", toValue: "reserva creada en Cal.com" })
      .catch(() => {});
    return { ok: true, status: "sincronizada" };
  } catch (err) {
    const error = safeError(err);
    await record(orgId, visitId, { syncStatus: "error", lastError: error }).catch(() => {});
    return { ok: false, error };
  }
}

/** Barrido de conciliación: reintenta lo que quedó en error o pendiente. Acotado para no saturar Cal.com. */
export async function retryFailedSyncs(orgId?: string): Promise<{ tried: number; ok: number }> {
  const db = getDb();
  const rows = await db
    .select({ orgId: visitBookings.organizationId, visitId: visitBookings.visitId })
    .from(visitBookings)
    .where(and(inArray(visitBookings.syncStatus, ["error", "pendiente"]), sql`${visitBookings.attempts} < 20`, orgId ? eq(visitBookings.organizationId, orgId) : undefined))
    .limit(MAX_ATTEMPTS_PER_SWEEP * 10);
  let ok = 0;
  for (const r of rows) {
    const res = await syncVisit(r.orgId, r.visitId);
    if (res.ok) ok++;
  }
  return { tried: rows.length, ok };
}
