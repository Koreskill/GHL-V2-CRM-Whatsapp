import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { campaignBatches, campaignRecipients, channelAccounts } from "@/db/schema";
import { contactFiltersToParams, parseContactFilters, type ContactFilters } from "@/lib/crm/contact-filters";
import { audienceWhere, normalizeSources, type AudienceSources } from "@/lib/crm/groups";
import { enqueue } from "@/lib/jobs/queue";
import { estimateCost, splitAudience, type AudienceRow } from "./cost";

export type Batch = typeof campaignBatches.$inferSelect;

// Estados de un lote:
//   estimada → confirmada (audiencia CONGELADA) → programada | enviando ⇄ pausada → completada
//   cualquiera sin terminar → cancelada (lo pendiente queda 'omitido')
// El envío lo hace la cola persistente (campaigns/run.ts): sobrevive a reinicios y no duplica.

const MAX_AUDIENCE = 5000;

/**
 * Público: contactos que cumplen la audiencia, con su conversación de WhatsApp EN LA CUENTA EMISORA
 * (la más reciente). Sin cuenta elegida se toma la conversación de WhatsApp más reciente de cualquier cuenta.
 */
export async function loadAudience(
  orgId: string,
  input: { filters: ContactFilters; sources: AudienceSources; channelAccountId: string | null },
): Promise<AudienceRow[]> {
  const where = await audienceWhere(orgId, input.sources, input.filters);
  const account = input.channelAccountId ? sql`and channel_account_id = ${input.channelAccountId}` : sql``;
  const rows = await getDb().execute<{ id: string; name: string | null; conversation_id: string | null; fallback: string | null; opted_out: boolean }>(sql`
    select c.id, c.name, cv.id as conversation_id, cv.participant_name as fallback, (c.marketing_opt_out_at is not null) as opted_out
    from contacts c
    left join lateral (
      select id, participant_name from conversations
      where contact_id = c.id and organization_id = ${orgId} and channel = 'whatsapp' and status <> 'archivada'
        and coalesce(metadata->>'delegation', '') = '' ${account}
      order by last_message_at desc nulls last limit 1
    ) cv on true
    where ${where} and c.anonymized_at is null
    order by c.created_at
    limit ${MAX_AUDIENCE}
  `);
  return rows.map((r) => ({ contactId: r.id, name: r.name ?? r.fallback, conversationId: r.conversation_id, optedOut: r.opted_out }));
}

/** Cuentas de WhatsApp de la inmobiliaria que pueden emitir. */
export async function senderAccounts(orgId: string) {
  return getDb()
    .select({ id: channelAccounts.id, name: channelAccounts.name, handle: channelAccounts.handle, status: channelAccounts.status })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.organizationId, orgId), eq(channelAccounts.channel, "whatsapp")));
}

async function ownedAccount(orgId: string, id: string | null) {
  if (!id) return null;
  const [row] = await getDb()
    .select({ id: channelAccounts.id, status: channelAccounts.status })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, id), eq(channelAccounts.organizationId, orgId), eq(channelAccounts.channel, "whatsapp")));
  return row ?? null;
}

export type EstimateInput = {
  orgId: string;
  userId: string;
  name: string;
  channelAccountId: string | null;
  templateName: string;
  templateLanguage: string;
  params: string[];
  filters: ContactFilters;
  sources: AudienceSources;
  currency: string;
  unitPrice: number;
  taxPct: number;
  surchargePct: number;
};

