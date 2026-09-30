import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { campaignBatches, campaignRecipients } from "@/db/schema";
import { contactFiltersToParams, contactWhere, parseContactFilters, type ContactFilters } from "@/lib/crm/contact-filters";
import { deliverMessage } from "@/lib/inbox/deliver";
import { safeError } from "@/lib/safe-error";
import { estimateCost, personalizeParams, splitAudience, type AudienceRow } from "./cost";

export type Batch = typeof campaignBatches.$inferSelect;

const MAX_AUDIENCE = 5000;
const CHUNK = 20;
const PAUSE_MS = 250; // ~4 por segundo: lejos de los límites de Zernio y sin ráfagas

/** Público de un filtro: los contactos que lo cumplen, con su conversación de WhatsApp más reciente. */
export async function loadAudience(orgId: string, filters: ContactFilters): Promise<AudienceRow[]> {
  const rows = await getDb().execute<{ id: string; name: string | null; conversation_id: string | null; fallback: string | null }>(sql`
    select c.id, c.name, cv.id as conversation_id, cv.participant_name as fallback
    from contacts c
    left join lateral (
      select id, participant_name from conversations
      where contact_id = c.id and organization_id = ${orgId} and channel = 'whatsapp'
      order by last_message_at desc nulls last limit 1
    ) cv on true
    where ${contactWhere(orgId, filters)}
    order by c.created_at
    limit ${MAX_AUDIENCE}
  `);
  return rows.map((r) => ({ contactId: r.id, name: r.name ?? r.fallback, conversationId: r.conversation_id }));
}

export type EstimateInput = {
  orgId: string;
  userId: string;
  name: string;
  templateName: string;
  templateLanguage: string;
  params: string[];
  filters: ContactFilters;
  currency: string;
  unitPrice: number;
  taxPct: number;
  surchargePct: number;
};

/** Calcula y guarda la estimación. NO congela audiencia ni envía nada. */
export async function createEstimate(input: EstimateInput): Promise<Batch> {
  const audience = await loadAudience(input.orgId, input.filters);
  const { eligible, excluded } = splitAudience(audience, input.params);
  const cost = estimateCost({ count: eligible.length, unitPrice: input.unitPrice, surchargePct: input.surchargePct, taxPct: input.taxPct });

  const [batch] = await getDb()
    .insert(campaignBatches)
    .values({
      organizationId: input.orgId,
      createdBy: input.userId,
      name: input.name,
      channel: "whatsapp",
      templateName: input.templateName,
      templateLanguage: input.templateLanguage,
      params: input.params,
      filters: Object.fromEntries(contactFiltersToParams(input.filters)),
      status: "estimada",
      audienceCount: eligible.length,
      excluded,
      currency: input.currency,
      unitPrice: String(input.unitPrice),
      taxPct: String(input.taxPct),
      surchargePct: String(input.surchargePct),
      rateSource: "manual",
      rateDate: new Date(),
      estimatedTotal: String(cost.total),
    })
    .returning();
  return batch;
}

export async function getBatch(orgId: string, batchId: string): Promise<Batch | null> {
  const [row] = await getDb()
    .select()
    .from(campaignBatches)
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId)));
  return row ?? null;
}

export const listBatches = (orgId: string) =>
  getDb().select().from(campaignBatches).where(eq(campaignBatches.organizationId, orgId)).orderBy(desc(campaignBatches.createdAt)).limit(50);

