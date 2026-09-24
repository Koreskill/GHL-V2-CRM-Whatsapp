import { and, eq, gt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { agentConfigs, conversations, messages, messageTriage, type TriageStatus } from "@/db/schema";
import { aiDecide, readChoice, readNoul, readScore } from "@/lib/ai/decisions";
import { resolveModel } from "@/lib/ai/openrouter";
import { reportIncident } from "@/lib/incidents/report";
import { deliverMessage } from "@/lib/inbox/deliver";
import { computeWindow } from "@/lib/inbox/window";
import { clearAgentTyping, setAgentTyping } from "@/lib/inbox/typing";
import { safeError } from "@/lib/safe-error";
import { resolveAgentConfig } from "../config";
import { buildTriageContext, stateForDecision } from "./context";
import { generateReply } from "./generate";
import { INTENTS, TRIAGE_QUESTIONS, URGENCY_LEVELS, type Intent, type Urgency } from "./questions";
import { DEFAULT_POLICY, routeFor, type RoutingPolicy } from "./routes";

/**
 * Flujo completo de un mensaje entrante:
 *
 *   1. Jev clasifica (Decisions API) -> decisiones tipadas con probabilidades.
 *   2. El CÓDIGO elige la ruta con una tabla determinista.
 *   3. GPT redacta siguiendo esa ruta.
 *   4. Se valida, se aplican las reglas de envío y se registra todo en message_triage.
 *
 * El envío sigue saliendo por `deliverMessage`: sigue habiendo un solo camino de salida.
 */

export const DEFAULT_DECISION_MODEL = () => process.env.OPENROUTER_DECISION_MODEL || "typesafe/jev-1.13";

// Si el trabajo se procesa mucho después, no se contesta como si el mensaje fuera de recién.
const MAX_DELAY_MS = 10 * 60 * 1000;
const MAX_PER_CONVERSATION_HOUR = 20;
const maxPerHour = () => Number(process.env.AGENT_MAX_REPLIES_PER_HOUR) || 300;

export type TriageResult =
  | { status: "skipped"; reason: string }
  | { status: TriageStatus; triageId: string; route?: string; intent?: string };

type Policy = RoutingPolicy & { autoReply: "auto" | "borrador" | "off" };

/** Política de la inmobiliaria: canal -> global -> default del código, como el resto de la cascada. */
async function resolvePolicy(orgId: string, channel: string): Promise<Policy> {
  const rows = await getDb()
    .select({
      scope: agentConfigs.scope,
      autoReply: agentConfigs.autoReply,
      minConfidence: agentConfigs.minConfidence,
      humanThreshold: agentConfigs.humanThreshold,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, orgId));

  const pick = <T>(get: (r: (typeof rows)[number]) => T | null | undefined): T | null => {
    const own = rows.find((r) => r.scope === channel);
    const global = rows.find((r) => r.scope === "global");
    return get(own as (typeof rows)[number]) ?? get(global as (typeof rows)[number]) ?? null;
  };

  const num = (value: string | null, fallback: number) => {
    const n = value === null ? NaN : Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
  };

  const mode = pick((r) => r?.autoReply);
  return {
    autoReply: mode === "borrador" || mode === "off" ? mode : "auto",
    minConfidence: num(pick((r) => r?.minConfidence), DEFAULT_POLICY.minConfidence),
    humanThreshold: num(pick((r) => r?.humanThreshold), DEFAULT_POLICY.humanThreshold),
    visitThreshold: DEFAULT_POLICY.visitThreshold,
  };
}

/**
 * Reclama el mensaje ANTES de gastar un token.
 * El índice único sobre message_id hace que dos corridas simultáneas del mismo mensaje
 * (un reintento del webhook, por ejemplo) no lo clasifiquen ni lo contesten dos veces.
 */
async function claim(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
}): Promise<string | null> {
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
    .where(
      and(
        eq(messages.conversationId, conversationId),
        gt(messages.sentAt, trigger.sentAt),
        ne(messages.id, trigger.id),
      ),
    )
    .limit(1);
  return Boolean(newer);
}

