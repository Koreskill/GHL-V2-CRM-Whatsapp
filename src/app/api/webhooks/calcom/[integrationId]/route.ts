import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { visitBookings, visitEvents, visits } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { getIntegrationById, verifyCalSignature, webhookSecretOf } from "@/lib/calendar/integration";
import { safeError } from "@/lib/safe-error";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const ok = (body: Record<string, unknown> = { ok: true }) => Response.json(body, { status: 200 });

type CalPayload = {
  triggerEvent?: string;
  payload?: { uid?: string; startTime?: string; rescheduleUid?: string; rescheduledFromUid?: string; metadata?: Record<string, unknown> };
};

// Webhook de Cal.com DE UNA inmobiliaria: el id de la integración va en la ruta y el secreto con el
// que se firma es el suyo. Firma HMAC-SHA256 sobre el body crudo; sin secreto, se rechaza todo.
// Eventos que no entendemos: 200 (un 5xx haría que Cal.com apague la suscripción).
export async function POST(req: Request, ctx: RouteContext<"/api/webhooks/calcom/[integrationId]">) {
  const { integrationId } = await ctx.params;
  if (!isUuid(integrationId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 });

  const raw = await req.text();
  const integration = await getIntegrationById(integrationId);
  if (!integration || !verifyCalSignature(raw, req.headers.get("x-cal-signature-256"), webhookSecretOf(integration))) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let event: CalPayload;
  try {
    event = JSON.parse(raw);
  } catch {
    return ok({ ok: true, ignored: "invalid_json" });
  }
  const orgId = integration.organizationId;
  const p = event.payload;
  if (!p?.uid) return ok({ ok: true, ignored: "no_uid" });

  try {
    const db = getDb();
    const previousUid = p.rescheduleUid ?? p.rescheduledFromUid;
    const uids = [p.uid, ...(previousUid ? [previousUid] : [])];
    const [link] = await db
      .select()
      .from(visitBookings)
      .where(and(eq(visitBookings.organizationId, orgId), inArray(visitBookings.bookingUid, uids)));
    // Una reserva creada fuera del CRM no tiene visita: se ve en el Calendario y nada más.
    if (!link) return ok({ ok: true, ignored: "unlinked_booking" });

    if (event.triggerEvent === "BOOKING_RESCHEDULED") {
      const start = p.startTime ? new Date(p.startTime) : null;
      if (!start || Number.isNaN(start.getTime())) return ok({ ok: true, ignored: "no_start" });
      // Eco de nuestra propia reprogramación: mismos datos, no hay nada que cambiar.
      if (link.bookingUid === p.uid && link.startAt?.getTime() === start.getTime()) return ok({ ok: true, duplicate: true });

      await db.update(visitBookings).set({ bookingUid: p.uid, startAt: start, syncStatus: "sincronizada", lastError: null, lastSyncedAt: new Date() }).where(eq(visitBookings.id, link.id));
      const [visit] = await db.select({ scheduledAt: visits.scheduledAt, status: visits.status }).from(visits).where(and(eq(visits.id, link.visitId), eq(visits.organizationId, orgId)));
      if (visit && visit.scheduledAt?.getTime() !== start.getTime() && (visit.status === "agendada" || visit.status === "solicitada")) {
        await db.update(visits).set({ status: "agendada", scheduledAt: start }).where(eq(visits.id, link.visitId));
        await db
          .insert(visitEvents)
          .values({ organizationId: orgId, visitId: link.visitId, action: "reprogramada", fromValue: visit.scheduledAt?.toISOString() ?? null, toValue: `${start.toISOString()} (desde Cal.com)` })
          .catch(() => {});
      }
      return ok({ ok: true, result: "rescheduled" });
    }

    if (event.triggerEvent === "BOOKING_CANCELLED") {
      if (link.syncStatus === "cancelada") return ok({ ok: true, duplicate: true });
      await db.update(visitBookings).set({ syncStatus: "cancelada", lastSyncedAt: new Date() }).where(eq(visitBookings.id, link.id));
      const [visit] = await db.select({ status: visits.status }).from(visits).where(and(eq(visits.id, link.visitId), eq(visits.organizationId, orgId)));
      if (visit && (visit.status === "agendada" || visit.status === "solicitada")) {
        await db.update(visits).set({ status: "cancelada", cancelReason: "Cancelada en Cal.com" }).where(eq(visits.id, link.visitId));
        await db.insert(visitEvents).values({ organizationId: orgId, visitId: link.visitId, action: "cancelada", toValue: "desde Cal.com" }).catch(() => {});
      }
      return ok({ ok: true, result: "cancelled" });
    }

    return ok({ ok: true, ignored: `unhandled:${event.triggerEvent ?? "?"}` });
  } catch (err) {
    // Sin datos del evento en el log: solo el error saneado. Se devuelve 500 para que Cal.com reintente.
    console.error("[calcom] no se pudo procesar el evento:", safeError(err));
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
