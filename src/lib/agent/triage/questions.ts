import type { DecisionQuestion } from "@/lib/ai/decisions";

/**
 * Lo que se le pregunta a Jev.
 *
 * Jev CLASIFICA y devuelve decisiones tipadas. No redacta: el texto lo escribe GPT después,
 * siguiendo la ruta que decide el código.
 *
 * Los criterios se escriben en castellano y describen CUÁNDO aplica cada opción, no qué palabra
 * aparece: una clasificación por palabras sueltas confunde "alquilé el año pasado" con un alquiler.
 */

export const INTENTS = [
  "buy",
  "rent",
  "owner_sell",
  "owner_rent",
  "valuation",
  "property_info",
  "visit",
  "complaint",
  "follow_up",
  "human_request",
  "other",
  "spam",
] as const;

export type Intent = (typeof INTENTS)[number];

export const INTENT_LABEL: Record<Intent, string> = {
  buy: "Busca comprar",
  rent: "Busca alquilar",
  owner_sell: "Ofrece una propiedad en venta",
  owner_rent: "Ofrece una propiedad en alquiler",
  valuation: "Pide una tasación",
  property_info: "Consulta por una propiedad",
  visit: "Coordina una visita",
  complaint: "Reclamo o disconformidad",
  follow_up: "Consulta por una gestión previa",
  human_request: "Pide hablar con una persona",
  other: "Otra intención",
  spam: "Spam",
};

// La escala de urgencia va de menor a mayor: el ORDEN del array es la escala.
export const URGENCY_LEVELS = ["bajo", "medio", "alto"] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

const INTENT_CRITERIA: Record<Intent, string> = {
  buy: "La persona busca comprar una propiedad para sí misma: pregunta por propiedades en venta, precios de compra, zonas o financiación para comprar.",
  rent: "La persona busca alquilar una propiedad para sí misma: pregunta por propiedades en alquiler, requisitos, garantías o expensas como inquilina.",
  owner_sell:
    "La persona ES dueña de una propiedad y quiere ofrecerla para la venta, o pregunta cómo publicarla o venderla con la inmobiliaria.",
  owner_rent:
    "La persona ES dueña de una propiedad y quiere ofrecerla en alquiler, o pregunta cómo publicarla o administrarla con la inmobiliaria.",
  valuation:
    "Pide saber cuánto vale una propiedad: una tasación, valuación o estimación de precio, sin decidir todavía si la vende o alquila.",
  property_info:
    "Pregunta por una propiedad CONCRETA ya identificada: datos, precio, expensas, superficie, estado, fotos o disponibilidad de ese aviso puntual.",
  visit: "Quiere coordinar, confirmar, reprogramar o cancelar una visita a una propiedad.",
  complaint:
    "Presenta un reclamo o expresa disconformidad, enojo o queja por el servicio, una propiedad, una demora o una gestión.",
  follow_up:
    "Pregunta por el estado de una gestión, consulta o conversación ANTERIOR: si hubo novedades, si le respondieron, cómo sigue algo ya iniciado.",
  human_request:
    "Pide explícitamente hablar con una persona, un asesor, un humano, o dejar de hablar con un bot.",
  other:
    "Otra intención, o el mensaje es demasiado breve o ambiguo para saber qué quiere (un saludo suelto, un «hola», una sola palabra).",
  spam: "Mensaje irrelevante o no comercial: publicidad ajena, cadenas, intentos de estafa, mensajes automáticos sin relación con la inmobiliaria.",
};

/**
 * Las cuatro preguntas. Las claves son las que se leen después en la respuesta.
 *
 * Si el mensaje tiene más de una intención, `intent` se queda con la principal y las secundarias
 * quedan en las probabilidades. `contains_visit_request` existe justamente para no perder un
 * pedido de visita que viaja dentro de otra consulta.
 */
export const TRIAGE_QUESTIONS: Record<string, DecisionQuestion> = {
  intent: {
    type: "choice",
    instructions:
      "¿Cuál es la intención PRINCIPAL del último mensaje del contacto? Considerá el contexto reciente de la conversación para desambiguar, pero clasificá el último mensaje. Si expresa varias intenciones, elegí la que motiva el mensaje; un reclamo o un pedido de hablar con una persona pesan más que una consulta comercial.",
    criteria: INTENT_CRITERIA,
  },

  contains_visit_request: {
    type: "noul",
    instructions:
      "¿El mensaje incluye un pedido de visita, aunque no sea la intención principal? Sirve para no perder un «¿puedo verlo el sábado?» dentro de otra consulta.",
    criteria: {
      true: "Pide ver la propiedad en persona, propone o pregunta por un día u horario, o quiere cambiar o cancelar una visita ya pactada.",
      false:
        "No menciona ver la propiedad en persona. Pedir fotos, videos, un tour virtual o la ubicación NO es pedir una visita.",
    },
  },

  requires_human: {
    type: "noul",
    instructions:
      "¿Este mensaje necesita que lo atienda una persona del equipo en lugar de una respuesta automática?",
    criteria: {
      true: "Hay un reclamo, enojo o disconformidad; pide hablar con una persona; toca un asunto legal, contractual o financiero delicado (rescisión, depósito, mora, escritura, juicio); hay una situación de riesgo; el mensaje es ambiguo en algo importante; o falta información para responder con seguridad.",
      false:
        "Es una consulta comercial corriente que se puede contestar con los datos verificados de la inmobiliaria, sin comprometer nada que el sistema no haya confirmado.",
    },
  },

  urgency: {
    type: "score",
    instructions: "¿Qué tan urgente es responder este mensaje?",
    // El orden define la escala: 0 = bajo, 1 = medio, 2 = alto.
    criteria: [
      "Consulta general, sin apuro explícito ni plazo: pregunta amplia, curiosidad, primer contacto sin fecha.",
      "Busca disponibilidad, un dato concreto o coordinar una acción: espera respuesta en el día, pero nada se vence.",
      "Reclamo urgente, visita inminente, operación con plazo inmediato o situación sensible: demorar tiene consecuencias.",
    ],
  },
};
