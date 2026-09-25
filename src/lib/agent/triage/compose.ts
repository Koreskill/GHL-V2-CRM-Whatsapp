import type { Channel } from "@/db/schema";
import { aiDecide, readChoice, readNoul, readScore } from "@/lib/ai/decisions";
import { resolveModel } from "@/lib/ai/openrouter";
import { reportIncident } from "@/lib/incidents/report";
import type { ResolvedAgentConfig } from "../config";
import { extractAmounts, loadOfferableCatalog, normalize, type CatalogProperty } from "./catalog-search";
import { buildTriageContext, stateForDecision, type TriageContext } from "./context";
import { extractProfileFields, type ExtractedFields } from "./extract";
import { generateReply, type GeneratedReply } from "./generate";
import { checkReply, correctionPrompt, type Violation } from "./guard";
import { renderCards } from "./listing-cards";
import { INTENTS, TAG_QUESTIONS, TRIAGE_QUESTIONS, URGENCY_LEVELS, type Intent, type Urgency } from "./questions";
import { buildCriteria, retrieve, type ProfileSnapshot, type Retrieval } from "./retrieval";
import { routeFor, type Route, type RoutingPolicy, type RoutingResult } from "./routes";
import { applyTags, markPropertyInterest, readTagDecisions } from "./tags";

/**
 * Compone la respuesta a un mensaje entrante. NO la envía.
 *
 * Está separado del envío a propósito: así la evaluación corre conversaciones completas contra
 * los modelos y el catálogo reales sin mandar un solo WhatsApp. Lo que decide qué se contesta
 * vive acá; `run.ts` solo pone los interruptores, reclama el mensaje y manda.
 *
 * Pasos:
 *   1. Jev clasifica (intención + etiquetas) en una sola llamada.
 *   2. La tabla de rutas decide el flujo. El modelo nunca elige la ruta.
 *   3. Se actualiza el perfil del contacto y se BUSCA EN EL CATÁLOGO.
 *   4. GPT redacta sobre las propiedades reales, y elige cuáles mostrar por clave.
 *   5. El validador revisa el texto. Si inventó algo, se reintenta una vez con la corrección;
 *      si vuelve a fallar, sale una respuesta armada por código, sin modelo.
 *   6. Las fichas se agregan desde la base.
 */

export const DEFAULT_DECISION_MODEL = () => process.env.OPENROUTER_DECISION_MODEL || "typesafe/jev-1.13";

// Si no hay un modelo de respaldo configurado, se usa uno distinto del principal: un error del
// proveedor de un modelo no debería tumbar la conversación.
const FALLBACK_MODEL = "openai/gpt-4o-mini";

export type Disposition =
  /** Hay una respuesta para mandar. */
  | "responder"
  /** La tiene que seguir una persona. Puede traer un acuse para mandar antes de pausar. */
  | "derivar"
  /** Spam: no se contesta ni se deriva. */
  | "descartar"
  /** No se pudo ni clasificar. */
  | "error";

export type ComposeResult = {
  disposition: Disposition;
  /** Texto final a enviar (redacción + fichas), o null si no hay nada que mandar. */
  text: string | null;
  shownPropertyIds: string[];
  classification: {
    intent: Intent;
    intentConfidence: number;
    intentProbabilities: Record<string, number>;
    containsVisitRequest: number;
    /** Probabilidad de que esté haciendo una oferta o pidiendo rebaja. */
    makesOffer: number;
    requiresHuman: number;
    urgency: Urgency;
    decisionModel: string;
    decisionId: string | null;
  } | null;
  routing: RoutingResult | null;
  retrieval: Retrieval | null;
  reply: GeneratedReply | null;
  replyModel: string | null;
  handoffReason: string | null;
  /** Lo que el validador encontró en el último intento. Vacío = la respuesta pasó limpia. */
  violations: Violation[];
  /**
   * El bot contesta y SIGUE activo, pero hay algo que tiene que hacer una persona (conseguir fotos
   * que no están cargadas, confirmar un dato). Distinto de derivar: derivar pausa el bot.
   */
  notifyTeam: boolean;
  /**
   * Pidió visitar UNA propiedad concreta: se registra como visita "solicitada" en el CRM (sin
   * fecha: el bot no puede confirmarla). Null si no pidió visita o no está claro cuál propiedad.
   */
  visitRequest: { propertyId: string; note: string } | null;
  /** Cómo salió la respuesta: del modelo, del modelo tras corregirse, o armada por código. */
  source: "modelo" | "modelo_corregido" | "modelo_respaldo" | "determinista" | null;
  error: string | null;
};

