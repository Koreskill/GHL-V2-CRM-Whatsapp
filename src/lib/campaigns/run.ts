import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { campaignBatches, campaignRecipients, channelAccounts } from "@/db/schema";
import { canAutomate } from "@/lib/agency/lifecycle";
import { deliverMessage } from "@/lib/inbox/deliver";
import { reportIncident } from "@/lib/incidents/report";
import { safeError } from "@/lib/safe-error";
import { sendingEnabled } from "./batches";
import { personalizeParams } from "./cost";

// Envío de una campaña, un TRAMO por vez, desde la cola persistente (jobs). Reglas:
// - Cada destinatario se reclama con FOR UPDATE SKIP LOCKED (pendiente -> enviando): dos tramos a la vez
//   nunca le escriben dos veces a la misma persona.
// - La clave de idempotencia es `campaign:<destinatario>`: un reintento (o un tramo retomado después de
//   un reinicio) reutiliza el mensaje y Zernio, que guarda la clave 24 h, no vuelve a mandarlo.
// - Fallo transitorio del proveedor: hasta MAX_ATTEMPTS con espera creciente; los definitivos (plantilla
//   inexistente, conversación ajena) van directo a 'fallido'.
// - Antes de cada tramo: la inmobiliaria activa, la cuenta conectada y el lote en 'enviando'. Si no, se
//   detiene (pausa con motivo visible), nunca envía "a ciegas".
// - Si el contacto está chateando en este momento (mensaje entrante hace minutos), se posterga: una
//   promoción en medio de una conversación con el bot pisa la respuesta.

const CHUNK = 20;
const PAUSE_MS = 250; // ~4 por segundo y a destinatarios distintos: lejos de los límites de Zernio/Meta
const SLICE_BUDGET_MS = 4 * 60_000; // por debajo del lease del trabajo (10 min)
const MAX_ATTEMPTS = 3;
const STUCK_MS = 5 * 60_000;
const BUSY_WINDOW_MIN = 10;
const BUSY_DEFER_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEFINITIVE = new Set(["not_found", "invalid_template", "empty"]);

export type SliceResult = { next: Date | null; summary: Record<string, number | string> };

