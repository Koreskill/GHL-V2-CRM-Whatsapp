import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, conversations, messageTriage, type TriageStatus } from "@/db/schema";

// Toda query lleva organizationId: el aislamiento entre inmobiliarias se hace acá.

export type TriageRow = {
  id: string;
  conversationId: string;
  messageId: string;
  contactName: string | null;
  intent: string | null;
  intentConfidence: number | null;
  intentProbabilities: Record<string, number>;
  containsVisitRequest: number | null;
  requiresHuman: number | null;
  urgency: string | null;
  route: string | null;
  routeReason: string | null;
  decisionModel: string | null;
  replyModel: string | null;
  draftText: string | null;
  internalSummary: string | null;
  missingInformation: string[];
  handoffReason: string | null;
  status: TriageStatus;
  error: string | null;
  createdAt: string;
};

const num = (v: string | null) => (v === null ? null : Number(v));

/** El último triaje de una conversación: lo que ve quien la abre. */
export async function getLatestTriage(conversationId: string, orgId: string): Promise<TriageRow | null> {
  const [r] = await getDb()
    .select({ t: messageTriage, contactName: contacts.name })
    .from(messageTriage)
    .innerJoin(conversations, eq(conversations.id, messageTriage.conversationId))
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(
      and(eq(messageTriage.conversationId, conversationId), eq(messageTriage.organizationId, orgId)),
    )
    .orderBy(desc(messageTriage.createdAt))
    .limit(1);
  if (!r) return null;

  return {
    id: r.t.id,
    conversationId: r.t.conversationId,
    messageId: r.t.messageId,
    contactName: r.contactName,
    intent: r.t.intent,
    intentConfidence: num(r.t.intentConfidence),
    intentProbabilities: r.t.intentProbabilities,
    containsVisitRequest: num(r.t.containsVisitRequest),
    requiresHuman: num(r.t.requiresHuman),
    urgency: r.t.urgency,
    route: r.t.route,
    routeReason: r.t.routeReason,
    decisionModel: r.t.decisionModel,
    replyModel: r.t.replyModel,
    draftText: r.t.draftText,
    internalSummary: r.t.internalSummary,
    missingInformation: r.t.missingInformation,
    handoffReason: r.t.handoffReason,
    status: r.t.status,
    error: r.t.error,
    createdAt: r.t.createdAt.toISOString(),
  };
}