export async function batchProgress(orgId: string, batchId: string) {
  const rows = await getDb().execute<{ status: string; n: number }>(sql`
    select status, count(*)::int as n from campaign_recipients
    where batch_id = ${batchId} and organization_id = ${orgId} group by status
  `);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

/**
 * Congela la audiencia: vuelve a calcularla AHORA y la guarda, recipient por recipient. Desde acá el
 * lote envía a esta lista y no a "lo que cumpla el filtro en ese momento". El cambio de estado es
 * condicional (solo desde 'estimada'), así un doble clic no congela dos veces.
 */
export async function freezeAndConfirm(orgId: string, userId: string, batchId: string, typedCount: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const batch = await getBatch(orgId, batchId);
  if (!batch) return { ok: false, error: "No se encontró el lote." };
  if (batch.status !== "estimada") return { ok: false, error: "Este lote ya fue confirmado." };

  const audience = await loadAudience(orgId, parseContactFilters(batch.filters));
  const { eligible, excluded } = splitAudience(audience, batch.params);
  // La audiencia cambió desde la estimación: no se confirma a ciegas, se vuelve a estimar.
  if (eligible.length !== batch.audienceCount) {
    return { ok: false, error: `La audiencia cambió (antes ${batch.audienceCount}, ahora ${eligible.length}). Hacé una estimación nueva.` };
  }
  if (typedCount !== eligible.length) return { ok: false, error: "La cantidad escrita no coincide con la audiencia." };
  if (eligible.length === 0) return { ok: false, error: "No hay destinatarios elegibles." };

  const claimed = await db
    .update(campaignBatches)
    .set({ status: "confirmada", confirmedBy: userId, confirmedAt: new Date(), excluded, updatedAt: sql`now()` })
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), eq(campaignBatches.status, "estimada")))
    .returning({ id: campaignBatches.id });
  if (!claimed.length) return { ok: false, error: "Este lote ya fue confirmado." };

  for (let i = 0; i < eligible.length; i += 500) {
    await db
      .insert(campaignRecipients)
      .values(eligible.slice(i, i + 500).map((r) => ({ organizationId: orgId, batchId, contactId: r.contactId, conversationId: r.conversationId })))
      .onConflictDoNothing({ target: [campaignRecipients.batchId, campaignRecipients.contactId] });
  }
  return { ok: true };
}

export async function cancelBatch(orgId: string, batchId: string) {
  await getDb()
    .update(campaignBatches)
    .set({ status: "cancelada", updatedAt: sql`now()` })
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), sql`${campaignBatches.status} in ('estimada','confirmada','enviando')`));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envía el lote por el único camino de salida (deliverMessage). Cada destinatario se RECLAMA con
 * una actualización condicional (pendiente -> enviando) y FOR UPDATE SKIP LOCKED: dos corridas a la
 * vez no le escriben dos veces a la misma persona. Se puede reanudar: toma solo los pendientes.
 */
export async function runBatch(orgId: string, batchId: string): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  const started = await db
    .update(campaignBatches)
    .set({ status: "enviando", updatedAt: sql`now()` })
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), sql`${campaignBatches.status} in ('confirmada','enviando')`))
    .returning();
  const batch = started[0];
  if (!batch) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (;;) {
    // Un lote cancelado a mitad de camino deja de enviar.
    const current = await getBatch(orgId, batchId);
    if (!current || current.status !== "enviando") break;

    const claimed = await db.execute<{ id: string; conversation_id: string; contact_id: string; name: string | null }>(sql`
      update campaign_recipients r set status = 'enviando', updated_at = now()
      where r.id in (
        select id from campaign_recipients
        where batch_id = ${batchId} and organization_id = ${orgId} and status = 'pendiente'
        order by created_at limit ${CHUNK} for update skip locked
      )
      returning r.id, r.conversation_id, r.contact_id,
        (select coalesce(c.name, cv.participant_name) from contacts c, conversations cv
          where c.id = r.contact_id and cv.id = r.conversation_id) as name
    `);
    if (!claimed.length) break;

    for (const r of claimed) {
      const params = personalizeParams(batch.params, r.name);
      let outcome: { ok: true; messageId: string } | { ok: false; error: string };
      if (!params) outcome = { ok: false, error: "Una variable quedó vacía" };
      else {
        try {
          const res = await deliverMessage(r.conversation_id, {
            source: "human",
            organizationId: orgId,
            template: { name: batch.templateName, language: batch.templateLanguage, params },
          });
          outcome = res.ok ? { ok: true, messageId: res.message.id } : { ok: false, error: res.error };
        } catch (err) {
          outcome = { ok: false, error: safeError(err) };
        }
      }
      await db
        .update(campaignRecipients)
        .set(
          outcome.ok
            ? { status: "enviado", messageId: outcome.messageId, sentAt: new Date(), updatedAt: sql`now()` }
            : { status: "fallido", error: outcome.error.slice(0, 300), updatedAt: sql`now()` },
        )
        .where(eq(campaignRecipients.id, r.id));
      if (outcome.ok) sent++;
      else failed++;
      await sleep(PAUSE_MS);
    }
  }

  const progress = await batchProgress(orgId, batchId);
  const pending = (progress.pendiente ?? 0) + (progress.enviando ?? 0);
  await db
    .update(campaignBatches)
    .set({
      sentCount: progress.enviado ?? 0,
      failedCount: progress.fallido ?? 0,
      // Si quedaron pendientes es porque se canceló o se cortó: no se marca completado.
      ...(pending === 0 ? { status: "completada" } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), eq(campaignBatches.status, "enviando")));
  return { sent, failed };
}

export const sendingEnabled = () => process.env.CAMPAIGNS_SEND_ENABLED === "true";
