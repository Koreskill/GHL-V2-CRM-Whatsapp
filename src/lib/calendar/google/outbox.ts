import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getRootDb, type DbExecutor } from "@/db";
import { calendarConnections, calendarEventLinks, calendarSyncJobs, calendarWatchChannels, contacts, properties, visits } from "@/db/schema";
import { reportIncident } from "@/lib/incidents/report";
import { safeError } from "@/lib/safe-error";
import { APP_TIME_ZONE } from "@/lib/tz";
import { deleteEvent, getEvent, insertEvent, patchEvent, sha256, watchEvents, type GEventInput } from "./client";
import { accessTokenFor, getConnection } from "./connections";

// Outbox DURABLE de la sincronización con Google. Reserva y sincronización no son lo mismo: la visita queda
// agendada en la base (fuente del estado comercial) y este trabajo la proyecta a Google con reintentos. Un
// error remoto queda visible en calendar_event_links.sync_status; nunca se confirma una reserva por Google.

const MAX_ATTEMPTS = 8;
const LEASE_MS = 5 * 60_000;

export type SyncKind = "upsert" | "delete" | "reconcile";

/** Encola dentro de la MISMA transacción que cambia la visita. La clave de idempotencia evita duplicados. */
export async function enqueueVisitSync(db: DbExecutor, input: { organizationId: string; visitId: string; kind: Exclude<SyncKind, "reconcile"> }) {
  const [v] = await db
    .select({ assignedUserId: visits.assignedUserId, updatedAt: visits.updatedAt })
    .from(visits)
    .where(and(eq(visits.id, input.visitId), eq(visits.organizationId, input.organizationId)));
  if (!v?.assignedUserId) return false;
  const [conn] = await db
    .select({ id: calendarConnections.id, status: calendarConnections.status })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.organizationId, input.organizationId), eq(calendarConnections.userId, v.assignedUserId)));
  if (!conn || conn.status !== "active") return false;
  await db
    .insert(calendarSyncJobs)
    .values({
      organizationId: input.organizationId,
      connectionId: conn.id,
      visitId: input.visitId,
      kind: input.kind,
      idempotencyKey: `${input.kind}:${input.visitId}:${v.updatedAt.getTime()}`,
    })
    .onConflictDoNothing();
  return true;
}

// Google exige ids de evento en base32hex (0-9 a-v): un hash hexadecimal de la visita sirve y hace idempotente la creación.
const eventIdFor = (visitId: string) => createHash("sha256").update(`ghl-visit:${visitId}`).digest("hex").slice(0, 40);

async function eventInputFor(visitId: string, orgId: string): Promise<GEventInput | null> {
  const [row] = await getRootDb()
    .select({
      status: visits.status,
      scheduledAt: visits.scheduledAt,
      endsAt: visits.endsAt,
      notes: visits.notes,
      property: properties.title,
      address: properties.addressPublic,
      contact: contacts.name,
    })
    .from(visits)
    .innerJoin(properties, eq(properties.id, visits.propertyId))
    .innerJoin(contacts, eq(contacts.id, visits.contactId))
    .where(and(eq(visits.id, visitId), eq(visits.organizationId, orgId)));
  if (!row || row.status !== "agendada" || !row.scheduledAt) return null;
  return {
    summary: `Visita: ${row.property ?? "propiedad"}`,
    // Solo lo necesario para presentarse: nombre del contacto. Sin teléfonos, notas internas ni documentos.
    description: `Visita con ${row.contact ?? "el contacto"}. Gestionada desde Setter CRM.`,
    location: row.address ?? undefined,
    start: row.scheduledAt,
    end: row.endsAt ?? new Date(row.scheduledAt.getTime() + 60 * 60_000),
    timeZone: APP_TIME_ZONE,
    extendedPrivate: { ghlVisitId: visitId },
  };
}