/** Lo que espera a una persona: borradores por revisar y casos derivados. */
export async function listPendingTriage(orgId: string, limit = 50) {
  const rows = await getDb()
    .select({
      id: messageTriage.id,
      conversationId: messageTriage.conversationId,
      contactName: contacts.name,
      channel: conversations.channel,
      intent: messageTriage.intent,
      urgency: messageTriage.urgency,
      route: messageTriage.route,
      routeReason: messageTriage.routeReason,
      draftText: messageTriage.draftText,
      internalSummary: messageTriage.internalSummary,
      handoffReason: messageTriage.handoffReason,
      status: messageTriage.status,
      createdAt: messageTriage.createdAt,
    })
    .from(messageTriage)
    .innerJoin(conversations, eq(conversations.id, messageTriage.conversationId))
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(
      and(eq(messageTriage.organizationId, orgId), inArray(messageTriage.status, ["borrador", "derivado"])),
    )
    // Lo urgente primero: un reclamo no puede quedar debajo de una consulta de precio.
    .orderBy(sql`case ${messageTriage.urgency} when 'alto' then 0 when 'medio' then 1 else 2 end`, desc(messageTriage.createdAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function countPendingTriage(orgId: string) {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(messageTriage)
    .where(
      and(eq(messageTriage.organizationId, orgId), inArray(messageTriage.status, ["borrador", "derivado"])),
    );
  return row?.n ?? 0;
}

/**
 * Marca un triaje como atendido: la persona ya lo resolvió (mandó el borrador, escribió otra
 * cosa o lo descartó). No se borra: el registro de la clasificación queda.
 */
export async function resolveTriage(id: string, orgId: string, sentMessageId?: string) {
  await getDb()
    .update(messageTriage)
    .set({
      status: sentMessageId ? "enviado" : "descartado",
      sentMessageId: sentMessageId ?? null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(messageTriage.id, id), eq(messageTriage.organizationId, orgId)));
}

/** Métricas del triaje para Reportes y para la vista de agencia. */
export async function getTriageStats(orgId: string, days = 30) {
  const [row] = await getDb().execute<{
    total: number;
    enviados: number;
    pendientes: number;
    derivados: number;
    errores: number;
    confianza_media: string | null;
  }>(sql`
    select
      count(*)::int as total,
      count(*) filter (where status = 'enviado')::int as enviados,
      count(*) filter (where status = 'borrador')::int as pendientes,
      count(*) filter (where status = 'derivado')::int as derivados,
      count(*) filter (where status = 'error')::int as errores,
      avg(intent_confidence) as confianza_media
    from message_triage
    where organization_id = ${orgId} and created_at >= now() - make_interval(days => ${days})
  `);

  return {
    total: row.total,
    enviados: row.enviados,
    pendientes: row.pendientes,
    derivados: row.derivados,
    errores: row.errores,
    confianzaMedia: row.confianza_media === null ? null : Number(row.confianza_media),
  };
}

/** Distribución por intención: sirve para ver si un umbral está mandando de más a revisión. */
export async function getIntentBreakdown(orgId: string, days = 30) {
  const rows = await getDb().execute<{ intent: string | null; n: number; enviados: number }>(sql`
    select intent, count(*)::int as n, count(*) filter (where status = 'enviado')::int as enviados
    from message_triage
    where organization_id = ${orgId} and created_at >= now() - make_interval(days => ${days})
    group by intent
    order by n desc
  `);
  return rows.map((r) => ({ intent: r.intent ?? "sin clasificar", total: r.n, enviados: r.enviados }));
}

/**
 * Lo que la campanita muestra al asesor: conversaciones que el agente dejó para una persona,
 * con el contexto mínimo para decidir a cuál entrar primero.
 */
export async function listHandovers(orgId: string, limit = 15) {
  const rows = await getDb().execute<{
    id: string;
    conversation_id: string;
    contact_name: string | null;
    channel: string;
    intent: string | null;
    urgency: string | null;
    route_reason: string | null;
    handoff_reason: string | null;
    internal_summary: string | null;
    temperature: string | null;
    operation: string | null;
    zones: string[] | null;
    price_max: string | null;
    currency: string | null;
    ultima_propiedad: string | null;
    status: string;
    seen_at: string | Date | null;
    created_at: string | Date;
  }>(sql`
    select t.id, t.conversation_id, c.name as contact_name, v.channel::text as channel,
           t.intent, t.urgency, t.route_reason, t.handoff_reason, t.internal_summary,
           c.temperature::text as temperature,
           r.operation::text as operation, r.zones, r.price_max, r.currency,
           (select p.title from deal_properties dp
              join properties p on p.id = dp.property_id
              join deals d on d.id = dp.deal_id
             where d.contact_id = c.id and d.organization_id = ${orgId}
             order by dp.last_interest_at desc nulls last, dp.added_at desc
             limit 1) as ultima_propiedad,
           t.status::text as status, t.seen_at, t.created_at
      from message_triage t
      join conversations v on v.id = t.conversation_id
      left join contacts c on c.id = v.contact_id
      left join prospect_requirements r
        on r.contact_id = c.id and r.organization_id = ${orgId} and r.status = 'activo'
     where t.organization_id = ${orgId} and t.status in ('borrador', 'derivado')
     order by case t.urgency when 'alto' then 0 when 'medio' then 1 else 2 end,
              t.created_at desc
     limit ${limit}
  `);

  return rows.map((r) => {
    // Resumen corto de qué busca, para no abrir la conversación solo para saberlo.
    const partes = [
      r.operation,
      r.zones?.length ? r.zones.slice(0, 2).join(", ") : null,
      r.price_max ? `hasta ${r.currency ?? "USD"} ${Number(r.price_max).toLocaleString("es-AR")}` : null,
    ].filter(Boolean);

    return {
      id: r.id,
      conversationId: r.conversation_id,
      contactName: r.contact_name,
      channel: r.channel,
      intent: r.intent,
      urgency: r.urgency,
      routeReason: r.route_reason,
      handoffReason: r.handoff_reason,
      internalSummary: r.internal_summary,
      temperature: r.temperature,
      buscaResumen: partes.length ? partes.join(" · ") : null,
      ultimaPropiedad: r.ultima_propiedad,
      status: r.status,
      seen: r.seen_at !== null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}

/** Marca como visto lo pendiente de una conversación: la campanita cuenta solo lo no visto. */
export async function markTriageSeen(conversationId: string, orgId: string) {
  await getDb()
    .update(messageTriage)
    .set({ seenAt: sql`now()` })
    .where(
      and(
        eq(messageTriage.conversationId, conversationId),
        eq(messageTriage.organizationId, orgId),
        isNull(messageTriage.seenAt),
      ),
    )
    .catch(() => {});
}
