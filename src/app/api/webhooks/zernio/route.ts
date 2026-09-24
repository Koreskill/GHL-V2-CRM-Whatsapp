import { after } from "next/server";
import { getDb } from "@/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { claimEvent, listStuckEvents, processEvent } from "@/lib/inbox/webhook-events";
import type { IngestResult } from "@/lib/inbox/ingest";
import { safeError } from "@/lib/safe-error";
import type { ZernioWebhookPayload } from "@/lib/zernio/types";
import { EVENT_HEADER, EVENT_ID_HEADER, SIGNATURE_HEADER, verifyZernioSignature } from "@/lib/zernio/webhooks";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

const ok = (body: Record<string, unknown> = { ok: true }) => Response.json(body, { status: 200 });

function scheduleAgent(result: IngestResult | null) {
  if (result?.kind === "account" && result.status === "connected") {
    const { accountExternalId } = result;
    after(async () => {
      // Historial que Zernio ya tenía: se importa sin disparar el agente.
      const [{ importAccountHistory }, { channelAccounts }, { eq }] = await Promise.all([
        import("@/lib/inbox/import"),
        import("@/db/schema"),
        import("drizzle-orm"),
      ]);
      const db = getDb();
      const [account] = await db.select().from(channelAccounts).where(eq(channelAccounts.externalId, accountExternalId));
      if (!account) return;
      const r = await importAccountHistory(db, account).catch((err: unknown) => ({ error: safeError(err) }));
      console.log(`[import] ${account.channel}:`, "error" in r ? r.error : `${r.conversations} conversaciones, ${r.messages} mensajes`);
    });
    return;
  }
  if (result?.kind !== "message" || !result.inbound || !result.inserted || !result.messageId) return;
  const { conversationId, messageId } = result;
  after(async () => {
    // Import dinámico: el grafo del agente no entra en el cold start del webhook.
    // Triaje: Jev clasifica, el código enruta y GPT redacta. La idempotencia la garantiza
    // el índice único de message_triage sobre message_id, no este bloque.
    const { triageIncomingMessage } = await import("@/lib/agent/triage/run");
    const outcome = await triageIncomingMessage(conversationId, { triggerMessageId: messageId }).catch(
      (err: unknown) => ({ status: "error" as const, error: safeError(err) }),
    );
    // Sin el texto del mensaje ni lo que escribió el modelo: solo el resultado.
    console.log(`[triaje] ${conversationId}:`, outcome);
  });
}

export async function POST(req: Request) {
  const receivedAt = Date.now();
  // Un evento de Zernio pesa unos KB: un body gigante es abuso, se corta antes de leerlo.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  // 1. Body CRUDO y firma. Re-serializar el JSON rompería la firma.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 });
  if (!verifyZernioSignature(raw, req.headers.get(SIGNATURE_HEADER))) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: ZernioWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.warn("[zernio] body firmado pero no es JSON");
    return ok({ ok: true, ignored: "invalid_json" });
  }

  const eventId = payload.id ?? req.headers.get(EVENT_ID_HEADER);
  const eventType = payload.event ?? req.headers.get(EVENT_HEADER) ?? "unknown";
  if (!eventId) return ok({ ok: true, ignored: "missing_event_id" });

  // 2. Reclamar el evento. Si ya estaba, es un reintento: 200 y cortar.
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
    const claimed = await claimEvent(db, { eventId, eventType, payload });
    if (!claimed) return ok({ ok: true, duplicate: true });
  } catch (err) {
    // Sin poder reclamar no hay idempotencia: que Zernio reintente.
    console.error(`[zernio] no se pudo reclamar el evento: ${safeError(err)}`);
    return Response.json({ error: "storage_unavailable" }, { status: 503 });
  }

  // 3-4. Rutear por cuenta, resolver contacto, conversación y mensaje (INSERTs, inline).
  const result = await processEvent(db, eventId, payload);

  if (payload.event === "message.received") {
    const sourceAt = Date.parse(payload.timestamp);
    console.info("[zernio] mensaje entrante", {
      eventId,
      sourceToWebhookMs: Number.isFinite(sourceAt) ? receivedAt - sourceAt : null,
      ingestMs: Date.now() - receivedAt,
      ingested: result?.kind === "message" && result.inserted,
    });
  }

  // 5. El agente, después de responder.
  scheduleAgent(result);

  // 6. 200 siempre: un evento desconocido o que falló queda para el barrido, no para un 500.
  return ok({ ok: true, result: result?.kind ?? "deferred" });
}

// Barrido: levanta eventos reclamados que nunca se terminaron de procesar.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  const stuck = await listStuckEvents(db);
  const summary = { found: stuck.length, processed: 0, failed: 0 };
  for (const event of stuck) {
    const result = await processEvent(db, event.eventId, event.payload as ZernioWebhookPayload);
    if (result) {
      summary.processed++;
      scheduleAgent(result);
    } else {
      summary.failed++;
    }
  }
  return ok(summary);
}