export async function runCampaignSlice(orgId: string, batchId: string): Promise<SliceResult> {
  const db = getDb();
  const started = Date.now();

  // Programada que todavía no llegó su hora (la reprogramaron para más tarde): se espera, no arranca.
  const [pre] = await db
    .select({ status: campaignBatches.status, scheduledAt: campaignBatches.scheduledAt })
    .from(campaignBatches)
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId)));
  if (pre?.status === "programada" && pre.scheduledAt && pre.scheduledAt.getTime() > Date.now() + 30_000) {
    return { next: pre.scheduledAt, summary: { waiting: "programada" } };
  }

  // Programada que llegó su hora: pasa a enviando. Solo desde estados que pueden arrancar.
  const [batch] = await db
    .update(campaignBatches)
    .set({ status: "enviando", startedAt: sql`coalesce(${campaignBatches.startedAt}, now())`, updatedAt: sql`now()` })
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), sql`${campaignBatches.status} in ('programada', 'enviando')`))
    .returning();
  if (!batch) return { next: null, summary: { stopped: "estado" } };
  // El interruptor del servidor manda también a mitad de camino, no solo al apretar "enviar".
  if (!sendingEnabled()) {
    await db
      .update(campaignBatches)
      .set({ status: "pausada", pausedAt: new Date(), updatedAt: sql`now()` })
      .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), eq(campaignBatches.status, "enviando")));
    return { next: null, summary: { stopped: "envío deshabilitado en el servidor" } };
  }

  const stop = async (reason: string) => {
    await db
      .update(campaignBatches)
      .set({ status: "pausada", pausedAt: new Date(), updatedAt: sql`now()` })
      .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), eq(campaignBatches.status, "enviando")));
    await reportIncident({
      organizationId: orgId,
      module: "campanas",
      key: `pausada:${batchId}`,
      severity: "advertencia",
      message: `La campaña "${batch.name}" se pausó sola: ${reason}`,
    });
    return { next: null, summary: { stopped: reason } };
  };

  if (!(await canAutomate(orgId))) return stop("la inmobiliaria no está activa");
  if (batch.channelAccountId) {
    const [account] = await db
      .select({ status: channelAccounts.status })
      .from(channelAccounts)
      .where(and(eq(channelAccounts.id, batch.channelAccountId), eq(channelAccounts.organizationId, orgId)));
    if (!account || account.status !== "connected") return stop("la cuenta emisora está desconectada");
  }

  // Destinatarios que quedaron "enviando" por un tramo que murió: vuelven a pendiente. Es seguro porque
  // la clave de idempotencia evita el doble envío.
  await db.execute(sql`
    update campaign_recipients set status = 'pendiente', updated_at = now()
    where batch_id = ${batchId} and organization_id = ${orgId} and status = 'enviando'
      and updated_at < now() - (${STUCK_MS / 1000} * interval '1 second')
  `);

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let omitted = 0;
  while (Date.now() - started < SLICE_BUDGET_MS) {
    // Pausada o cancelada a mitad de camino: deja de tomar destinatarios nuevos.
    const [current] = await db
      .select({ status: campaignBatches.status })
      .from(campaignBatches)
      .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId)));
    if (!current || current.status !== "enviando") return { next: null, summary: { sent, failed, deferred, omitted, stopped: current?.status ?? "borrado" } };

    const claimed = await db.execute<{ id: string; conversation_id: string; contact_id: string; name: string | null; attempts: number; opted_out: boolean; busy: boolean }>(sql`
      update campaign_recipients r set status = 'enviando', attempts = r.attempts + 1, updated_at = now()
      where r.id in (
        select id from campaign_recipients
        where batch_id = ${batchId} and organization_id = ${orgId} and status = 'pendiente'
          and (next_attempt_at is null or next_attempt_at <= now())
        order by created_at limit ${CHUNK} for update skip locked
      )
      returning r.id, r.conversation_id, r.contact_id, r.attempts,
        (select coalesce(c.name, cv.participant_name) from contacts c, conversations cv
          where c.id = r.contact_id and cv.id = r.conversation_id) as name,
        (select c.marketing_opt_out_at is not null from contacts c where c.id = r.contact_id) as opted_out,
        exists (select 1 from messages i where i.conversation_id = r.conversation_id and i.direction = 'inbound'
          and i.sent_at > now() - (${BUSY_WINDOW_MIN} * interval '1 minute')) as busy
    `);
    if (!claimed.length) break;

    for (const r of claimed) {
      const mark = (patch: Partial<typeof campaignRecipients.$inferInsert>) =>
        db.update(campaignRecipients).set({ ...patch, updatedAt: new Date() }).where(eq(campaignRecipients.id, r.id));

      // Pidió la baja DESPUÉS de congelar la audiencia: no se le manda.
      if (r.opted_out) {
        await mark({ status: "omitido", error: "Pidió no recibir mensajes comerciales" });
        omitted++;
        continue;
      }
      if (r.busy) {
        await mark({ status: "pendiente", attempts: Math.max(0, r.attempts - 1), nextAttemptAt: new Date(Date.now() + BUSY_DEFER_MS) });
        deferred++;
        continue;
      }
      const params = personalizeParams(batch.params, r.name);
      if (!params) {
        await mark({ status: "fallido", error: "Una variable quedó vacía" });
        failed++;
        continue;
      }
      let res: Awaited<ReturnType<typeof deliverMessage>>;
      try {
        res = await deliverMessage(r.conversation_id, {
          source: "campaign",
          organizationId: orgId,
          idempotencyKey: `campaign:${r.id}`,
          template: { name: batch.templateName, language: batch.templateLanguage, params },
        });
      } catch (err) {
        res = { ok: false, code: "send_failed", error: safeError(err) };
      }
      if (res.ok) {
        await mark({ status: "enviado", messageId: res.message.id, sentAt: new Date(), error: null, nextAttemptAt: null });
        sent++;
      } else if (res.code === "org_inactive") {
        await mark({ status: "pendiente", attempts: Math.max(0, r.attempts - 1) });
        return stop("la inmobiliaria no está activa");
      } else if (DEFINITIVE.has(res.code) || r.attempts >= MAX_ATTEMPTS) {
        await mark({ status: "fallido", error: res.error.slice(0, 300), messageId: res.message?.id ?? null });
        failed++;
      } else {
        await mark({ status: "pendiente", error: res.error.slice(0, 300), nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** r.attempts) });
        deferred++;
      }
      await sleep(PAUSE_MS);
    }
  }

  // ¿Queda algo? Si hay pendientes listos, el próximo tramo arranca ya; si solo hay postergados, cuando venzan.
  const [left] = await db.execute<{ ready: number; waiting: number; next_at: string | null; inflight: number }>(sql`
    select
      count(*) filter (where status = 'pendiente' and (next_attempt_at is null or next_attempt_at <= now()))::int as ready,
      count(*) filter (where status = 'pendiente' and next_attempt_at > now())::int as waiting,
      min(next_attempt_at) filter (where status = 'pendiente' and next_attempt_at > now())::text as next_at,
      count(*) filter (where status = 'enviando')::int as inflight
    from campaign_recipients where batch_id = ${batchId} and organization_id = ${orgId}
  `);

  const totals = await db.execute<{ enviado: number; fallido: number }>(sql`
    select count(*) filter (where status = 'enviado')::int as enviado, count(*) filter (where status = 'fallido')::int as fallido
    from campaign_recipients where batch_id = ${batchId} and organization_id = ${orgId}
  `);
  const done = left.ready === 0 && left.waiting === 0 && left.inflight === 0;
  await db
    .update(campaignBatches)
    .set({
      sentCount: totals[0].enviado,
      failedCount: totals[0].fallido,
      ...(done ? { status: "completada", completedAt: new Date() } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), eq(campaignBatches.status, "enviando")));

  const summary = { sent, failed, deferred, omitted };
  if (done) return { next: null, summary };
  if (left.ready > 0) return { next: new Date(Date.now() + 1_000), summary };
  // Solo quedan los de un tramo que murió a mitad: se retoman cuando su reclamo vence.
  if (left.inflight > 0 && left.waiting === 0) return { next: new Date(Date.now() + STUCK_MS), summary };
  return { next: left.next_at ? new Date(left.next_at) : new Date(Date.now() + 60_000), summary };
}
