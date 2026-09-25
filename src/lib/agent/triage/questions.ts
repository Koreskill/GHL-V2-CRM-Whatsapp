import type { DecisionQuestion } from "@/lib/ai/decisions";

/**
 * Lo que se le pregunta a Jev, en UNA sola llamada por mensaje.
 *
 * Jev CLASIFICA y devuelve decisiones tipadas. No redacta: el texto lo escribe GPT después,
 * siguiendo la ruta que decide el código.
 *
 * Cada pregunta se manda entera (instrucciones + criterios) en CADA mensaje y se paga por token
 * de entrada. Así que acá no hay nada de adorno: si una respuesta se puede derivar en código a
 * partir de otra, no se pregunta. Antes eran 11 preguntas y 1.641 tokens fijos por mensaje.
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

// Orden de menor a mayor: el índice ES el nivel que devuelve un score.
export const TEMPERATURES = ["frio", "tibio", "caliente"] as const;
export const URGENCIES = ["explorando", "meses", "ya"] as const;

// Criterios cortos a propósito. Describen CUÁNDO aplica cada opción, no qué palabra aparece:
// clasificar por palabras sueltas confunde "alquilé el año pasado" con alguien que busca alquilar.
const INTENT_CRITERIA: Record<Intent, string> = {
  buy: "Quiere comprar una propiedad para sí.",
  rent: "Quiere alquilar una propiedad para sí.",
  owner_sell: "ES dueño y quiere vender su propiedad o publicarla con la inmobiliaria.",
  owner_rent: "ES dueño y quiere alquilar su propiedad o que se la administren.",
  valuation: "Quiere saber cuánto vale una propiedad SUYA. Todavía no decide si vende o alquila.",
  property_info: "Pregunta por una propiedad CONCRETA ya identificada: precio, expensas, superficie, fotos, disponibilidad.",
  visit: "Quiere coordinar, confirmar, reprogramar o cancelar una visita.",
  complaint: "Reclama, se queja, o expresa enojo o disconformidad.",
  follow_up: "Pregunta por el estado de algo ya iniciado: si hubo novedades, cómo sigue.",
  human_request: "Pide hablar con una persona o un asesor, o no querer hablar con un bot.",
  other: "Otra cosa, o demasiado breve o vago para saber qué quiere (un saludo, una palabra suelta).",
  spam: "Publicidad ajena, cadenas o estafas: nada que ver con la inmobiliaria.",
};

/**
 * Lo que decide la ruta.
 *
 * Qué se sacó de acá y por qué:
 *  - `operacion` (venta/alquiler): ya la dice el intent (buy→venta, rent→alquiler). Encima miraba
 *    TODA la conversación, así que se quedaba con la operación vieja cuando el cliente cambiaba:
 *    alguien preguntó por alquiler en Pichincha y después "¿y en venta?", y el bot buscó
 *    alquileres y contestó "tampoco tengo en venta" teniendo uno publicado.
 *  - `urgency` (qué tan urgente es responder): se deriva en código con `urgencyFor`, a partir de
 *    la intención y del plazo que dijo el cliente. Era una pregunta que se solapaba con `urgencia`.
 *  - `forma_pago`: lo captura la extracción cuando el cliente lo menciona, que es poco frecuente.
 */
