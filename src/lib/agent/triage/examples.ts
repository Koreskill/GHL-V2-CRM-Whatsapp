import type { Intent } from "./questions";
import type { Route } from "./routes";

/**
 * Mensajes etiquetados a mano, de los que llegan de verdad a una inmobiliaria.
 *
 * Sirven para dos cosas distintas:
 *  - `scripts/test-triage.ts` comprueba la tabla de rutas SIN llamar a ningún modelo: dada una
 *    clasificación, ¿sale la ruta correcta? Es determinista y gratis.
 *  - `scripts/triage-calibrar.ts` los manda a Jev de verdad y mide cuánto acierta y qué umbral
 *    de confianza conviene. Eso cuesta tokens, así que se corre a mano.
 *
 * El umbral por defecto (0.6) NO está calibrado: es un punto de partida. Hay que correr la
 * calibración con mensajes reales de la inmobiliaria antes de tratarlo como una garantía.
 */

export type LabeledExample = {
  id: string;
  mensaje: string;
  /** Intención principal esperada. */
  intent: Intent;
  /** Ruta esperada al pasar por la tabla. */
  route: Route;
  /** Si el mensaje pide una visita, aunque no sea la intención principal. */
  visita?: boolean;
  /** Si tiene que terminar en manos de una persona. */
  humano?: boolean;
  nota?: string;
};

export const LABELED_EXAMPLES: LabeledExample[] = [
  // ── Compra ──
  {
    id: "compra-simple",
    mensaje: "Hola! Estoy buscando un 2 ambientes para comprar en Palermo, hasta 120 mil dólares.",
    intent: "buy",
    route: "busqueda_compra",
  },
  {
    id: "compra-sin-datos",
    mensaje: "Buenas, quería ver opciones para comprar departamento.",
    intent: "buy",
    route: "busqueda_compra",
    nota: "Faltan zona y presupuesto: la respuesta tiene que preguntarlos.",
  },

  // ── Alquiler ──
  {
    id: "alquiler-simple",
    mensaje: "Hola, busco alquilar un monoambiente en Caballito. ¿Qué requisitos piden de garantía?",
    intent: "rent",
    route: "busqueda_alquiler",
  },

  // ── Propietario ──
  {
    id: "propietario-venta",
    mensaje: "Buen día, tengo un departamento en Villa Crespo y lo quiero poner en venta. ¿Cómo hacemos?",
    intent: "owner_sell",
    route: "captacion_propietario",
  },
  {
    id: "propietario-alquiler",
    mensaje: "Tengo una casa vacía en Tigre y la quiero alquilar. ¿Uds administran?",
    intent: "owner_rent",
    route: "captacion_propietario",
    nota: "owner_sell y owner_rent comparten ruta: el flujo de captación es el mismo.",
  },

  // ── Tasación ──
  {
    id: "tasacion",
    mensaje: "Quería saber cuánto vale hoy mi PH de 3 ambientes en Almagro.",
    intent: "valuation",
    route: "tasacion",
    nota: "NUNCA se responde con un valor estimado: se coordina una tasación.",
  },

  // ── Consulta por una propiedad ──
  {
    id: "ficha-precio",
    mensaje: "Hola, vi el aviso del depto de Thames al 1500. ¿Cuánto son las expensas?",
    intent: "property_info",
    route: "ficha_propiedad",
  },

  // ── Visita ──
  {
    id: "visita-directa",
    mensaje: "¿Puedo ir a verlo el sábado a la mañana?",
    intent: "visit",
    route: "coordinar_visita",
    visita: true,
  },
  {
    id: "visita-reprogramar",
    mensaje: "No voy a poder ir mañana a las 10, ¿lo podemos pasar para el jueves?",
    intent: "visit",
    route: "coordinar_visita",
    visita: true,
  },

  // ── Reclamo ──
  {
    id: "reclamo",
    mensaje: "Hace una semana que pregunto por el depto y nadie me contesta. Un desastre la atención.",
    intent: "complaint",
    route: "derivar_reclamo",
    humano: true,
  },
  {
    id: "reclamo-contractual",
    mensaje:
      "Me quieren retener el depósito y en el contrato no dice eso. Si no lo resuelven voy a consumidor.",
    intent: "complaint",
    route: "derivar_reclamo",
    humano: true,
    nota: "Asunto legal: jamás una respuesta automática.",
  },

  // ── Seguimiento ──
  {
    id: "seguimiento",
    mensaje: "Hola, ¿hubo alguna novedad con lo que hablamos la semana pasada?",
    intent: "follow_up",
    route: "seguimiento",
  },

  // ── Pedido de humano ──
  {
    id: "pide-humano",
    mensaje: "Prefiero hablar con una persona, no con un bot.",
    intent: "human_request",
    route: "derivar_humano",
    humano: true,
  },

  // ── Ambiguo ──
  {
    id: "ambiguo-saludo",
    mensaje: "Hola",
    intent: "other",
    route: "aclaracion",
    nota: "Un saludo suelto no alcanza para enrutar: se pregunta qué necesita.",
  },
  {
    id: "ambiguo-corto",
    mensaje: "Info",
    intent: "other",
    route: "aclaracion",
  },

  // ── Varias intenciones a la vez ──
  {
    id: "multi-compra-visita",
    mensaje: "Me interesa el 3 ambientes de Colegiales para comprar. ¿Se puede visitar el viernes?",
    intent: "buy",
    route: "coordinar_visita",
    visita: true,
    nota: "La visita tiene fecha; la búsqueda no. La visita se atiende primero.",
  },
  {
    id: "multi-consulta-reclamo",
    mensaje:
      "Quería saber el precio del depto de Serrano, pero la verdad estoy muy molesto porque ya llamé tres veces y nadie me atendió.",
    intent: "complaint",
    route: "derivar_reclamo",
    humano: true,
    nota: "El reclamo pesa más que la consulta comercial, aunque haya una pregunta de precio.",
  },
  {
    id: "multi-propietario-tasacion",
    mensaje: "Tengo un depto para vender, pero primero quiero saber cuánto vale.",
    intent: "valuation",
    route: "tasacion",
    nota: "Lo que pide AHORA es la tasación; la captación viene después.",
  },

  // ── Spam ──
  {
    id: "spam",
    mensaje: "🔥 GANÁ DINERO DESDE CASA 🔥 Sumate a nuestro grupo de inversiones cripto: bit.ly/xxxx",
    intent: "spam",
    route: "spam",
  },
];
