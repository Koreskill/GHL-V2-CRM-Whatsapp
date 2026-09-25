import { extractAmounts, normalize } from "./catalog-search";

/**
 * Validación del texto que escribe el modelo, ANTES de mandarlo.
 *
 * El prompt ya prohíbe inventar. No alcanzó: con la lista de propiedades vacía y el cliente
 * insistiendo, el modelo inventó dos departamentos con precio, metros y amenities. Una regla en
 * el prompt es una instrucción, no una garantía. Esto es la garantía.
 *
 * Todo lo que se revisa es verificable contra datos: si el modelo nombra un precio, tiene que
 * ser el de una propiedad real o el presupuesto que dijo el cliente. No se juzga el tono ni el
 * estilo, que es subjetivo y daría falsos positivos.
 */

export type Violation = { code: string; detail: string };

export type GuardInput = {
  text: string;
  /** Montos que existen de verdad: precios de las propiedades ofrecidas + lo que dijo el cliente. */
  allowedAmounts: number[];
  /** Superficies (m²) de las propiedades ofrecidas. */
  allowedAreas: number[];
  /** Cuántas propiedades reales se encontraron para ofrecer. */
  offeredCount: number;
  /**
   * Cuántas alternativas existen (otra zona, apenas fuera de presupuesto). Si es 0, ofrecer
   * "opciones en zonas cercanas" es prometer algo que no existe. Opcional: sin el dato no se revisa.
   */
  alternativesCount?: number;
  /** Si este mensaje ya lleva fichas adjuntas. Entonces ofrecer "¿te mando la ficha?" es absurdo. */
  attaching?: boolean;
  /** El último mensaje que mandó el bot, para no repetirlo textual. */
  lastBotMessage?: string | null;
  /**
   * Qué medios existen de verdad entre las propiedades ofrecidas. Separados, porque que haya
   * fotos no significa que haya video: el modelo dijo "en la ficha vas a encontrar fotos y video"
   * de una propiedad que no tenía ni una cosa ni la otra.
   */
  media: { fotos: boolean; video: boolean; tour: boolean };
};

const TOLERANCE = 0.02;

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * TOLERANCE);