export const TRIAGE_QUESTIONS: Record<string, DecisionQuestion> = {
  intent: {
    type: "choice",
    instructions:
      "Intención PRINCIPAL del último mensaje. Usá el contexto para desambiguar, pero clasificá el ÚLTIMO mensaje: si antes hablaba de alquiler y ahora pregunta por venta, es venta. Un reclamo o un pedido de hablar con una persona pesan más que una consulta comercial.",
    criteria: INTENT_CRITERIA,
  },

  contains_visit_request: {
    type: "noul",
    instructions: "¿Pide ver la propiedad en persona, aunque no sea lo principal del mensaje?",
    criteria: {
      true: "Pide verla, propone o pregunta por un día u horario, o quiere cambiar o cancelar una visita.",
      false: "No menciona ir a verla. Pedir fotos, video o ubicación NO es pedir una visita.",
    },
  },

  requires_human: {
    type: "noul",
    instructions: "¿Necesita que lo atienda una persona en lugar de una respuesta automática?",
    // OJO al agrandar esto: decía "el mensaje es ambiguo" y "falta información para responder", y
    // eso describe cualquier primer mensaje. Un "Quiero información" se derivaba y apagaba el bot.
    criteria: {
      true: "Reclamo, enojo o disconformidad; pide hablar con una persona; asunto legal, contractual o financiero delicado (depósito, mora, deuda, escritura, juicio, estafa); o riesgo.",
      false:
        "Consulta comercial o mensaje corriente, aunque sea breve o vago. Que falten datos NO requiere una persona: se le pregunta.",
    },
  },

  hace_oferta: {
    type: "noul",
    instructions: "¿Propone un precio distinto al publicado, o pide rebaja o descuento?",
    criteria: {
      true: "Ofrece un monto menor, pide descuento o rebaja, o pregunta si el precio es negociable.",
      false: "Pregunta el precio o dice su presupuesto para buscar, sin proponer otro monto.",
    },
  },
};

/**
 * Etiquetas del contacto. Van en la MISMA llamada que las de arriba: son preguntas sobre el mismo
 * estado, y mandarlo dos veces sería pagar el contexto dos veces.
 *
 * Solo lo que es un conjunto cerrado. Zonas, presupuesto y ambientes son valores libres y los
 * extrae el modelo de chat (triage/extract.ts): una pregunta de opciones no los puede devolver.
 */
export const TAG_QUESTIONS: Record<string, DecisionQuestion> = {
  tipo_propiedad: {
    type: "choice",
    instructions: "¿Qué tipo de inmueble busca u ofrece? Si no lo dijo, desconocido.",
    criteria: {
      departamento: "Departamento, depto, monoambiente, dúplex.",
      casa: "Casa, chalet, vivienda unifamiliar.",
      ph: "PH o casa tipo pasillo.",
      terreno: "Terreno o lote.",
      local: "Local comercial.",
      oficina: "Oficina.",
      cochera: "Cochera o garaje.",
      desconocido: "No mencionó el tipo.",
    },
  },

  urgencia: {
    type: "score",
    instructions: "¿En qué plazo necesita resolver? Tomá lo que dijo, no lo deduzcas del tono.",
    criteria: [
      "Mirando, sin fecha ni apuro.",
      "Quiere resolver en los próximos meses.",
      "Necesita resolver ya: se le vence el contrato, se muda, o lo dijo explícitamente.",
    ],
  },

  temperatura: {
    type: "score",
    instructions: "¿Qué tan cerca está de concretar? Mirá la conversación entera.",
    criteria: [
      "Frío: solo explora, sin urgencia ni datos concretos.",
      "Tibio: interés real, pero falta un dato clave (presupuesto, zona o plazo).",
      "Caliente: presupuesto acorde, urgencia, y quiere ver una propiedad o avanzar.",
    ],
  },

  interes_propiedad: {
    type: "noul",
    instructions: "¿Mostró interés concreto en alguna propiedad que ya se le mostró?",
    criteria: {
      true: "Pidió fotos, precio, dirección o visita de una propiedad puntual, o dijo que le interesa.",
      false: "No mencionó ninguna propiedad concreta de las mostradas.",
    },
  },
};

/**
 * Urgencia de ATENCIÓN, para ordenar lo que ve el equipo en la campanita.
 * Se deriva en código: era una pregunta más a Jev que se solapaba con `urgencia`. Lo que importa
 * para priorizar ya está en la intención y en el plazo que dijo el cliente.
 */
export function urgencyFor(
  intent: Intent,
  plazo: (typeof URGENCIES)[number] | null,
  pideVisita: boolean,
): Urgency {
  if (intent === "complaint" || intent === "human_request" || plazo === "ya") return "alto";
  if (pideVisita || intent === "visit" || intent === "follow_up" || plazo === "meses") return "medio";
  return "bajo";
}
