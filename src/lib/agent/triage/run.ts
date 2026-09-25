import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  agentConfigs,
  conversations,
  deals,
  messages,
  messageTriage,
  visitEvents,
  visits,
  type TriageStatus,
} from "@/db/schema";
import { reportIncident } from "@/lib/incidents/report";
import { deliverMessage } from "@/lib/inbox/deliver";
import { computeWindow } from "@/lib/inbox/window";
import { clearAgentTyping, setAgentTyping } from "@/lib/inbox/typing";
import { safeError } from "@/lib/safe-error";
import { resolveAgentConfig } from "../config";
import { composeReply, DEFAULT_DECISION_MODEL, type ComposeResult } from "./compose";
import { markPropertyShown } from "./tags";
import { DEFAULT_POLICY, type RoutingPolicy } from "./routes";

/**
 * Flujo de un mensaje entrante, de punta a punta.
 *
 * Qué se contesta lo decide `composeReply` (clasificar, buscar en el catálogo, redactar,
 * validar). Este archivo pone los interruptores, reclama el mensaje para no procesarlo dos veces,
 * manda la respuesta y registra el resultado.
 *
 * El envío sigue saliendo por `deliverMessage`: un solo camino de salida.
 */

export { DEFAULT_DECISION_MODEL };

// Si el trabajo se procesa mucho después, no se contesta como si el mensaje fuera de recién.
const MAX_DELAY_MS = 10 * 60 * 1000;
const MAX_PER_CONVERSATION_HOUR = 20;
const maxPerHour = () => Number(process.env.AGENT_MAX_REPLIES_PER_HOUR) || 300;

export type TriageResult =
  | { status: "skipped"; reason: string }
  | { status: TriageStatus; triageId: string; route?: string; intent?: string };

export type Policy = RoutingPolicy & { autoReply: "auto" | "borrador" | "off" };

/** Política de la inmobiliaria: canal -> global -> default del código, como el resto de la cascada. */
export async function resolvePolicy(orgId: string, channel: string): Promise<Policy> {
  const rows = await getDb()
    .select({
      scope: agentConfigs.scope,
      autoReply: agentConfigs.autoReply,
      minConfidence: agentConfigs.minConfidence,
      humanThreshold: agentConfigs.humanThreshold,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, orgId));

  const own = rows.find((r) => r.scope === channel);
  const global = rows.find((r) => r.scope === "global");
  const pick = <K extends keyof (typeof rows)[number]>(key: K) => own?.[key] ?? global?.[key] ?? null;

  const num = (value: unknown, fallback: number) => {
    const n = value === null || value === undefined ? NaN : Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
  };

  const mode = pick("autoReply");
  return {
    autoReply: mode === "borrador" || mode === "off" ? mode : "auto",
    minConfidence: num(pick("minConfidence"), DEFAULT_POLICY.minConfidence),
    humanThreshold: num(pick("humanThreshold"), DEFAULT_POLICY.humanThreshold),
    visitThreshold: DEFAULT_POLICY.visitThreshold,
  };
}

/**
 * Reclama el mensaje ANTES de gastar un token.
 * El índice único sobre message_id hace que dos corridas simultáneas del mismo mensaje
 * (un reintento del webhook, por ejemplo) no lo clasifiquen ni lo contesten dos veces.
 */
async function claim(input: { organizationId: string; conversationId: string; messageId: string }): Promise<string | null> {
  const [row] = await getDb()
    .insert(messageTriage)
    .values({ ...input, status: "error", error: "en proceso" })
    .onConflictDoNothing({ target: messageTriage.messageId })
    .returning({ id: messageTriage.id });
  return row?.id ?? null;
}

/** Derivar pausa la IA en el hilo: una persona tomó la conversación y el agente no la pisa. */
async function pauseAi(conversationId: string, orgId: string) {
  await getDb()
    .update(conversations)
    .set({ aiEnabled: false })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)))
    .catch(() => {});
}

async function finish(triageId: string, patch: Record<string, unknown>) {
  await getDb()
    .update(messageTriage)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(messageTriage.id, triageId))
    .catch(() => {});
}