// Superficies escritas por el modelo: "65 m²", "65m2", "65 metros".
function extractAreas(text: string): number[] {
  const out: number[] = [];
  // Sin \b al final: "²" no es un carácter de palabra, así que "65 m² " no tiene límite de palabra
  // después y la regex nunca matcheaba. El control de superficies inventadas no funcionaba.
  for (const m of text.toLowerCase().matchAll(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|mts2?|metros(?:\s+cuadrados)?)(?![\p{L}\d])/gu)) {
    const n = Number(m[1].replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// "$ 58.000", "$58000": el signo pesos solo, que extractAmounts no ve cuando el número es corto.
function extractDollarSign(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/g)) {
    const n = Number(m[1].replace(/[.,]/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// "No tengo departamentos", "no hay propiedades", "no contamos con opciones".
// Tiene que nombrar propiedades: "no tengo ese dato" es honesto y NO es una falsa negativa.
const NO_STOCK =
  /\bno\s+(?:tengo|tenemos|hay|contamos\s+con|disponemos\s+de|dispongo\s+de|cuento\s+con|manejamos|me\s+figura[n]?)\b[^.?!]{0,40}\b(?:departamentos?|deptos?|casas?|propiedades?|opciones?|ph|locales?|oficinas?|terrenos?|cocheras?|nada\s+disponible|ninguna?|inmuebles?|alquileres?|ventas?|unidades?)\b/;

// Medios. Que haya fotos no significa que haya video: el modelo dijo "en la ficha vas a
// encontrar fotos y video" de una propiedad que no tenía ninguna de las dos cosas.
const MEDIA_WORDS: { key: "fotos" | "video" | "tour"; re: RegExp }[] = [
  { key: "fotos", re: /\b(?:fotos?|fotografias?|imagenes|imagen)\b/ },
  { key: "video", re: /\bvideos?\b/ },
  { key: "tour", re: /\b(?:tour|recorrido virtual|360)\b/ },
];
// Lo que vuelve honesta una oración que nombra un medio inexistente: negarlo o consultarlo.
const MEDIA_HONEST = /\b(?:no|sin|ningun[ao]?|consult\w*|averigu\w*|pid\w*|ped\w*|consegu\w*|consigo|chequ\w*|confirm\w*|todavia)\b/;

// Compromisos que el sistema no verificó.
const COMMITMENT =
  /\b(?:te\s+confirmo\s+la\s+visita|(?:la\s+)?visita\s+(?:queda|quedo)\s+(?:confirmada|agendada)|queda\s+agendad[ao]|te\s+la\s+reservo|queda\s+reservad[ao]|te\s+hago\s+un\s+descuento|te\s+(?:lo|la)\s+dejo\s+en)\b/;

// Rioplatense. "renta" y "colonia" salieron de verdad en una conversación: son de México.
// El tuteo se revisa con verbos concretos para no marcar un "tu" posesivo ("tu presupuesto").
const DIALECT: { re: RegExp; detail: string; accents?: boolean }[] = [
  { re: /\b(?:renta|rentar|rentas)\b/, detail: "dijo «renta»: en rioplatense es «alquiler»" },
  { re: /\bcolonias?\b/, detail: "dijo «colonia»: en rioplatense es «barrio»" },
  { re: /\brecamaras?\b/, detail: "dijo «recámara»: en rioplatense es «dormitorio»" },
  // El tuteo se busca CON tildes: "buscás" (voseo) y "buscas" (tuteo) difieren solo en la tilde,
  // y con el texto normalizado el validador frenaba respuestas correctas. \b de JS no toma las
  // letras acentuadas como parte de la palabra, por eso se delimita con \p{L}.
  {
    re: /(?<!\p{L})(?:tienes|quieres|puedes|necesitas|buscas|prefieres|deseas|sabes|tú)(?!\p{L})/u,
    detail: "tuteó: en rioplatense es vos (tenés, querés, podés)",
    accents: true,
  },
  { re: /\bvosotros\b|\bos\s+(?:paso|envio|mando)\b/, detail: "usó español de España" },
];

// "¿Te muestro opciones en zonas cercanas?", "puedo buscarte algo parecido".
const OFFERS_ALTERNATIVES =
  /\b(?:(?:opciones|alternativas|propiedades|algo)\s+(?:en\s+)?(?:otr[ao]s?\s+(?:zonas?|barrios?)|zonas?\s+cercanas?|barrios?\s+cercanos?|parecid[ao]s?|similares?)|(?:otr[ao]s?|cercan[ao]s?)\s+(?:zonas?|barrios?))\b/;

// Aspecto de aviso inmobiliario escrito a mano por el modelo: justo lo que inventó la vez pasada.
// Plazos que la inmobiliaria nunca definió: "dentro de las próximas 24 horas", "hoy mismo",
// "mañana te escribe". Salió de verdad en un acuse de reclamo.
const DEADLINE =
  /\b(?:(?:dentro\s+de|en)\s+(?:las\s+)?(?:proximas\s+)?(?:\d+|un[ao]?|dos|tres|pocas)\s+(?:horas?|hs|dias?|minutos?)|en\s+el\s+dia|hoy\s+mismo|antes\s+de\s+(?:hoy|manana|la\s+noche|el\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo))|manana\s+(?:te|se|lo|la|temprano|a\s+primera\s+hora)|esta\s+(?:tarde|noche)\s+te)\b/;

// Ofrecer mandar la ficha que ya va adjunta en el mismo mensaje: "¿querés que te la mande?" con la
// ficha abajo. El cliente no sabe si ya la recibió. Se evalúa sobre texto sin tildes pero CON los
// signos de pregunta (por eso no usa normalize, que los borra).
const OFFERS_TO_SEND =
  /\b(?:queres\s+que\s+te\s+(?:la|lo|las|los)\s+(?:mande|muestre|pase|envie)\b|queres\s+que\s+te\s+(?:mande|pase|envie|muestre)\s+(?:la|las)\s+fichas?\b|(?:te\s+)?(?:mando|paso|envio|muestro)\s+(?:la|las)\s+fichas?\s*\?|si\s+queres[^.?!]{0,30}\b(?:mando|paso|envio)\s+(?:la|las)\s+fichas?\b)/;

// Mismo cuidado con "m²" que en extractAreas: sin \b al final, que no hay límite de palabra después de "²".
const LISTING_SHAPE = /📍|🏠|💰|\b\d+\s*amb\.|\b\d+\s*(?:m²|m2)(?![\p{L}\d])/u;

export function checkReply(input: GuardInput): Violation[] {
  const violations: Violation[] = [];
  const raw = input.text;
  const norm = ` ${normalize(raw)} `;

  // 1. Montos que no existen.
  const amounts = [...new Set([...extractAmounts(raw), ...extractDollarSign(raw)])];
  for (const amount of amounts) {
    if (!input.allowedAmounts.some((ok) => near(amount, ok))) {
      violations.push({
        code: "monto_inventado",
        detail: `menciona ${amount.toLocaleString("es-AR")}, que no es el precio de ninguna propiedad ofrecida ni algo que dijo el cliente`,
      });
    }
  }

  // 2. Superficies que no existen.
  for (const area of extractAreas(raw)) {
    if (!input.allowedAreas.some((ok) => near(area, ok))) {
      violations.push({ code: "superficie_inventada", detail: `menciona ${area} m², que no figura en ninguna propiedad ofrecida` });
    }
  }

  // 3. Un aviso armado a mano cuando no hay ninguna propiedad real para mostrar.
  if (input.offeredCount === 0 && LISTING_SHAPE.test(raw)) {
    violations.push({
      code: "aviso_inventado",
      detail: "describe una propiedad con formato de aviso, pero la búsqueda no devolvió ninguna",
    });
  }

  // 4. Decir que no hay, cuando la búsqueda encontró.
  if (input.offeredCount > 0 && NO_STOCK.test(norm)) {
    violations.push({
      code: "falso_sin_stock",
      detail: `dice que no hay propiedades, pero la búsqueda encontró ${input.offeredCount}`,
    });
  }

  // 5. Afirmar medios que no existen. Oración por oración: una que nombra fotos, video o tour sin
  // decir que no están (o que se consultan) está afirmando que existen.
  const oraciones = raw.split(/[.!?\n]+/).map((o) => normalize(o));
  for (const { key, re } of MEDIA_WORDS) {
    if (input.media[key]) continue;
    if (oraciones.some((o) => re.test(o) && !MEDIA_HONEST.test(o))) {
      violations.push({
        code: "medio_inexistente",
        detail: `habla de ${key === "fotos" ? "fotos" : key === "video" ? "un video" : "un tour virtual"} como si existiera, pero ninguna propiedad ofrecida lo tiene cargado`,
      });
    }
  }

  // 5b. Ofrecer alternativas que no existen. El prompt ya lo prohíbe y el modelo lo hizo igual:
  // "¿te muestro opciones en zonas cercanas?" sin un solo alquiler disponible en todo el catálogo.
  if (input.offeredCount === 0 && input.alternativesCount === 0 && OFFERS_ALTERNATIVES.test(norm)) {
    violations.push({
      code: "alternativas_inexistentes",
      detail: "ofrece opciones en otras zonas o parecidas, pero no hay ninguna alternativa disponible",
    });
  }

  // 5b'. Prometer un plazo que nadie definió.
  if (DEADLINE.test(norm)) {
    violations.push({
      code: "plazo_inventado",
      detail: "promete un plazo de respuesta que la inmobiliaria no definió: decí «a la brevedad»",
    });
  }

  // 5c. Ofrecer mandar lo que ya va adjunto.
  const soft = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (input.attaching && OFFERS_TO_SEND.test(soft)) {
    violations.push({
      code: "ofrece_lo_enviado",
      detail: "ofrece mandar la ficha o mostrar la propiedad, pero la ficha YA va en este mismo mensaje: hablá en presente (te paso, acá tenés)",
    });
  }

  // 5d. Repetir textual el mensaje anterior (pasó ante un "sí" ambiguo).
  if (input.lastBotMessage) {
    const words = (t: string) => new Set(normalize(t).split(" ").filter((w) => w.length > 2));
    const a = words(raw);
    const b = words(input.lastBotMessage);
    const shared = [...a].filter((w) => b.has(w)).length;
    const similarity = a.size && b.size ? shared / Math.max(a.size, b.size) : 0;
    if (similarity >= 0.85) {
      violations.push({ code: "repite", detail: "repite casi igual el mensaje anterior: avanzá con lo que respondió el cliente" });
    }
  }

  // 6. Comprometerse a algo que el sistema no verificó.
  if (COMMITMENT.test(norm)) {
    violations.push({ code: "compromiso", detail: "confirma una visita, una reserva o un precio especial que el sistema no verificó" });
  }

  // 7. Dialecto.
  // Minúsculas CON tildes: \b de JS no reconoce letras acentuadas como parte de la palabra, por
  // eso el tuteo usa \p{L} en vez de \b.
  const withAccents = raw.toLowerCase();
  for (const { re, detail, accents } of DIALECT) {
    if (re.test(accents ? withAccents : norm)) violations.push({ code: "dialecto", detail });
  }

  return violations;
}

/** Instrucción para el segundo intento: qué estuvo mal, en concreto. */
export function correctionPrompt(violations: Violation[]): string {
  return [
    "Tu respuesta anterior NO se puede enviar. Tenía estos problemas:",
    ...violations.map((v) => `- ${v.detail}`),
    "",
    "Reescribila corrigiendo exactamente eso. Si un dato no está en el contexto, no lo pongas.",
    "Los precios, metros y características de las propiedades NO van en tu texto: van en las fichas, que se agregan solas con los datos reales.",
  ].join("\n");
}
