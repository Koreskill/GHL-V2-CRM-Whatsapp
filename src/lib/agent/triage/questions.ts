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
    // OJO con agrandar este criterio. Tenía "el mensaje es ambiguo" y "falta información para
    // responder", y eso describe CUALQUIER primer mensaje: "Quiero información" se derivaba a una
    // persona y apagaba el bot. La ambigüedad se resuelve preguntando (ruta de aclaración), no
    // derivando. Esto es solo para lo que un bot no debe tocar.
    criteria: {
      true: "Hay un reclamo, enojo o disconformidad; pide explícitamente hablar con una persona; toca un asunto legal, contractual o financiero delicado (rescisión, depósito de garantía, mora, deuda, escritura, juicio, estafa); o hay una situación de riesgo o urgencia personal.",
      false:
        "Es una consulta comercial o un mensaje corriente, aunque sea breve, vago o le falten datos: un saludo, un «quiero información», una pregunta por propiedades, precios, zonas, fotos o visitas. Que falten datos NO requiere una persona: se le pregunta.",
    },
  },

  // Una oferta no es una intención aparte (quien ofrece sigue queriendo comprar), así que el
  // modelo a veces la pasaba y a veces no: una vez contestó "el precio está fijado y no puedo
  // modificarlo" a un comprador con efectivo, sin avisarle a nadie. Aceptar o rechazar una oferta
  // lo decide el propietario, nunca el bot.
  hace_oferta: {
    type: "noul",
    instructions:
      "¿El contacto propone un precio distinto al publicado, hace una contraoferta o pide una rebaja o descuento?",
    criteria: {
      true: "Ofrece un monto menor al publicado («¿me lo dejan en 75?», «ofrezco 80 mil»), pide descuento o rebaja, pregunta si el precio es negociable, o condiciona la compra a un precio distinto.",
      false: "Pregunta el precio, dice su presupuesto para buscar, o comenta que algo es caro sin proponer otro monto ni pedir rebaja.",
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

// ─── Fase 13: etiquetado del contacto ───────────────────────────────────────
// Estas preguntas SOLO tienen sentido tipadas: operación, tipo, urgencia, forma de pago y
// temperatura son conjuntos cerrados. Las zonas, el presupuesto y los ambientes son valores
// libres, y esos los extrae GPT (ver triage/extract.ts): ninguna pregunta de opciones los
// puede devolver.
//
// Se preguntan sobre la CONVERSACIÓN ENTERA, no solo el último mensaje: si en el tercer mensaje
// dijo "alquiler" y ahora pregunta por expensas, la operación sigue siendo alquiler.

export const TEMPERATURES = ["frio", "tibio", "caliente"] as const;
export const URGENCIES = ["explorando", "meses", "ya"] as const;

export const TAG_QUESTIONS: Record<string, DecisionQuestion> = {
  operacion: {
    type: "choice",
    instructions:
      "Según todo lo que dijo el contacto en la conversación, ¿qué operación busca? Si nunca lo dijo ni se deduce, elegí desconocida.",
    criteria: {
      venta: "Quiere comprar, o es dueño y quiere vender.",
      alquiler: "Quiere alquilar, o es dueño y quiere poner en alquiler, por plazo largo.",
      temporario: "Alquiler por días, semanas o temporada.",
      desconocida: "No lo dijo y no se puede deducir con seguridad de lo que escribió.",
    },
  },

  tipo_propiedad: {
    type: "choice",
    instructions: "¿Qué tipo de inmueble busca u ofrece? Si no lo dijo, elegí desconocido.",
    criteria: {
      departamento: "Departamento, depto, monoambiente, 2 ambientes, etc.",
      casa: "Casa, chalet, vivienda unifamiliar.",
      ph: "PH, casa tipo PH, propiedad horizontal.",
      terreno: "Terreno, lote, fracción.",
      local: "Local comercial, fondo de comercio.",
      oficina: "Oficina, espacio de trabajo.",
      cochera: "Cochera, garaje, baulera.",
      desconocido: "No mencionó el tipo de inmueble.",
    },
  },

  urgencia: {
    type: "score",
    instructions: "¿En qué plazo necesita resolver? Tomá lo que dijo, no lo supongas por el tono.",
    // El orden define la escala: 0 explorando, 1 meses, 2 ya.
    criteria: [
      "Está mirando, sin fecha ni apuro. Curioseando el mercado.",
      "Quiere resolver en los próximos meses; tiene una ventana pero no es inmediata.",
      "Necesita resolver ya: se le vence el contrato, se muda por trabajo, o lo dijo explícitamente.",
    ],
  },

  forma_pago: {
    type: "choice",
    instructions: "¿Cómo va a pagar? Solo si lo dijo; no lo deduzcas del presupuesto.",
    criteria: {
      contado: "Paga al contado, con fondos propios, sin financiación.",
      credito: "Usa un crédito hipotecario, financiación bancaria o un programa estatal de vivienda.",
      desconocida: "No habló de cómo va a pagar.",
    },
  },

  temperatura: {
    type: "score",
    instructions:
      "¿Qué tan cerca está de concretar una operación? Mirá la conversación entera, no solo el último mensaje.",
    // 0 frío, 1 tibio, 2 caliente.
    criteria: [
      "Frío: solo explora, está fuera de presupuesto, no tiene urgencia, o no dio ningún dato concreto.",
      "Tibio: interés real y algún dato concreto, pero falta algo clave (presupuesto, zona o plazo).",
      "Caliente: presupuesto acorde, urgencia inmediata y quiere ver una propiedad o avanzar ya.",
    ],
  },

  interes_propiedad: {
    type: "noul",
    instructions:
      "¿Mostró interés concreto en alguna de las propiedades que ya se le mostraron en esta conversación?",
    criteria: {
      true: "Pidió fotos, la ficha, el precio, la dirección, una visita, o dijo que le gusta o le interesa una propiedad puntual.",
      false:
        "No mencionó ninguna propiedad concreta, o solo describió lo que busca en general sin referirse a una que se le mostró.",
    },
  },
};