type Input = {
  organizationId: string;
  conversationId: string;
  channel: Channel;
  contactId: string | null;
  text: string;
  config: ResolvedAgentConfig;
  policy: RoutingPolicy;
  /** Para agrupar llamadas en la observabilidad de OpenRouter. */
  sessionId?: string;
  requestRef?: Record<string, unknown>;
  /** Catálogo ya cargado (la evaluación lo reutiliza entre turnos). */
  catalog?: CatalogProperty[];
};

// ─── Respuestas armadas por código ──────────────────────────────────────────
// Se usan cuando el modelo no está o insiste en inventar. Todo lo que dicen es verdad por
// construcción: si hablan de propiedades, son las que salieron de la base.

function deterministicReply(retrieval: Retrieval, channel: Channel, handoff: boolean): string {
  if (handoff) return "Recibimos tu mensaje. En breve te responde una persona del equipo.";

  if (retrieval.offered.length) {
    // Cada frase dice solo lo que es cierto en ese modo. "Coincide con lo que buscás" es solo para
    // una búsqueda con resultados exactos, no para una propiedad que se venía mirando.
    const intro =
      retrieval.mode === "referencia" || retrieval.mode === "conversacion"
        ? "Te paso los datos de la propiedad:"
        : retrieval.offered.every((o) => o.alternativa)
          ? "No tengo exactamente lo que buscás, pero te paso lo más parecido que tengo:"
          : "Te paso lo que tengo que coincide con lo que buscás:";
    return `${intro}\n\n${renderCards(retrieval.offered.map((o) => o.property), channel)}`;
  }

  if (retrieval.mode === "busqueda") {
    return "Por ahora no tengo propiedades disponibles que coincidan con lo que buscás. Si querés, le paso tu consulta a un asesor para que te avise cuando entre algo.";
  }

  return "¡Hola! ¿Qué estás buscando? Contame si es para comprar o alquilar, en qué zona y más o menos qué presupuesto manejás.";
}

// ─── Lo que el cliente ya dijo: el modelo no lo vuelve a preguntar ──────────

function knownFacts(ctx: TriageContext, retrieval: Retrieval) {
  const c = retrieval.criteria;
  const facts: Record<string, unknown> = {};
  if (c.operation) facts.operacion = c.operation;
  if (c.propertyTypes.length) facts.tipo = c.propertyTypes;
  if (c.zones.length) facts.zonas = c.zones;
  if (c.priceMax !== null) facts.presupuesto_hasta = c.priceMax;
  if (c.priceMin !== null) facts.presupuesto_desde = c.priceMin;
  if (c.currency) facts.moneda = c.currency;
  if (c.bedroomsMin !== null) facts.dormitorios_minimo = c.bedroomsMin;
  if (ctx.contactoNombre) facts.nombre = ctx.contactoNombre;
  return facts;
}

// Montos que se pueden nombrar: precios de lo ofrecido, presupuesto del perfil y cualquier monto
// que el cliente haya escrito en la conversación (repetirle "$60.000" no es inventar).
function allowedAmountsFor(ctx: TriageContext, retrieval: Retrieval): number[] {
  const out = new Set<number>();
  for (const o of retrieval.offered) if (o.property.price !== null) out.add(o.property.price);
  if (retrieval.criteria.priceMax !== null) out.add(retrieval.criteria.priceMax);
  if (retrieval.criteria.priceMin !== null) out.add(retrieval.criteria.priceMin);
  for (const m of ctx.historial) if (m.de === "contacto") for (const a of extractAmounts(m.texto)) out.add(a);
  for (const a of extractAmounts(ctx.mensajeEntrante)) out.add(a);
  return [...out];
}

function profileFrom(ctx: TriageContext): ProfileSnapshot | null {
  const q = ctx.queBusca;
  if (!q) return null;
  return {
    operation: q.operacion,
    propertyTypes: q.tipos ?? [],
    zones: q.zonas,
    priceMin: q.presupuestoMin === null ? null : Number(q.presupuestoMin),
    priceMax: q.presupuestoMax === null ? null : Number(q.presupuestoMax),
    // Solo si el cliente la dijo: la columna tiene default USD, que no es un dato del cliente.
    currency: q.monedaExplicita ? q.moneda : null,
    bedroomsMin: q.dormitoriosMin,
  };
}

