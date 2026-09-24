import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