/** Calcula y guarda la estimación. NO congela audiencia ni envía nada. */
export async function createEstimate(input: EstimateInput): Promise<{ ok: true; batch: Batch } | { ok: false; error: string }> {
  const account = await ownedAccount(input.orgId, input.channelAccountId);
  if (input.channelAccountId && !account) return { ok: false, error: "La cuenta emisora no es de esta inmobiliaria." };
  const sources = normalizeSources(input.sources);
  const audience = await loadAudience(input.orgId, { filters: input.filters, sources, channelAccountId: account?.id ?? null });
  const { eligible, excluded } = splitAudience(audience, input.params);
  const cost = estimateCost({ count: eligible.length, unitPrice: input.unitPrice, surchargePct: input.surchargePct, taxPct: input.taxPct });

  const [batch] = await getDb()
    .insert(campaignBatches)
    .values({
      organizationId: input.orgId,
      createdBy: input.userId,
      name: input.name,
      channel: "whatsapp",
      channelAccountId: account?.id ?? null,
      audience: sources,
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
  return { ok: true, batch };
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

/**
 * Progreso con los estados REALES que informa el canal. Un mensaje "aceptado" (Zernio lo tomó) no es
 * "entregado" (WhatsApp confirmó que llegó), y una respuesta no es una venta: se cuentan por separado.
 */
export async function batchProgress(orgId: string, batchId: string) {
  const [row] = await getDb().execute<{
    pendiente: number; enviando: number; omitido: number; fallido: number; aceptado: number; entregado: number; leido: number; fallo_canal: number; respondieron: number;
  }>(sql`
    select
      count(*) filter (where r.status = 'pendiente')::int as pendiente,
      count(*) filter (where r.status = 'enviando')::int as enviando,
      count(*) filter (where r.status = 'omitido')::int as omitido,
      count(*) filter (where r.status = 'fallido')::int as fallido,
      count(*) filter (where r.status = 'enviado')::int as aceptado,
      count(*) filter (where r.status = 'enviado' and m.status in ('delivered', 'read'))::int as entregado,
      count(*) filter (where r.status = 'enviado' and m.status = 'read')::int as leido,
      count(*) filter (where r.status = 'enviado' and m.status = 'failed')::int as fallo_canal,
      count(*) filter (where r.status = 'enviado' and exists (
        select 1 from messages i where i.conversation_id = r.conversation_id and i.organization_id = ${orgId}
          and i.direction = 'inbound' and i.sent_at > r.sent_at
      ))::int as respondieron
    from campaign_recipients r
    left join messages m on m.id = r.message_id
    where r.batch_id = ${batchId} and r.organization_id = ${orgId}
  `);
  return row;
}

/** Destinatarios congelados (para revisar a quién se le manda). */
export async function listRecipients(orgId: string, batchId: string, limit = 200) {
  return getDb().execute<{ id: string; name: string | null; status: string; error: string | null; message_status: string | null; sent_at: string | null }>(sql`
    select r.id, coalesce(c.name, cv.participant_name) as name, r.status, r.error, m.status::text as message_status, r.sent_at::text
    from campaign_recipients r
    join contacts c on c.id = r.contact_id and c.organization_id = ${orgId}
    join conversations cv on cv.id = r.conversation_id and cv.organization_id = ${orgId}
    left join messages m on m.id = r.message_id
    where r.batch_id = ${batchId} and r.organization_id = ${orgId}
    order by r.created_at limit ${limit}
  `);
}

/**
 * Congela la audiencia: la vuelve a calcular AHORA y la guarda, destinatario por destinatario. Desde acá
 * el lote envía a esta lista y no a "lo que cumpla el filtro en ese momento": un contacto agregado al
 * grupo después NO entra, y uno que pidió la baja después se omite al enviar. Condicional (solo desde
 * 'estimada'): un doble clic no congela dos veces.
 */
export async function freezeAndConfirm(orgId: string, userId: string, batchId: string, typedCount: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const batch = await getBatch(orgId, batchId);
  if (!batch) return { ok: false, error: "No se encontró el lote." };
  if (batch.status !== "estimada") return { ok: false, error: "Este lote ya fue confirmado." };

  const audience = await loadAudience(orgId, {
    filters: parseContactFilters(batch.filters),
    sources: normalizeSources(batch.audience),
    channelAccountId: batch.channelAccountId,
  });
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

export const campaignJobKey = (batchId: string) => `campaign:${batchId}`;

/**
 * Programa o inicia el envío. `at` en el futuro = programada; si no, arranca ya. El trabajo va a la cola
 * persistente: un reinicio del servidor no lo pierde.
 */
export async function startBatch(orgId: string, batchId: string, at: Date | null): Promise<{ ok: true; scheduled: boolean } | { ok: false; error: string }> {
  const batch = await getBatch(orgId, batchId);
  if (!batch) return { ok: false, error: "No se encontró el lote." };
  if (batch.status !== "confirmada" && batch.status !== "programada") return { ok: false, error: "El lote no está listo para enviar." };
  if (batch.channelAccountId) {
    const account = await ownedAccount(orgId, batch.channelAccountId);
    if (!account || account.status !== "connected") return { ok: false, error: "La cuenta emisora está desconectada: reconectala antes de enviar." };
  }
  const scheduled = Boolean(at && at.getTime() > Date.now() + 60_000);
  const [row] = await getDb()
    .update(campaignBatches)
    .set({ status: scheduled ? "programada" : "enviando", scheduledAt: scheduled ? at : null, updatedAt: sql`now()` })
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), sql`${campaignBatches.status} in ('confirmada', 'programada')`))
    .returning({ id: campaignBatches.id });
  if (!row) return { ok: false, error: "El lote cambió de estado: recargá la página." };
  const runAfter = scheduled ? at! : new Date();
  await enqueue({ organizationId: orgId, kind: "campaign", dedupeKey: campaignJobKey(batchId), payload: { batchId }, runAfter, requeueFinished: true });
  // Si ya había un trabajo en cola (estaba programada y se reprogramó), se mueve su hora.
  await getDb().execute(sql`
    update jobs set run_after = ${runAfter.toISOString()}::timestamptz, updated_at = now()
    where dedupe_key = ${campaignJobKey(batchId)} and status in ('queued', 'failed')
  `);
  return { ok: true, scheduled };
}

/** Pausar: deja de tomar destinatarios nuevos en el próximo tramo (el que está saliendo termina). */
export async function pauseBatch(orgId: string, batchId: string) {
  await getDb()
    .update(campaignBatches)
    .set({ status: "pausada", pausedAt: new Date(), updatedAt: sql`now()` })
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), sql`${campaignBatches.status} in ('enviando', 'programada')`));
}