// Otro mensaje del cliente o una respuesta ya enviada: esta corrida sobra.
async function superseded(conversationId: string, trigger: { id: string; sentAt: Date }) {
  const [newer] = await getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), gt(messages.sentAt, trigger.sentAt), ne(messages.id, trigger.id)))
    .limit(1);
  return Boolean(newer);
}

/**
 * Registra qué propiedades se le mostraron al contacto.
 *
 * Una propiedad mostrada es el comienzo de una oportunidad: si el contacto no tenía una abierta,
 * se crea. Sin esto, lo que se le mostró no quedaba en ningún lado, el turno siguiente no sabía
 * de qué propiedad se venía hablando ("¿tenés fotos?") y la ficha no lo listaba en Interesados.
 */
/** La oportunidad abierta del contacto, o una nueva si no tenía. Una sola: no se duplica. */
async function ensureDeal(input: { organizationId: string; contactId: string; conversationId: string }): Promise<string> {
  const db = getDb();
  const [open] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.contactId, input.contactId), eq(deals.organizationId, input.organizationId), eq(deals.status, "abierta")))
    .orderBy(desc(deals.updatedAt))
    .limit(1);
  if (open) return open.id;

  const [created] = await db
    .insert(deals)
    .values({
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      stage: "prospecto",
    })
    .returning({ id: deals.id });
  return created.id;
}

async function recordShown(input: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  propertyIds: string[];
}) {
  if (!input.propertyIds.length) return;
  const dealId = await ensureDeal(input);
  for (const propertyId of input.propertyIds) {
    await markPropertyShown({ organizationId: input.organizationId, dealId, propertyId });
  }
}

/**
 * Registra el pedido de visita en el módulo Visitas, como "solicitada" y SIN fecha: el bot no
 * puede confirmar un horario, eso lo hace el asesor. Lo que pidió el cliente ("el sábado a las
 * 11") queda en la nota para que el asesor lo vea sin abrir el chat.
 *
 * No duplica: si ya hay una visita abierta (solicitada o agendada) a esa propiedad en esa
 * oportunidad, se le suma la nota en vez de crear otra.
 */