export async function composeReply(input: Input): Promise<ComposeResult> {
  const { organizationId, conversationId, channel, contactId, text, config, policy } = input;

  const empty: ComposeResult = {
    disposition: "error",
    text: null,
    shownPropertyIds: [],
    classification: null,
    routing: null,
    retrieval: null,
    reply: null,
    replyModel: null,
    handoffReason: null,
    violations: [],
    notifyTeam: false,
    visitRequest: null,
    source: null,
    error: null,
  };

  const [ctx, catalog] = await Promise.all([
    buildTriageContext({ organizationId, conversationId, channel, contactId, incomingText: text }),
    input.catalog ? Promise.resolve(input.catalog) : loadOfferableCatalog(organizationId),
  ]);

  // ── 1. Jev clasifica ──
  const configured = await resolveModel(organizationId, "calificacion", DEFAULT_DECISION_MODEL());
  const decisionModel = config.decisionModel?.trim() || configured.model;

  const decided = await aiDecide({
    organizationId,
    fn: "calificacion",
    model: decisionModel,
    state: stateForDecision(ctx),
    questions: { ...TRIAGE_QUESTIONS, ...TAG_QUESTIONS },
    sessionId: input.sessionId,
    requestRef: input.requestRef,
  });

  if (!decided.success) {
    await reportIncident({
      organizationId,
      module: "agente",
      key: `jev:${decisionModel}`,
      message: `No se pudo clasificar el mensaje con ${decisionModel}`,
      detail: decided.error,
      context: { channel },
    });
    return { ...empty, error: decided.error };
  }

  const answers = decided.data.answers;
  const intentAnswer = readChoice(answers.intent, INTENTS);
  if (!intentAnswer) {
    return {
      ...empty,
      disposition: "derivar",
      text: deterministicReply({ mode: "ninguna", offered: [], totalExact: 0, totalAlternatives: 0, criteria: emptyCriteria(), currencyUsed: null }, channel, true),
      handoffReason: "No se pudo leer una intención válida de la clasificación",
      source: "determinista",
    };
  }

  const classification = {
    intent: intentAnswer.choice as Intent,
    intentConfidence: intentAnswer.confidence,
    intentProbabilities: intentAnswer.probabilities,
    containsVisitRequest: readNoul(answers.contains_visit_request) ?? 0,
    makesOffer: readNoul(answers.hace_oferta) ?? 0,
    // Sin dato, se asume que SÍ necesita una persona: ante la duda, no se contesta solo.
    requiresHuman: readNoul(answers.requires_human) ?? 1,
    urgency: URGENCY_LEVELS[readScore(answers.urgency, URGENCY_LEVELS.length)?.level ?? 0] as Urgency,
    decisionModel: decided.data.model,
    decisionId: decided.data.id ?? null,
  };

  // ── 2. Ruta ──
  const routing = routeFor(
    {
      intent: classification.intent,
      intentConfidence: classification.intentConfidence,
      intentProbabilities: classification.intentProbabilities,
      containsVisitRequest: classification.containsVisitRequest,
      requiresHuman: classification.requiresHuman,
      urgency: classification.urgency,
    },
    policy,
  );

  if (routing.route === "spam") {
    return { ...empty, disposition: "descartar", classification, routing };
  }

  // ── 3. Perfil y búsqueda en el catálogo ──
  const replyModel = await resolveModel(organizationId, "conversacional", config.model);
  const tagDecisions = readTagDecisions(answers);

  let extracted: ExtractedFields = {};
  if (!routing.handoff) {
    const extractModel = await resolveModel(organizationId, "extraccion", replyModel.model);
    const res = await extractProfileFields({
      ctx,
      model: extractModel.model,
      provider: extractModel.provider,
      params: extractModel.params,
    });
    if (res.success) extracted = res.fields;
  }

  if (contactId) {
    await applyTags({ organizationId, contactId, conversationId, decisions: tagDecisions, extracted }).catch(() => {
      // El perfil es información de apoyo: si falla, el contacto igual recibe respuesta.
    });
    if (tagDecisions.interestedInShownProperty >= 0.6 && tagDecisions.temperature) {
      await markPropertyInterest({ organizationId, contactId, temperature: tagDecisions.temperature }).catch(() => {});
    }
  }

  const criteria = buildCriteria({
    text,
    profile: profileFrom(ctx),
    catalog,
    thisTurn: {
      operation: tagDecisions.operation,
      propertyType: tagDecisions.propertyType,
      zones: extracted.zonas,
      priceMin: extracted.presupuesto_min,
      priceMax: extracted.presupuesto_max,
      currency: extracted.moneda ?? null,
      bedrooms: extracted.dormitorios ?? null,
    },
  });

  const retrieval = retrieve({
    text,
    catalog,
    criteria,
    shownIds: ctx.propiedadesDeInteres.map((p) => p.id),
  });

  // Hay rutas donde NO se muestran propiedades del catálogo:
  //  - derivación: el acuse no vende nada;
  //  - tasación y captación: la persona habla de SU propiedad. Mostrarle una del catálogo con
  //    precio es darle una tasación implícita (pasó: "¿cuánto vale mi casa en Fisherton?" recibió
  //    una ficha de USD 185.000), y además no es su casa.
  const noListings = routing.handoff || NO_LISTING_ROUTES.includes(routing.route);
  const offeredForTurn = noListings ? { ...retrieval, offered: [], totalExact: 0, totalAlternatives: 0 } : retrieval;
  // Oferta o pedido de rebaja: lo decide Jev (pregunta tipada), no el texto del modelo.
  const makesOffer = !routing.handoff && classification.makesOffer >= 0.6;
  const known: Record<string, unknown> = {
    ...knownFacts(ctx, retrieval),
    ...(makesOffer ? { hizo_una_oferta: true } : {}),
  };
  const allowedAmounts = allowedAmountsFor(ctx, offeredForTurn);
  const allowedAreas = offeredForTurn.offered
    .flatMap((o) => [o.property.areaM2, o.property.areaCoveredM2])
    .filter((n): n is number => n !== null);
  const media = {
    fotos: offeredForTurn.offered.some((o) => Boolean(o.property.coverUrl || o.property.galleryUrls.length || o.property.sourceUrl)),
    video: offeredForTurn.offered.some((o) => Boolean(o.property.videoUrl)),
    tour: offeredForTurn.offered.some((o) => Boolean(o.property.tour360Url)),
  };

  // Último mensaje del bot: para no repetirlo textual.
  const lastBotMessage = [...ctx.historial].reverse().find((m) => m.de === "inmobiliaria")?.texto ?? null;
  const validRefs = new Set(offeredForTurn.offered.map((o) => o.ref));

  // Si ESTA respuesta va a llevar fichas: las que eligió el modelo, o la propiedad que el cliente
  // nombró (esa va siempre). Con fichas adjuntas, "¿querés que te la mande?" no tiene sentido.
  const willAttach = (r: GeneratedReply) =>
    !noListings && (r.mostrar.some((ref) => validRefs.has(ref)) || (retrieval.mode === "referencia" && offeredForTurn.offered.length > 0));

  const check = (r: GeneratedReply) =>
    checkReply({
      text: r.reply_text,
      allowedAmounts,
      allowedAreas,
      offeredCount: offeredForTurn.offered.length,
      alternativesCount: offeredForTurn.totalAlternatives,
      media,
      attaching: willAttach(r),
      lastBotMessage,
    });

  const genArgs = {
    ctx,
    retrieval: offeredForTurn,
    route: routing.route,
    intent: classification.intent,
    urgency: classification.urgency,
    handoff: routing.handoff,
    orgPrompt: config.systemPrompt,
    known,
  };

  // ── 4. Redacción, con respaldo si el modelo falla ──
  let replyModelUsed = replyModel.model;
  let source: ComposeResult["source"] = "modelo";
  let generated = await generateReply({ ...genArgs, model: replyModel.model, provider: replyModel.provider, params: replyModel.params });

  if (!generated.success) {
    // Un error del proveedor (un 400, un timeout) NO puede dejar al cliente sin respuesta. Antes
    // pasaba: 25 minutos de silencio sin que nadie se enterara.
    const fallback = await resolveModel(organizationId, "fallback", FALLBACK_MODEL);
    const alt = fallback.model === replyModel.model ? FALLBACK_MODEL : fallback.model;
    await reportIncident({
      organizationId,
      module: "agente",
      key: `redaccion:${replyModel.model}`,
      message: `El modelo de redacción ${replyModel.model} falló; se usó ${alt} de respaldo`,
      detail: generated.error,
      severity: "advertencia",
      context: { channel, route: routing.route },
    });
    generated = await generateReply({ ...genArgs, model: alt, provider: fallback.provider, params: fallback.params });
    replyModelUsed = alt;
    source = "modelo_respaldo";
  }

  // Si fallaron los dos modelos: respuesta armada por código. Nunca silencio.
  if (!generated.success) {
    await reportIncident({
      organizationId,
      module: "agente",
      key: "redaccion:sin_modelo",
      message: "Ningún modelo pudo redactar la respuesta; se mandó una armada por el sistema",
      detail: generated.error,
      context: { channel, route: routing.route },
    });
    const det = deterministicReply(offeredForTurn, channel, routing.handoff);
    return {
      ...empty,
      disposition: routing.handoff ? "derivar" : "responder",
      text: det,
      shownPropertyIds: routing.handoff ? [] : offeredForTurn.offered.map((o) => o.property.id),
      classification,
      routing,
      retrieval,
      replyModel: replyModelUsed,
      handoffReason: routing.handoff ? routing.reason : null,
      source: "determinista",
      error: generated.error,
    };
  }

  let reply = generated.reply;

  // ── 5. Validación ──
  let violations = check(reply);
  if (violations.length) {
    const retry = await generateReply({
      ...genArgs,
      model: replyModelUsed,
      provider: replyModel.provider,
      params: replyModel.params,
      correction: { previous: JSON.stringify(reply), instruction: correctionPrompt(violations) },
    });
    if (retry.success) {
      const second = check(retry.reply);
      if (!second.length) {
        reply = retry.reply;
        violations = [];
        source = "modelo_corregido";
      } else {
        violations = second;
      }
    }
  }

  // Sigue inventando después de corregirse: no se manda. Sale la respuesta armada por código.
  if (violations.length) {
    await reportIncident({
      organizationId,
      module: "agente",
      key: `validacion:${violations[0].code}`,
      message: `El agente intentó mandar datos no verificados (${violations.map((v) => v.code).join(", ")}); se reemplazó por una respuesta del sistema`,
      detail: violations.map((v) => v.detail).join(" | "),
      severity: "advertencia",
      context: { channel, route: routing.route },
    });
    const det = deterministicReply(offeredForTurn, channel, routing.handoff);
    return {
      ...empty,
      disposition: routing.handoff ? "derivar" : "responder",
      text: det,
      shownPropertyIds: routing.handoff ? [] : offeredForTurn.offered.map((o) => o.property.id),
      classification,
      routing,
      retrieval,
      reply,
      replyModel: replyModelUsed,
      handoffReason: routing.handoff ? routing.reason : null,
      violations,
      source: "determinista",
    };
  }

  // ── 6. Fichas ──
  // Solo se adjunta lo que la búsqueda ofreció: una clave inventada no tiene propiedad detrás.
  const byRef = new Map(offeredForTurn.offered.map((o) => [o.ref, o]));
  let selected = reply.mostrar.map((ref) => byRef.get(ref)).filter((o): o is NonNullable<typeof o> => Boolean(o));

  // Si el cliente nombró una propiedad puntual, su ficha va siempre: preguntó por ESA.
  // (Salvo en las rutas sin fichas: ahí offeredForTurn ya viene vacío.)
  if (retrieval.mode === "referencia" && !noListings && !selected.length) {
    selected = offeredForTurn.offered;
  }

  const cards = noListings ? "" : renderCards(selected.map((o) => o.property), channel);
  const finalText = [reply.reply_text, cards].filter((part) => part && part.trim()).join("\n\n");

  // Solo las rutas de derivación (reclamo, pide una persona, tema delicado) pausan el bot. Si el
  // modelo pidió ayuda del equipo en una consulta comercial, se contesta igual y se avisa: antes,
  // un "no hay stock" apagaba el bot y el "¿y en venta?" siguiente quedaba sin respuesta.
  const mustHandoff = routing.handoff;

  // Avisar al equipo NO depende de que el modelo se acuerde de completar handoff_reason:
  //  - si el texto PROMETE algo que hace una persona ("lo consulto con el equipo", "paso tu oferta
  //    al asesor"), esa promesa tiene que ser verdad, así que el aviso sale sí o sí;
  //  - un pedido de visita, una tasación o un propietario que quiere vender son leads calientes que
  //    siempre necesitan a alguien del equipo.
  const promisesTeam = PROMISES_TEAM.test(normalize(reply.reply_text));
  const notifyTeam =
    !routing.handoff &&
    (Boolean(reply.handoff_reason) ||
      promisesTeam ||
      makesOffer ||
      HOT_ROUTES.includes(routing.route) ||
      classification.containsVisitRequest >= policy.visitThreshold);
  // Visita: solo si pidió verla y hay UNA propiedad clara en la conversación. Con varias o ninguna
  // no se adivina: el bot pregunta cuál (así lo pide la ruta) y la visita se registra después.
  const visitRequested =
    !routing.handoff && (routing.route === "coordinar_visita" || classification.containsVisitRequest >= policy.visitThreshold);
  const visitRequest =
    visitRequested && offeredForTurn.offered.length === 1
      ? { propertyId: offeredForTurn.offered[0].property.id, note: `Lo que pidió el cliente: «${text.slice(0, 280)}»` }
      : null;

  const teamReason =
    // La oferta primero: es lo que más plata mueve y lo único que el bot no puede decidir.
    (makesOffer ? `Hizo una oferta: «${text.slice(0, 200)}». La decide el propietario.` : null) ??
    reply.handoff_reason ??
    (routing.route === "coordinar_visita" || classification.containsVisitRequest >= policy.visitThreshold
      ? "Pidió visitar una propiedad: hay que coordinar día y hora"
      : routing.route === "tasacion"
        ? "Pidió una tasación"
        : routing.route === "captacion_propietario"
          ? "Un propietario quiere ofrecer su propiedad"
          : promisesTeam
            ? "El agente le dijo al cliente que lo consultaba con el equipo"
            : null);

  return {
    disposition: mustHandoff ? "derivar" : finalText ? "responder" : "derivar",
    notifyTeam,
    visitRequest,
    text: finalText || null,
    shownPropertyIds: mustHandoff ? [] : selected.map((o) => o.property.id),
    classification,
    routing,
    retrieval,
    reply,
    replyModel: replyModelUsed,
    handoffReason: mustHandoff
      ? (reply.handoff_reason ?? routing.reason)
      : notifyTeam
        ? teamReason
        : finalText
          ? null
          : "El modelo no produjo texto",
    violations: [],
    source,
    error: null,
  };
}

