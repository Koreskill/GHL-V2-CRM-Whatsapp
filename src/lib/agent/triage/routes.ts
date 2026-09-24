import type { Intent, Urgency } from "./questions";

/**
 * Tabla de rutas DETERMINISTA.
 *
 * La ruta la elige el código, nunca el modelo: Jev devuelve una clasificación y acá se traduce a
 * un flujo. GPT recibe la ruta ya elegida y solo redacta. Si el modelo pudiera elegir la ruta,
 * un reclamo podría terminar contestado con un pitch comercial.
 */

export const ROUTES = [
  "busqueda_compra",
  "busqueda_alquiler",
  "captacion_propietario",
  "tasacion",
  "ficha_propiedad",
  "coordinar_visita",
  "derivar_reclamo",
  "derivar_humano",
  "seguimiento",
  "aclaracion",
  "spam",
] as const;

export type Route = (typeof ROUTES)[number];

/** Si la ruta escribe una respuesta comercial o solo prepara un borrador para una persona. */
export const HANDOFF_ROUTES: readonly Route[] = ["derivar_reclamo", "derivar_humano"] as const;

export const ROUTE_LABEL: Record<Route, string> = {
  busqueda_compra: "Búsqueda de compra",
  busqueda_alquiler: "Búsqueda de alquiler",
  captacion_propietario: "Captación del propietario",
  tasacion: "Tasación",
  ficha_propiedad: "Datos de la propiedad",
  coordinar_visita: "Coordinar visita",
  derivar_reclamo: "Reclamo: derivar",
  derivar_humano: "Pedido de atención humana",
  seguimiento: "Seguimiento de una gestión",
  aclaracion: "Pedir una aclaración",
  spam: "Spam",
};

/** Qué tiene que hacer GPT en cada ruta. Va dentro de su prompt. */
export const ROUTE_GOAL: Record<Route, string> = {
  busqueda_compra:
    "Entender qué busca para comprar y ofrecer solo propiedades en venta que estén en el contexto. Si faltan zona, presupuesto o ambientes, preguntá por lo que falte, de a poco.",
  busqueda_alquiler:
    "Entender qué busca para alquilar y ofrecer solo propiedades en alquiler que estén en el contexto. Si faltan zona, presupuesto o requisitos, preguntá por lo que falte.",
  captacion_propietario:
    "Es dueña de una propiedad y la quiere ofrecer. Agradecé, pedí los datos que faltan para evaluarla (tipo, ubicación, ambientes, estado) y explicá el paso siguiente. No prometas un precio ni condiciones de comisión.",
  tasacion:
    "Pide saber cuánto vale su propiedad. Explicá que la tasación la hace una persona del equipo y pedí los datos necesarios para coordinarla. NUNCA des un valor estimado.",
  ficha_propiedad:
    "Consulta por una propiedad concreta. Respondé SOLO con los datos de la ficha que está en el contexto. Si un dato no está, decí que lo vas a confirmar; no lo completes.",
  coordinar_visita:
    "Quiere ver una propiedad. Confirmá de qué propiedad se trata y pedí los días y horarios en que le queda cómodo. NO confirmes fecha ni hora: la agenda la confirma el equipo.",
  derivar_reclamo:
    "Hay un reclamo o disconformidad. Escribí un acuse breve: que se registró, que lo va a mirar una persona del equipo y cuándo. NO prometas una solución, no expliques causas ni asignes responsabilidades.",
  derivar_humano:
    "Pidió hablar con una persona. Confirmalo en una línea y avisá que alguien del equipo sigue la conversación. No intentes resolver la consulta.",
  seguimiento:
    "Pregunta por algo ya iniciado. Respondé SOLO con el estado que figura en el contexto. Si no hay estado registrado, decí que lo estás verificando con el equipo.",
  aclaracion:
    "No está claro qué necesita. Hacé UNA pregunta corta y concreta para entenderlo, sin suponer qué busca.",
  spam: "No corresponde responder.",
};