export async function resumeBatch(orgId: string, batchId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await getDb()
    .update(campaignBatches)
    .set({ status: "enviando", pausedAt: null, updatedAt: sql`now()` })
    .where(and(eq(campaignBatches.id, batchId), eq(campaignBatches.organizationId, orgId), eq(campaignBatches.status, "pausada")))
    .returning({ id: campaignBatches.id });
  if (!row) return { ok: false, error: "El lote no está pausado." };
  await enqueue({ organizationId: orgId, kind: "campaign", dedupeKey: campaignJobKey(batchId), payload: { batchId }, requeueFinished: true });
  return { ok: true };
}

/** Cancelar: lo que no salió queda 'omitido' (visible), no se borra. */
export async function cancelBatch(orgId: string, batchId: string) {
  const [row] = await getDb()
    .update(campaignBatches)
    .set({ status: "cancelada", updatedAt: sql`now()` })
    .where(
      and(
        eq(campaignBatches.id, batchId),
        eq(campaignBatches.organizationId, orgId),
        sql`${campaignBatches.status} in ('estimada', 'confirmada', 'programada', 'enviando', 'pausada')`,
      ),
    )
    .returning({ id: campaignBatches.id });
  if (!row) return;
  await getDb()
    .update(campaignRecipients)
    .set({ status: "omitido", error: "Campaña cancelada", updatedAt: sql`now()` })
    .where(and(eq(campaignRecipients.batchId, batchId), eq(campaignRecipients.organizationId, orgId), eq(campaignRecipients.status, "pendiente")));
}

export const sendingEnabled = () => process.env.CAMPAIGNS_SEND_ENABLED === "true";

export const BATCH_STATUS_LABEL: Record<string, string> = {
  estimada: "Estimada",
  confirmada: "Confirmada",
  programada: "Programada",
  enviando: "Enviando",
  pausada: "Pausada",
  completada: "Completada",
  cancelada: "Cancelada",
};
