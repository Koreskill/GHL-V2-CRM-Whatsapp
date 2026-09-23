import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { webhookEvents } from "@/db/schema";
import type { ZernioWebhookPayload } from "@/lib/zernio/types";
import { ingestZernioEvent, type IngestResult } from "./ingest";

// INSERT ... ON CONFLICT DO NOTHING RETURNING: si no insertó, es un reintento.
export async function claimEvent(
  db: Db,
  event: { eventId: string; eventType: string; payload: unknown },
): Promise<boolean> {
  const rows = await db
    .insert(webhookEvents)
    .values({ eventId: event.eventId, provider: "zernio", eventType: event.eventType, payload: event.payload })
    .onConflictDoNothing()
    .returning({ eventId: webhookEvents.eventId });
  return rows.length > 0;
}

// Procesa un evento ya reclamado. Si falla, queda sin processed_at para que lo levante el barrido.
export async function processEvent(
  db: Db,
  eventId: string,
  payload: ZernioWebhookPayload,
): Promise<IngestResult | null> {
  try {
    // Todo o nada: si algo falla, el mensaje tampoco queda insertado y el barrido lo reintenta completo.
    const result = await db.transaction(async (tx) => {
      const r = await ingestZernioEvent(tx, payload);
      await tx
        .update(webhookEvents)
        .set({ processedAt: sql`now()`, error: r.kind === "ignored" ? r.reason : null })
        .where(eq(webhookEvents.eventId, eventId));
      return r;
    });
    if (result.kind === "ignored") console.warn(`[zernio] evento ${eventId} ignorado: ${result.reason}`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[zernio] fallo procesando ${eventId}:`, err);
    await db
      .update(webhookEvents)
      .set({ error: message.slice(0, 1000) })
      .where(eq(webhookEvents.eventId, eventId))
      .catch(() => {});
    return null;
  }
}

// Reclamados pero sin procesar: la red de seguridad para cuando el proceso murió a mitad de camino.
export async function listStuckEvents(db: Db, limit = 50) {
  return db
    .select({ eventId: webhookEvents.eventId, payload: webhookEvents.payload })
    .from(webhookEvents)
    .where(
      and(
        isNull(webhookEvents.processedAt),
        lt(webhookEvents.receivedAt, sql`now() - interval '2 minutes'`),
        gt(webhookEvents.receivedAt, sql`now() - interval '3 days'`),
      ),
    )
    .orderBy(asc(webhookEvents.receivedAt))
    .limit(limit);
}