export type Decision = {
  intent: Intent;
  intentConfidence: number;
  containsVisitRequest: number;
  requiresHuman: number;
  urgency: Urgency;
};

export type RoutingPolicy = {
  /** Debajo de esta confianza en `intent`, no se enruta a ciegas: se pide aclaración o se deriva. */
  minConfidence: number;
  /** Desde esta probabilidad, `requires_human` manda por encima de la intención comercial. */
  humanThreshold: number;
  /** Desde esta probabilidad se considera que pidió una visita aunque no sea la intención principal. */
  visitThreshold: number;
};

export const DEFAULT_POLICY: RoutingPolicy = {
  // Valores de arranque, NO calibrados con mensajes reales. Se ajustan por inmobiliaria en
  // agent_configs y se recalibran con scripts/triage-calibrar.ts sobre mensajes etiquetados.
  minConfidence: 0.6,
  humanThreshold: 0.5,
  visitThreshold: 0.6,
};

export type RoutingResult = {
  route: Route;
  /** Por qué salió esa ruta. Queda registrado: sirve para entender una clasificación rara. */
  reason: string;
  /** La ruta prepara un borrador para una persona en vez de contestar sola. */
  handoff: boolean;
};

const INTENT_ROUTE: Record<Intent, Route> = {
  buy: "busqueda_compra",
  rent: "busqueda_alquiler",
  owner_sell: "captacion_propietario",
  owner_rent: "captacion_propietario",
  valuation: "tasacion",
  property_info: "ficha_propiedad",
  visit: "coordinar_visita",
  complaint: "derivar_reclamo",
  follow_up: "seguimiento",
  human_request: "derivar_humano",
  other: "aclaracion",
  spam: "spam",
};

/**
 * Traduce la clasificación de Jev a una ruta.
 *
 * El orden de las reglas ES la política, y no es arbitrario:
 *  1. Spam primero: no se abre conversación comercial ni se deriva a nadie.
 *  2. Pedido explícito de persona y reclamo, antes que cualquier respuesta comercial.
 *  3. `requires_human` alto, aunque la intención sea comercial.
 *  4. Confianza baja: se pide una aclaración en vez de enrutar a ciegas.
 *  5. Visita detectada dentro de otra consulta.
 *  6. Recién entonces, la intención principal.
 */
export function routeFor(decision: Decision, policy: RoutingPolicy = DEFAULT_POLICY): RoutingResult {
  const { intent, intentConfidence, requiresHuman, containsVisitRequest } = decision;

  if (intent === "spam") {
    return { route: "spam", reason: "Clasificado como spam", handoff: false };
  }

  if (intent === "human_request") {
    return { route: "derivar_humano", reason: "Pidió hablar con una persona", handoff: true };
  }

  if (intent === "complaint") {
    return { route: "derivar_reclamo", reason: "Reclamo o disconformidad", handoff: true };
  }

  if (requiresHuman >= policy.humanThreshold) {
    return {
      route: "derivar_reclamo",
      reason: `Necesita una persona (${requiresHuman.toFixed(2)} ≥ ${policy.humanThreshold})`,
      handoff: true,
    };
  }

  // Baja confianza: preguntar es más barato que contestar sobre una intención equivocada.
  if (intentConfidence < policy.minConfidence) {
    return {
      route: "aclaracion",
      reason: `Confianza baja en la intención (${intentConfidence.toFixed(2)} < ${policy.minConfidence})`,
      handoff: false,
    };
  }

  // Una visita pedida dentro de otra consulta se atiende primero: tiene fecha, lo demás no.
  if (containsVisitRequest >= policy.visitThreshold && intent !== "visit") {
    return {
      route: "coordinar_visita",
      reason: `Pidió una visita dentro de una consulta de tipo ${intent}`,
      handoff: false,
    };
  }

  const route = INTENT_ROUTE[intent];
  return { route, reason: `Intención ${intent}`, handoff: HANDOFF_ROUTES.includes(route) };
}