async function runUpsert(job: typeof calendarSyncJobs.$inferSelect): Promise<string | null> {
  const db = getRootDb();
  if (!job.visitId) return null;
  const conn = await db.select().from(calendarConnections).where(eq(calendarConnections.id, job.connectionId)).then((r) => r[0]);
  if (!conn?.destinationCalendarId) return "La conexión no tiene calendario de destino";
  const input = await eventInputFor(job.visitId, job.organizationId);
  if (!input) return runDelete(job); // ya no está agendada: se retira de Google
  const token = await accessTokenFor(conn);
  if (!token.ok) return token.error;

  const [link] = await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.visitId, job.visitId));
  const eventId = link?.googleEventId ?? eventIdFor(job.visitId);
  let res = link?.googleEventId ? await patchEvent(token.data, conn.destinationCalendarId, eventId, input) : await insertEvent(token.data, conn.destinationCalendarId, input, eventId);
  // 409 = el evento ya existe (un intento anterior llegó a crearlo): se actualiza en vez de duplicar.
  if (!res.ok && res.status === 409) res = await patchEvent(token.data, conn.destinationCalendarId, eventId, input);
  if (!res.ok) {
    await db
      .insert(calendarEventLinks)
      .values({ organizationId: job.organizationId, visitId: job.visitId, connectionId: conn.id, googleCalendarId: conn.destinationCalendarId, syncStatus: "error", lastError: res.error.slice(0, 300) })
      .onConflictDoUpdate({ target: calendarEventLinks.visitId, set: { syncStatus: "error", lastError: res.error.slice(0, 300), updatedAt: new Date() } });
    return res.error;
  }
  const values = { googleEventId: res.data.id, etag: res.data.etag ?? null, syncStatus: "sincronizada", lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() };
  await db
    .insert(calendarEventLinks)
    .values({ organizationId: job.organizationId, visitId: job.visitId, connectionId: conn.id, googleCalendarId: conn.destinationCalendarId, ...values })
    .onConflictDoUpdate({ target: calendarEventLinks.visitId, set: values });
  return null;
}

async function runDelete(job: typeof calendarSyncJobs.$inferSelect): Promise<string | null> {
  const db = getRootDb();
  if (!job.visitId) return null;
  const [link] = await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.visitId, job.visitId));
  if (!link?.googleEventId) return null;
  const conn = await db.select().from(calendarConnections).where(eq(calendarConnections.id, job.connectionId)).then((r) => r[0]);
  if (!conn) return null;
  const token = await accessTokenFor(conn);
  if (!token.ok) return token.error;
  const res = await deleteEvent(token.data, link.googleCalendarId, link.googleEventId);
  // 404/410: ya no existía. Es el resultado buscado.
  if (!res.ok && res.status !== 404 && res.status !== 410) return res.error;
  await db.update(calendarEventLinks).set({ syncStatus: "cancelada", lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(calendarEventLinks.id, link.id));
  return null;
}

/** Compara los eventos de GHL con Google. Una edición hecha afuera se MUESTRA como divergente, no se importa sola. */
async function runReconcile(job: typeof calendarSyncJobs.$inferSelect): Promise<string | null> {
  const db = getRootDb();
  const conn = await db.select().from(calendarConnections).where(eq(calendarConnections.id, job.connectionId)).then((r) => r[0]);
  if (!conn) return null;
  const token = await accessTokenFor(conn);
  if (!token.ok) return token.error;
  const links = await db.select().from(calendarEventLinks).where(and(eq(calendarEventLinks.connectionId, conn.id), eq(calendarEventLinks.syncStatus, "sincronizada"))).limit(100);
  for (const l of links) {
    if (!l.googleEventId) continue;
    const ev = await getEvent(token.data, l.googleCalendarId, l.googleEventId);
    const [v] = await db.select({ scheduledAt: visits.scheduledAt, status: visits.status }).from(visits).where(eq(visits.id, l.visitId));
    let drift: string | null = null;
    if (!ev.ok && (ev.status === 404 || ev.status === 410)) drift = "El evento fue borrado en Google";
    else if (ev.ok && ev.data.status === "cancelled") drift = "El evento fue cancelado en Google";
    else if (ev.ok && v?.scheduledAt && ev.data.start?.dateTime && new Date(ev.data.start.dateTime).getTime() !== v.scheduledAt.getTime()) drift = "El horario cambió en Google";
    if (drift) {
      await db.update(calendarEventLinks).set({ syncStatus: "divergente", lastError: drift, updatedAt: new Date() }).where(eq(calendarEventLinks.id, l.id));
    } else if (ev.ok) {
      await db.update(calendarEventLinks).set({ etag: ev.data.etag ?? l.etag, lastSyncedAt: new Date() }).where(eq(calendarEventLinks.id, l.id));
    }
  }
  return null;
}

