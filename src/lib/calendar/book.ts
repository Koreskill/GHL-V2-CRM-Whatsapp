import { and, eq, gt, inArray, lt, or, isNull } from "drizzle-orm";
import { getDb, getRootDb } from "@/db";
import { availabilityBlocks, availabilityRules, bookingOffers, calendarSettings, visitEvents, visits } from "@/db/schema";
import { computeSlots, isSlotAvailable, type AvailabilityConfig, type Interval, type WorkRule } from "./availability";
import { externalBusy } from "./google/connections";
import { enqueueVisitSync } from "./google/outbox";

// Reserva del calendario interno. Es la fuente del estado comercial de la visita: Google solo aporta ocupación
// personal y una proyección del evento. Mientras `enabled` sea false o falte una cifra, no se ofrece nada.

const OFFER_TTL_MS = 15 * 60_000;

export type Settings = typeof calendarSettings.$inferSelect;

export async function getCalendarSettings(orgId: string): Promise<Settings | null> {
  const [s] = await getDb().select().from(calendarSettings).where(eq(calendarSettings.organizationId, orgId));
  return s ?? null;
}

/** Config usable, o null si la inmobiliaria no la completó: sin política aprobada no se inventan defaults. */
export function configFrom(s: Settings | null): AvailabilityConfig | null {
  if (!s?.enabled || s.durationMin === null || s.bufferMin === null || s.minNoticeMin === null || s.horizonDays === null) return null;
  return { durationMin: s.durationMin, bufferMin: s.bufferMin, minNoticeMin: s.minNoticeMin, horizonDays: s.horizonDays, timeZone: s.timeZone };
}

/** El calendario interno solo manda cuando está activo Y es el proveedor elegido: un solo gestor crea reservas. */
export const internalActive = (s: Settings | null) => Boolean(s && s.provider === "internal" && configFrom(s));

async function rulesFor(orgId: string, advisorId: string): Promise<WorkRule[]> {
  const rows = await getDb().select().from(availabilityRules).where(and(eq(availabilityRules.organizationId, orgId), eq(availabilityRules.userId, advisorId)));
  return rows.map((r) => ({ weekday: r.weekday, startMin: r.startMin, endMin: r.endMin }));
}

async function internalBusy(orgId: string, advisorId: string, from: Date, to: Date, defaultDurationMin: number, excludeVisitId?: string): Promise<Interval[]> {
  const db = getDb();
  const vs = await db
    .select({ id: visits.id, at: visits.scheduledAt, end: visits.endsAt })
    .from(visits)
    .where(and(eq(visits.organizationId, orgId), eq(visits.assignedUserId, advisorId), eq(visits.status, "agendada"), lt(visits.scheduledAt, to)));
  const blocks = await db
    .select()
    .from(availabilityBlocks)
    .where(and(eq(availabilityBlocks.organizationId, orgId), or(eq(availabilityBlocks.userId, advisorId), isNull(availabilityBlocks.userId)), gt(availabilityBlocks.endsAt, from), lt(availabilityBlocks.startsAt, to)));
  const out: Interval[] = [];
  for (const v of vs) {
    if (!v.at || v.id === excludeVisitId) continue;
    // Visitas viejas sin fin guardado: se asume la duración configurada.
    out.push({ start: v.at, end: v.end ?? new Date(v.at.getTime() + defaultDurationMin * 60_000) });
  }
  for (const b of blocks) out.push({ start: b.startsAt, end: b.endsAt });
  return out;
}

export type SlotsResult =
  | { status: "ok"; slots: Interval[]; external: "sin_conexion" | "ok" }
  | { status: "no_configurado" }
  // El asesor tiene Google conectado pero no se pudo leer: NO se ofrece como libre.
  | { status: "no_verificable"; reason: string };