/** Rutas donde la persona habla de SU propiedad: no se le muestran las del catálogo. */
const NO_LISTING_ROUTES: readonly Route[] = ["tasacion", "captacion_propietario"];

/** Leads calientes: siempre necesitan a alguien del equipo, aunque el bot conteste. */
const HOT_ROUTES: readonly Route[] = ["coordinar_visita", "tasacion", "captacion_propietario"];

/**
 * Promesas del bot que dependen de una persona. Si el texto dice esto, el equipo se entera sí o
 * sí: antes el bot decía "ya consulté con el equipo" y nadie recibía nada.
 * Se evalúa sobre el texto normalizado (sin tildes, minúsculas).
 */
const PROMISES_TEAM =
  /\b(?:(?:lo|la|te\s+lo|te\s+la)\s+consulto|consulte|consultare|voy\s+a\s+consultar|consultamos|le\s+(?:paso|aviso|consulto)|(?:paso|pasamos|traslado|derivo)\s+(?:tu|la|el)\s+(?:oferta|consulta|pedido|propuesta|caso)|(?:un|una|el|la)\s+(?:asesor|asesora|agente|persona)\s+(?:te|se)\s+(?:va\s+a\s+)?(?:contacta|comunica|llama|escribe|responde)|te\s+(?:va|van)\s+a\s+(?:contactar|llamar|escribir))/;

function emptyCriteria() {
  return { operation: null, propertyTypes: [], zones: [], priceMin: null, priceMax: null, currency: null, bedroomsMin: null };
}
export { PROMISES_TEAM as __PROMISES_TEAM_FOR_TESTS };