export async function triageIncomingMessage(
  conversationId: string,
  opts: { triggerMessageId: string },
): Promise<TriageResult> {
  const db = getDb();

  const [trigger] = await db
    .select({
      id: messages.id,
      sentAt: messages.sentAt,
      direction: messages.direction,
      body: messages.body,
      organizationId: messages.organizationId,
    })
    .from(messages)
    .where(and(eq(messages.id, opts.triggerMessageId), eq(messages.conversationId, conversationId)));
  if (!trigger || trigger.direction !== "inbound") return { status: "skipped", reason: "trigger_not_found" };
  if (Date.now() - trigger.sentAt.getTime() > MAX_DELAY_MS) return { status: "skipped", reason: "stale" };

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv) return { status: "skipped", reason: "conversation_not_found" };

  // Doble interruptor, igual que antes: el hilo Y el canal.
  if (!conv.aiEnabled) return { status: "skipped", reason: "conversation_ai_off" };
  const config = await resolveAgentConfig(conv.organizationId, conv.channel);
  if (!config.enabled) return { status: "skipped", reason: "channel_off" };
  if (computeWindow(conv.channel, conv.lastInboundAt).state !== "open") {
    return { status: "skipped", reason: "window_closed" };
  }
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
  const triageId = await claim({
    organizationId: conv.organizationId,
    conversationId,
    messageId: trigger.id,
  });
  if (!triageId) return { status: "skipped", reason: "already_processed" };

  const policy = await resolvePolicy(conv.organizationId, conv.channel);
  if (policy.autoReply === "off") {
    await finish(triageId, { status: "descartado", error: null, routeReason: "La inmobiliaria tiene el envío automático apagado" });
    return { status: "descartado", triageId };
  }

  await setAgentTyping(conversationId, conv.organizationId, db);

  try {
    const ctx = await buildTriageContext({
      organizationId: conv.organizationId,
      conversationId,
      channel: conv.channel,
      contactId: conv.contactId,
      incomingText: text,
    });

    // ── 1. Jev clasifica ──
    // Modelo de clasificación: config del canal -> ai_model_configs -> variable de entorno.
    // resolveModel cae en OPENROUTER_MODEL (el de chat), que NO sirve para Decisions, así que
    // solo se usa su valor si la organización configuró uno explícitamente para "calificacion".
    const configured = await resolveModel(conv.organizationId, "calificacion", DEFAULT_DECISION_MODEL());
    const decisionModel = config.decisionModel?.trim() || configured.model;

    const decided = await aiDecide({
      organizationId: conv.organizationId,
      fn: "calificacion",
      model: decisionModel,
      state: stateForDecision(ctx),
      questions: TRIAGE_QUESTIONS,
      sessionId: conversationId,
      requestRef: { conversationId, messageId: trigger.id },
    });

    if (!decided.success) {
      await finish(triageId, { status: "error", error: decided.error, decisionModel });
      await reportIncident({
        organizationId: conv.organizationId,
        module: "agente",
        key: `jev:${decisionModel}`,
        message: `No se pudo clasificar el mensaje con ${decisionModel}`,
        detail: decided.error,
        context: { channel: conv.channel },
      });
      return { status: "error", triageId };
    }

    const answers = decided.data.answers;
    const intentAnswer = readChoice(answers.intent, INTENTS);
    const visitProb = readNoul(answers.contains_visit_request) ?? 0;
    const humanProb = readNoul(answers.requires_human) ?? 1; // sin dato, se asume que sí
    const urgencyAnswer = readScore(answers.urgency, URGENCY_LEVELS.length);

    // Si ni siquiera se pudo leer la intención, no se enruta a ciegas: lo mira una persona.
    if (!intentAnswer) {
      await finish(triageId, {
        status: "derivado",
        decisionModel: decided.data.model,
        decisionId: decided.data.id ?? null,
        route: "aclaracion",
        routeReason: "No se pudo leer una intención válida de la clasificación",
        error: null,
      });
      await pauseAi(conversationId, conv.organizationId);
      return { status: "derivado", triageId };
    }

    const intent = intentAnswer.choice as Intent;
    const urgency: Urgency = URGENCY_LEVELS[urgencyAnswer?.level ?? 0];

    // ── 2. El código elige la ruta ──
    const routing = routeFor(
      {
        intent,
        intentConfidence: intentAnswer.confidence,
        containsVisitRequest: visitProb,
        requiresHuman: humanProb,
        urgency,
      },
      policy,
    );

    const classification = {
      intent,
      intentConfidence: String(intentAnswer.confidence),
      intentProbabilities: intentAnswer.probabilities,
      containsVisitRequest: String(visitProb),
      requiresHuman: String(humanProb),
      urgency,
      decisionModel: decided.data.model,
      decisionId: decided.data.id ?? null,
      route: routing.route,
      routeReason: routing.reason,
    };

    // El spam no abre conversación comercial ni ocupa a nadie del equipo.
    if (routing.route === "spam") {
      await finish(triageId, { ...classification, status: "descartado", error: null });
      return { status: "descartado", triageId, route: routing.route, intent };
    }

    // ── 3. GPT redacta ──
    const replyModelConfig = await resolveModel(conv.organizationId, "conversacional", config.model);
    const generated = await generateReply({
      ctx,
      route: routing.route,
      intent,
      urgency,
      handoff: routing.handoff,
      orgPrompt: config.systemPrompt,
      model: replyModelConfig.model,
      provider: replyModelConfig.provider,
      params: replyModelConfig.params,
    });

    if (!generated.success) {
      await finish(triageId, {
        ...classification,
        status: "derivado",
        replyModel: replyModelConfig.model,
        handoffReason: "No se pudo redactar una respuesta con datos verificados",
        error: generated.error,
      });
      await reportIncident({
        organizationId: conv.organizationId,
        module: "agente",
        key: `redaccion:${replyModelConfig.model}`,
        message: `El agente no pudo redactar la respuesta con ${replyModelConfig.model}`,
        detail: generated.error,
        context: { channel: conv.channel, route: routing.route },
      });
      await pauseAi(conversationId, conv.organizationId);
      return { status: "derivado", triageId, route: routing.route, intent };
    }

    const reply = generated.reply;
    const draft = {
      ...classification,
      replyModel: replyModelConfig.model,
      draftText: reply.reply_text || null,
      internalSummary: reply.internal_summary || null,
      missingInformation: reply.missing_information,
      suggestedCrmUpdates: reply.suggested_crm_updates,
      handoffReason: reply.handoff_reason,
    };

    // ── 4. Reglas de envío ──
    // Se deriva si: la ruta lo pide, el modelo mismo pidió derivar, o no hay texto que mandar.
    const mustHandoff = routing.handoff || Boolean(reply.handoff_reason) || !reply.reply_text;
    if (mustHandoff) {
      await finish(triageId, {
        ...draft,
        status: "derivado",
        handoffReason: reply.handoff_reason ?? routing.reason,
        error: null,
      });
      await pauseAi(conversationId, conv.organizationId);
      return { status: "derivado", triageId, route: routing.route, intent };
    }

    // Modo borrador: la inmobiliaria quiere revisar antes de que salga nada.
    if (policy.autoReply === "borrador") {
      await finish(triageId, { ...draft, status: "borrador", error: null });
      return { status: "borrador", triageId, route: routing.route, intent };
    }

    // Último control antes de enviar: mientras el modelo pensaba pudo escribir el cliente,
    // contestar una persona o apagarse la IA.
    if (await superseded(conversationId, trigger)) {
      await finish(triageId, { ...draft, status: "borrador", routeReason: "Llegó otro mensaje mientras se redactaba", error: null });
      return { status: "borrador", triageId, route: routing.route, intent };
    }
    const [fresh] = await db
      .select({ aiEnabled: conversations.aiEnabled })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!fresh?.aiEnabled) {
      await finish(triageId, { ...draft, status: "borrador", routeReason: "La IA se pausó mientras se redactaba", error: null });
      return { status: "borrador", triageId, route: routing.route, intent };
    }

    const sent = await deliverMessage(conversationId, { text: reply.reply_text, source: "agent" });
    if (!sent.ok) {
      await finish(triageId, { ...draft, status: "borrador", error: sent.error });
      await reportIncident({
        organizationId: conv.organizationId,
        module: "mensajeria",
        key: `envio:${conv.channel}`,
        message: `No se pudo enviar la respuesta del agente por ${conv.channel}`,
        detail: sent.error,
        context: { channel: conv.channel },
      });
      return { status: "borrador", triageId, route: routing.route, intent };
    }

    await finish(triageId, { ...draft, status: "enviado", sentMessageId: sent.message.id, error: null });
    return { status: "enviado", triageId, route: routing.route, intent };
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