export async function slotsFor(orgId: string, advisorId: string, now = new Date(), excludeVisitId?: string): Promise<SlotsResult> {
  const settings = await getCalendarSettings(orgId);
  const config = configFrom(settings);
  if (!config) return { status: "no_configurado" };
  const to = new Date(now.getTime() + (config.horizonDays + 1) * 24 * 3600_000);
  const ext = await externalBusy(orgId, advisorId, now, to);
  if (ext.status === "no_verificable") return { status: "no_verificable", reason: ext.reason };
  const busy = [...(await internalBusy(orgId, advisorId, now, to, config.durationMin, excludeVisitId)), ...ext.intervals];
  return { status: "ok", slots: computeSlots(await rulesFor(orgId, advisorId), config, busy, now), external: ext.status };
}

/** Emite ofertas vigentes para una conversación. El agente solo puede reservar lo que figure acá. */
export async function createOffers(orgId: string, advisorId: string, conversationId: string | null, count = 3) {
  const res = await slotsFor(orgId, advisorId);
  if (res.status !== "ok") return res;
  const settings = await getCalendarSettings(orgId);
  // Se reparten en días distintos antes de repetir día, para ofrecer variedad real.
  const picked: Interval[] = [];
  const seenDays = new Set<string>();
  for (const s of res.slots) {
    const day = s.start.toISOString().slice(0, 10);
    if (!seenDays.has(day)) {
      seenDays.add(day);
      picked.push(s);
    }
    if (picked.length >= count) break;
  }
  const offers = [];
  for (const s of picked) {
    const [o] = await getRootDb()
      .insert(bookingOffers)
      .values({ organizationId: orgId, conversationId, advisorUserId: advisorId, startsAt: s.start, endsAt: s.end, expiresAt: new Date(Date.now() + OFFER_TTL_MS), rulesVersion: settings?.rulesVersion ?? 1 })
      .returning();
    offers.push(o);
  }
  return { status: "ok" as const, offers };
}

export type BookResult =
  | { ok: true; startsAt: Date }
  | { ok: false; reason: "no_configurado" | "oferta_invalida" | "no_disponible" | "no_verificable" | "ocupado" | "visita_invalida" };

/**
 * Reserva una oferta vigente. Revalida justo antes: reglas (versión), vencimiento, ocupación interna y externa;
 * después reclama el intervalo en una transacción corta (la restricción de exclusión de Postgres decide si dos
 * personas pisan el mismo horario). Google NO participa de la transacción: es una proyección posterior.
 */