/** Toma trabajos vencidos con lease (SKIP LOCKED): dos procesos nunca ejecutan el mismo. */
export async function processDueJobs(limit = 20): Promise<{ done: number; failed: number }> {
  const db = getRootDb();
  const claimed = await db.execute<typeof calendarSyncJobs.$inferSelect & Record<string, unknown>>(sql`
    update calendar_sync_jobs set status = 'running', attempts = attempts + 1, lease_until = now() + ${`${LEASE_MS} milliseconds`}::interval, updated_at = now()
    where id in (
      select id from calendar_sync_jobs
      where (status = 'pending' and run_after <= now()) or (status = 'running' and lease_until < now() and attempts < ${MAX_ATTEMPTS})
      order by run_after limit ${limit} for update skip locked
    )
    returning id, organization_id as "organizationId", connection_id as "connectionId", visit_id as "visitId", kind, attempts
  `);
  let done = 0;
  let failed = 0;
  for (const job of claimed as unknown as (typeof calendarSyncJobs.$inferSelect)[]) {
    let error: string | null = null;
    try {
      error = job.kind === "delete" ? await runDelete(job) : job.kind === "reconcile" ? await runReconcile(job) : await runUpsert(job);
    } catch (e) {
      error = safeError(e).slice(0, 300);
    }
    if (!error) {
      await db.update(calendarSyncJobs).set({ status: "done", lastError: null, leaseUntil: null, updatedAt: new Date() }).where(eq(calendarSyncJobs.id, job.id));
      done++;
      continue;
    }
    failed++;
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    const delayMin = Math.min(2 ** job.attempts, 60);
    await db
      .update(calendarSyncJobs)
      .set({ status: exhausted ? "error" : "pending", lastError: error.slice(0, 300), leaseUntil: null, runAfter: new Date(Date.now() + delayMin * 60_000), updatedAt: new Date() })
      .where(eq(calendarSyncJobs.id, job.id));
    if (exhausted) {
      await reportIncident({ organizationId: job.organizationId, module: "visitas", key: `gcal:${job.connectionId}`, message: "No se pudo sincronizar una visita con Google Calendar", detail: error, severity: "advertencia" });
    }
  }
  return { done, failed };
}

// ─── Canales de notificación ────────────────────────────────────────────────

const WATCH_TTL_S = 6 * 24 * 3600;

/** Crea o renueva (antes de que venza) el canal de notificaciones del calendario de destino. */
export async function ensureWatchChannels(origin: string): Promise<{ created: number }> {
  if (!origin.startsWith("https://")) return { created: 0 }; // Google solo notifica a HTTPS público
  const db = getRootDb();
  const conns = await db.select().from(calendarConnections).where(eq(calendarConnections.status, "active"));
  let created = 0;
  for (const c of conns) {
    if (!c.destinationCalendarId) continue;
    const [ch] = await db.select().from(calendarWatchChannels).where(and(eq(calendarWatchChannels.connectionId, c.id), eq(calendarWatchChannels.calendarId, c.destinationCalendarId)));
    if (ch && ch.expiresAt.getTime() - Date.now() > 24 * 3600_000) continue;
    const token = await accessTokenFor(c);
    if (!token.ok) continue;
    const secret = createHash("sha256").update(`${c.id}:${Math.random()}:${Date.now()}`).digest("hex");
    const channelId = `ghl-${c.id}-${Date.now().toString(36)}`;
    const res = await watchEvents(token.data, c.destinationCalendarId, { channelId, address: `${origin}/api/webhooks/google-calendar`, token: secret, ttlSeconds: WATCH_TTL_S });
    if (!res.ok) continue;
    if (ch) await db.delete(calendarWatchChannels).where(eq(calendarWatchChannels.id, ch.id));
    await db.insert(calendarWatchChannels).values({
      organizationId: c.organizationId,
      connectionId: c.id,
      calendarId: c.destinationCalendarId,
      channelId,
      resourceId: res.data.resourceId,
      tokenHash: sha256(secret),
      expiresAt: res.data.expiration ? new Date(Number(res.data.expiration)) : new Date(Date.now() + WATCH_TTL_S * 1000),
    });
    created++;
  }
  return { created };
}

/** Valida una notificación de Google y, si es auténtica, encola una conciliación. Siempre barata: Google reintenta. */
export async function handleGoogleNotification(headers: Headers): Promise<void> {
  const channelId = headers.get("x-goog-channel-id");
  const token = headers.get("x-goog-channel-token");
  const state = headers.get("x-goog-resource-state");
  if (!channelId || !token || state === "sync") return;
  const db = getRootDb();
  const [ch] = await db.select().from(calendarWatchChannels).where(eq(calendarWatchChannels.channelId, channelId));
  if (!ch) return;
  const a = Buffer.from(sha256(token));
  const b = Buffer.from(ch.tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return;
  // La notificación no trae el evento: solo avisa que hubo cambios. Una conciliación por minuto y conexión alcanza.
  await db
    .insert(calendarSyncJobs)
    .values({ organizationId: ch.organizationId, connectionId: ch.connectionId, kind: "reconcile", idempotencyKey: `reconcile:${ch.connectionId}:${Math.floor(Date.now() / 60_000)}` })
    .onConflictDoNothing();
}

export { getConnection };