async function recordVisitRequest(input: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  propertyId: string;
  note: string;
}) {
  const db = getDb();
  const dealId = await ensureDeal(input);
  await markPropertyShown({ organizationId: input.organizationId, dealId, propertyId: input.propertyId });

  const [existing] = await db
    .select({ id: visits.id, notes: visits.notes })
    .from(visits)
    .where(
      and(
        eq(visits.dealId, dealId),
        eq(visits.propertyId, input.propertyId),
        eq(visits.organizationId, input.organizationId),
        inArray(visits.status, ["solicitada", "agendada"]),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(visits)
      .set({ notes: [existing.notes, input.note].filter(Boolean).join("\n").slice(0, 2000) })
      .where(eq(visits.id, existing.id));
    return;
  }

  const [visit] = await db
    .insert(visits)
    .values({
      organizationId: input.organizationId,
      dealId,
      contactId: input.contactId,
      propertyId: input.propertyId,
      status: "solicitada",
      notes: input.note,
    })
    .returning({ id: visits.id });

  await db
    .insert(visitEvents)
    .values({ organizationId: input.organizationId, visitId: visit.id, action: "solicitada", toValue: "por el agente" })
    .catch(() => {});
}

function persistable(c: ComposeResult) {
  return {
    intent: c.classification?.intent ?? null,
    intentConfidence: c.classification ? String(c.classification.intentConfidence) : null,
    intentProbabilities: c.classification?.intentProbabilities ?? {},
    containsVisitRequest: c.classification ? String(c.classification.containsVisitRequest) : null,
    requiresHuman: c.classification ? String(c.classification.requiresHuman) : null,
    urgency: c.classification?.urgency ?? null,
    decisionModel: c.classification?.decisionModel ?? null,
    decisionId: c.classification?.decisionId ?? null,
    route: c.routing?.route ?? null,
    routeReason: c.routing?.reason ?? null,
    replyModel: c.replyModel,
    draftText: c.text,
    internalSummary: c.reply?.internal_summary || null,
    missingInformation: c.reply?.missing_information ?? [],
    suggestedCrmUpdates: {
      ...(c.reply?.suggested_crm_updates ?? {}),
      // Rastro de cómo salió la respuesta: sirve para ver cuántas veces el validador tuvo que frenar.
      _origen: c.source,
      _busqueda: c.retrieval
        ? { modo: c.retrieval.mode, ofrecidas: c.retrieval.offered.length, coincidencias: c.retrieval.totalExact }
        : null,
      _bloqueos: c.violations.map((v) => v.code),
    },
    handoffReason: c.handoffReason,
  };
}

export async function triageIncomingMessage(conversationId: string, opts: { triggerMessageId: string }): Promise<TriageResult> {
  const db = getDb();

  const [trigger] = await db
    .select({ id: messages.id, sentAt: messages.sentAt, direction: messages.direction, body: messages.body })
    .from(messages)
    .where(and(eq(messages.id, opts.triggerMessageId), eq(messages.conversationId, conversationId)));
  if (!trigger || trigger.direction !== "inbound") return { status: "skipped", reason: "trigger_not_found" };
  if (Date.now() - trigger.sentAt.getTime() > MAX_DELAY_MS) return { status: "skipped", reason: "stale" };

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv) return { status: "skipped", reason: "conversation_not_found" };

  // Doble interruptor: el hilo Y el canal.
  if (!conv.aiEnabled) return { status: "skipped", reason: "conversation_ai_off" };
  const config = await resolveAgentConfig(conv.organizationId, conv.channel);
  if (!config.enabled) return { status: "skipped", reason: "channel_off" };
  if (computeWindow(conv.channel, conv.lastInboundAt).state !== "open") return { status: "skipped", reason: "window_closed" };
  if (await superseded(conversationId, trigger)) return { status: "skipped", reason: "superseded" };

  const text = trigger.body?.trim();
  if (!text) return { status: "skipped", reason: "empty_message" };

  // Topes de gasto antes de llamar a ningún modelo.
  const [usage] = await db.execute<{ conv: number; total: number }>(sql`
    select
      count(*) filter (where conversation_id = ${conversationId})::int as conv,
      count(*)::int as total
    from messages
    where direction = 'outbound' and raw_payload->>'source' = 'agent'
      and organization_id = ${conv.organizationId} and sent_at >= now() - interval '1 hour'
  `);
  if (usage.conv >= MAX_PER_CONVERSATION_HOUR) return { status: "skipped", reason: "limit_conversation" };
  if (usage.total >= maxPerHour()) return { status: "skipped", reason: "limit_global" };
  if (!process.env.OPENROUTER_API_KEY) return { status: "skipped", reason: "openrouter_key_missing" };

  // Idempotencia: si ya lo reclamó otra corrida, se corta sin gastar nada.
  const triageId = await claim({ organizationId: conv.organizationId, conversationId, messageId: trigger.id });
  if (!triageId) return { status: "skipped", reason: "already_processed" };

  const policy = await resolvePolicy(conv.organizationId, conv.channel);
  if (policy.autoReply === "off") {
    await finish(triageId, { status: "descartado", error: null, routeReason: "La inmobiliaria tiene el envío automático apagado" });
    return { status: "descartado", triageId };
  }

  await setAgentTyping(conversationId, conv.organizationId, db);

  try {
    const composed = await composeReply({
      organizationId: conv.organizationId,
      conversationId,
      channel: conv.channel,
      contactId: conv.contactId,
      text,
      config,
      policy,
      sessionId: conversationId,
      requestRef: { conversationId, messageId: trigger.id },
    });

    const record = persistable(composed);
    const route = composed.routing?.route;
    const intent = composed.classification?.intent;

    // No se pudo ni clasificar: una persona tiene que verlo, y el cliente no queda en visto.
    if (composed.disposition === "error") {
      await finish(triageId, { ...record, status: "error", error: composed.error });
      await pauseAi(conversationId, conv.organizationId);
      if (policy.autoReply === "auto") {
        await deliverMessage(conversationId, {
          text: "Recibimos tu mensaje. En breve te responde una persona del equipo.",
          source: "agent",
        });
      }
      return { status: "error", triageId };
    }

    if (composed.disposition === "descartar") {
      await finish(triageId, { ...record, status: "descartado", error: null });
      return { status: "descartado", triageId, route, intent };
    }

    // ── Derivación: acuse (si está en automático) y pausa ──
    if (composed.disposition === "derivar") {
      let ackId: string | null = null;
      if (policy.autoReply === "auto" && composed.text) {
        const ack = await deliverMessage(conversationId, { text: composed.text, source: "agent" });
        if (ack.ok) ackId = ack.message.id;
      }
      await finish(triageId, { ...record, status: "derivado", sentMessageId: ackId, error: null });
      await pauseAi(conversationId, conv.organizationId);
      return { status: "derivado", triageId, route, intent };
    }

    // ── Respuesta ──
    if (policy.autoReply === "borrador" || !composed.text) {
      await finish(triageId, { ...record, status: "borrador", error: null });
      return { status: "borrador", triageId, route, intent };
    }

    // Último control: mientras se redactaba pudo escribir el cliente, contestar una persona o
    // apagarse la IA. En esos casos queda como borrador, no se pisa a nadie.
    if (await superseded(conversationId, trigger)) {
      await finish(triageId, { ...record, status: "borrador", routeReason: "Llegó otro mensaje mientras se redactaba", error: null });
      return { status: "borrador", triageId, route, intent };
    }
    const [fresh] = await db.select({ aiEnabled: conversations.aiEnabled }).from(conversations).where(eq(conversations.id, conversationId));
    if (!fresh?.aiEnabled) {
      await finish(triageId, { ...record, status: "borrador", routeReason: "La IA se pausó mientras se redactaba", error: null });
      return { status: "borrador", triageId, route, intent };
    }

    const sent = await deliverMessage(conversationId, { text: composed.text, source: "agent" });
    if (!sent.ok) {
      await finish(triageId, { ...record, status: "borrador", error: sent.error });
      await reportIncident({
        organizationId: conv.organizationId,
        module: "mensajeria",
        key: `envio:${conv.channel}`,
        message: `No se pudo enviar la respuesta del agente por ${conv.channel}`,
        detail: sent.error,
        context: { channel: conv.channel },
      });
      return { status: "borrador", triageId, route, intent };
    }

    // Lo mostrado queda registrado en la oportunidad del contacto.
    if (conv.contactId && composed.shownPropertyIds.length) {
      await recordShown({
        organizationId: conv.organizationId,
        contactId: conv.contactId,
        conversationId,
        propertyIds: composed.shownPropertyIds,
      }).catch(() => {});
    }

    // Pidió visitar una propiedad concreta: queda en Visitas como "solicitada", para el asesor.
    if (conv.contactId && composed.visitRequest) {
      await recordVisitRequest({
        organizationId: conv.organizationId,
        contactId: conv.contactId,
        conversationId,
        propertyId: composed.visitRequest.propertyId,
        note: composed.visitRequest.note,
      }).catch(() => {
        // La visita es un registro de apoyo: si falla, el cliente ya tiene su respuesta y el
        // equipo igual recibe el aviso por la campanita.
      });
    }

    // Hay algo para que haga una persona (fotos que no están, un dato por confirmar): se contestó
    // igual, el bot sigue activo, y queda en la campanita. NO se pausa: eso es solo para derivar.
    const status = composed.notifyTeam ? "derivado" : "enviado";
    await finish(triageId, { ...record, status, sentMessageId: sent.message.id, error: null });
    return { status, triageId, route, intent };
  } catch (err) {
    const error = safeError(err);
    await finish(triageId, { status: "error", error });
    await reportIncident({
      organizationId: conv.organizationId,
      module: "agente",
      key: "triaje",
      message: "Falló el triaje de un mensaje entrante",
      detail: err,
      context: { channel: conv.channel },
    });
    return { status: "error", triageId };
  } finally {
    await clearAgentTyping(conversationId, conv.organizationId, db);
  }
}
export { ensureDeal as __ensureDeal, recordShown as __recordShown, recordVisitRequest as __recordVisitRequest };