export async function bookOffer(input: { orgId: string; offerId: string; visitId: string; actorUserId: string | null }): Promise<BookResult> {
  const db = getRootDb();
  const settings = await getCalendarSettings(input.orgId);
  const config = configFrom(settings);
  if (!config || !settings) return { ok: false, reason: "no_configurado" };

  const [offer] = await db.select().from(bookingOffers).where(and(eq(bookingOffers.id, input.offerId), eq(bookingOffers.organizationId, input.orgId)));
  if (!offer || offer.status !== "open" || offer.expiresAt.getTime() < Date.now() || offer.rulesVersion !== settings.rulesVersion) return { ok: false, reason: "oferta_invalida" };

  const [visit] = await db.select({ id: visits.id, status: visits.status }).from(visits).where(and(eq(visits.id, input.visitId), eq(visits.organizationId, input.orgId)));
  if (!visit || !["solicitada", "agendada"].includes(visit.status)) return { ok: false, reason: "visita_invalida" };

  const now = new Date();
  const to = new Date(now.getTime() + (config.horizonDays + 1) * 24 * 3600_000);
  const ext = await externalBusy(input.orgId, offer.advisorUserId, now, to);
  if (ext.status === "no_verificable") return { ok: false, reason: "no_verificable" };
  const busy = [...(await internalBusy(input.orgId, offer.advisorUserId, now, to, config.durationMin, input.visitId)), ...ext.intervals];
  if (!isSlotAvailable(await rulesFor(input.orgId, offer.advisorUserId), config, busy, now, offer.startsAt)) return { ok: false, reason: "no_disponible" };

  try {
    await db.transaction(async (tx) => {
      // La oferta se consume una sola vez.
      const [used] = await tx
        .update(bookingOffers)
        .set({ status: "used", updatedAt: new Date() })
        .where(and(eq(bookingOffers.id, offer.id), eq(bookingOffers.status, "open")))
        .returning({ id: bookingOffers.id });
      if (!used) throw new Error("oferta_usada");
      await tx
        .update(visits)
        .set({ status: "agendada", scheduledAt: offer.startsAt, endsAt: offer.endsAt, assignedUserId: offer.advisorUserId, completedAt: null, cancelReason: null, updatedAt: new Date() })
        .where(and(eq(visits.id, input.visitId), eq(visits.organizationId, input.orgId)));
      await tx.insert(visitEvents).values({ organizationId: input.orgId, visitId: input.visitId, actorUserId: input.actorUserId, action: "agendada", toValue: offer.startsAt.toISOString(), metadata: { via: "calendario_interno", offerId: offer.id } });
      // El trabajo de Google se encola en la MISMA transacción: o quedan las dos cosas o ninguna.
      await enqueueVisitSync(tx, { organizationId: input.orgId, visitId: input.visitId, kind: "upsert" });
    });
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === "23P01") return { ok: false, reason: "ocupado" }; // exclusion_violation
    if (e instanceof Error && e.message === "oferta_usada") return { ok: false, reason: "oferta_invalida" };
    throw e;
  }
  return { ok: true, startsAt: offer.startsAt };
}

/**
 * Agenda manual de una persona con el calendario interno activo: fija el fin según la duración configurada y deja
 * que la restricción de exclusión impida pisar otra visita del mismo asesor. No exige horario laboral (una persona
 * puede decidir una excepción) pero sí que no haya choque.
 */
export async function applyManualSchedule(input: { orgId: string; visitId: string; startsAt: Date; actorUserId: string }): Promise<{ ok: true } | { ok: false; reason: "sin_asesor" | "ocupado" | "no_configurado" | "visita_cerrada" }> {
  const settings = await getCalendarSettings(input.orgId);
  const config = configFrom(settings);
  if (!config) return { ok: false, reason: "no_configurado" };
  const db = getRootDb();
  const [v] = await db.select({ assigned: visits.assignedUserId, status: visits.status, at: visits.scheduledAt }).from(visits).where(and(eq(visits.id, input.visitId), eq(visits.organizationId, input.orgId)));
  if (!v?.assigned) return { ok: false, reason: "sin_asesor" };
  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(visits)
        .set({ status: "agendada", scheduledAt: input.startsAt, endsAt: new Date(input.startsAt.getTime() + config.durationMin * 60_000), completedAt: null, cancelReason: null, updatedAt: new Date() })
        .where(and(eq(visits.id, input.visitId), eq(visits.organizationId, input.orgId), inArray(visits.status, ["solicitada", "agendada"])))
        .returning({ id: visits.id });
      // Visita ya cerrada o cancelada: no se registra un evento ni se encola nada sobre algo que no cambió.
      if (updated.length === 0) throw new Error("visita_cerrada");
      await tx.insert(visitEvents).values({
        organizationId: input.orgId,
        visitId: input.visitId,
        actorUserId: input.actorUserId,
        action: v.at ? "reprogramada" : "agendada",
        fromValue: v.at?.toISOString() ?? null,
        toValue: input.startsAt.toISOString(),
      });
      await enqueueVisitSync(tx, { organizationId: input.orgId, visitId: input.visitId, kind: "upsert" });
    });
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === "23P01") return { ok: false, reason: "ocupado" };
    if (e instanceof Error && e.message === "visita_cerrada") return { ok: false, reason: "visita_cerrada" };
    throw e;
  }
  return { ok: true };
}
