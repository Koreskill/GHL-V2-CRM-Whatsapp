import { aiChatComplete } from "@/lib/ai/openrouter";
import { safeError } from "@/lib/safe-error";
import type { TriageContext } from "./context";

/**
 * Extracción de los valores LIBRES del perfil: zonas, presupuesto, ambientes, tipo de crédito.
 *
 * Esto NO lo puede hacer Jev: la Decisions API responde preguntas tipadas (elegir una opción,
 * una probabilidad, un nivel de una escala). "Pichincha y Centro" o "hasta 60.000" no son
 * opciones de un conjunto cerrado, así que van por el modelo de chat, con la función
 * `extraccion` que ya existe en ai_usage_logs.
 *
 * Devuelve SOLO lo que cambia: los campos que ya estaban bien no se repiten, y lo que el
 * contacto nunca dijo queda fuera. Así una respuesta vacía no borra el perfil acumulado.
 */

export type ExtractedFields = {
  zonas?: string[];
  presupuesto_min?: number | null;
  presupuesto_max?: number | null;
  moneda?: string | null;
  ambientes?: number | null;
  dormitorios?: number | null;
  tipo_credito?: string | null;
  // ── Para el puntaje de compatibilidad ──
  banos_min?: number | null;
  superficie_min?: number | null;
  provincia?: string | null;
  /** Solo true si el contacto dijo que puede estirar el presupuesto. Nunca se supone. */
  presupuesto_flexible?: boolean | null;
  amenities_requeridos?: string[];
  amenities_preferidos?: string[];
  excluir?: string[];
  /** Criterios que el contacto dijo que son INDISPENSABLES (no solo preferencias). */
  estrictos?: StrictField[];
  /** 0–1: qué tan claro quedó lo extraído en este mensaje. */
  confianza?: number;
};

export const STRICT_FIELDS = ["presupuesto", "zona", "dormitorios", "banos", "tipo", "superficie"] as const;
export type StrictField = (typeof STRICT_FIELDS)[number];

export type ExtractResult =
  | { success: true; fields: ExtractedFields }
  | { success: false; error: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    zonas: { type: "array", items: { type: "string" }, description: "Barrios o zonas que nombró." },
    presupuesto_min: { type: ["number", "null"] },
    presupuesto_max: { type: ["number", "null"] },
    moneda: { type: ["string", "null"], description: "ARS, USD u otra que haya nombrado." },
    ambientes: { type: ["integer", "null"] },
    dormitorios: { type: ["integer", "null"] },
    tipo_credito: { type: ["string", "null"], description: "Infonavit, Fovissste, bancario, UVA…" },
    banos_min: { type: ["integer", "null"] },
    superficie_min: { type: ["number", "null"], description: "Metros cuadrados mínimos." },
    provincia: { type: ["string", "null"] },
    presupuesto_flexible: { type: ["boolean", "null"], description: "true SOLO si dijo que puede pasarse del presupuesto." },
    amenities_requeridos: { type: "array", items: { type: "string" }, description: "Lo que dijo que TIENE que tener (indispensable)." },
    amenities_preferidos: { type: "array", items: { type: "string" }, description: "Lo que le gustaría, sin ser indispensable." },
    excluir: { type: "array", items: { type: "string" }, description: "Lo que NO quiere que tenga." },
    estrictos: { type: "array", items: { type: "string", enum: ["presupuesto", "zona", "dormitorios", "banos", "tipo", "superficie"] }, description: "Criterios que dijo que son indispensables." },
    confianza: { type: "number", description: "0 a 1: qué tan claro quedó lo que extrajiste." },
  },
} as const;

const SYSTEM = `Extraés datos de una conversación inmobiliaria. No redactás nada.

Devolvés un JSON con SOLO los campos que el contacto dijo o confirmó en el último mensaje y que
cambian respecto del perfil actual.

Reglas que no se rompen:
- No inventes un dato que el contacto no dijo. Si no lo dijo, el campo NO va en la respuesta.
- No repitas un campo que ya está igual en el perfil actual.
- "2 ambientes" son ambientes, no dormitorios. Un monoambiente es 1 ambiente y 0 dormitorios.
- El presupuesto va como número entero, sin puntos ni símbolos: "60 mil" es 60000, "60k" es 60000.
- Si dice "hasta X", es presupuesto_max. Si dice "desde X", es presupuesto_min.
- Si el contacto CORRIGE un dato anterior, devolvé el valor nuevo.
- Para vaciar un campo que el contacto descartó explícitamente, devolvelo como null.
- amenities_requeridos: solo lo que dijo con palabras como "indispensable", "tiene que tener", "sí o sí", "necesito". Si dice "me gustaría" o "ideal", va en amenities_preferidos.
- estrictos: solo los criterios que el contacto marcó como obligatorios ("máximo", "no puedo pasar de", "tiene que ser en", "mínimo tres dormitorios"). Un dato dicho sin esa fuerza NO va en estrictos.
- presupuesto_flexible: true SOLO si dijo que puede estirarse o que es negociable. Si no lo dijo, no pongas el campo.
- excluir: lo que dijo que no quiere ("sin escaleras", "no quiero planta baja").
- confianza: 0.9 o más si lo dijo claro; menos si lo inferís de una frase ambigua.

Si no hay nada nuevo, devolvé {}.`;

function parse(raw: string): ExtractedFields | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  const out: ExtractedFields = {};

  // Cada campo se valida: structured outputs no está garantizado en todos los proveedores.
  if (Array.isArray(p.zonas)) {
    const zonas = p.zonas.filter((z): z is string => typeof z === "string" && z.trim() !== "");
    if (zonas.length) out.zonas = [...new Set(zonas.map((z) => z.trim()))].slice(0, 10);
  }

  // `null` es un valor con significado (vaciar el campo), así que se distingue de "no vino".
  const money = (key: "presupuesto_min" | "presupuesto_max") => {
    if (!(key in p)) return;
    const v = p[key];
    if (v === null) out[key] = null;
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  };
  money("presupuesto_min");
  money("presupuesto_max");

  const count = (key: "ambientes" | "dormitorios") => {
    if (!(key in p)) return;
    const v = p[key];
    if (v === null) out[key] = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 30) out[key] = v;
  };
  count("ambientes");
  count("dormitorios");

  if ("moneda" in p) {
    const v = p.moneda;
    if (v === null) out.moneda = null;
    else if (typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim())) out.moneda = v.trim().toUpperCase();
  }

  if ("tipo_credito" in p) {
    const v = p.tipo_credito;
    if (v === null) out.tipo_credito = null;
    else if (typeof v === "string" && v.trim()) out.tipo_credito = v.trim().slice(0, 60);
  }

  const num = (key: "banos_min" | "superficie_min", max: number, int: boolean) => {
    if (!(key in p)) return;
    const v = p[key];
    if (v === null) out[key] = null;
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max && (!int || Number.isInteger(v))) out[key] = v;
  };
  num("banos_min", 30, true);
  num("superficie_min", 100000, false);

  if ("provincia" in p) {
    const v = p.provincia;
    if (v === null) out.provincia = null;
    else if (typeof v === "string" && v.trim()) out.provincia = v.trim().slice(0, 60);
  }
  if (typeof p.presupuesto_flexible === "boolean") out.presupuesto_flexible = p.presupuesto_flexible;

  const words = (key: "amenities_requeridos" | "amenities_preferidos" | "excluir") => {
    if (!Array.isArray(p[key])) return;
    const l = (p[key] as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().slice(0, 40));
    if (l.length) out[key] = [...new Set(l)].slice(0, 10);
  };
  words("amenities_requeridos");
  words("amenities_preferidos");
  words("excluir");

  if (Array.isArray(p.estrictos)) {
    const l = (p.estrictos as unknown[]).filter((x): x is StrictField => typeof x === "string" && (STRICT_FIELDS as readonly string[]).includes(x));
    if (l.length) out.estrictos = [...new Set(l)];
  }
  if (typeof p.confianza === "number" && Number.isFinite(p.confianza)) out.confianza = Math.max(0, Math.min(1, p.confianza));

  return out;
}

export async function extractProfileFields(input: {
  ctx: TriageContext;
  model: string;
  provider?: string;
  params?: Record<string, unknown>;
}): Promise<ExtractResult> {
  const { ctx } = input;

  const user = [
    "Perfil actual del contacto:",
    JSON.stringify(ctx.queBusca ?? {}, null, 1),
    "",
    "Conversación reciente:",
    JSON.stringify(ctx.historial.slice(-6), null, 1),
    "",
    "Último mensaje del contacto:",
    ctx.mensajeEntrante,
  ].join("\n");

  try {
    const completion = await aiChatComplete({
      organizationId: ctx.organizationId,
      fn: "extraccion",
      model: input.model,
      provider: input.provider,
      params: input.params,
      body: {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "perfil_prospecto", strict: false, schema: SCHEMA },
        },
        // Extraer no es escribir: la temperatura baja evita que "complete" lo que falta.
        temperature: 0,
      },
      requestRef: { conversationId: ctx.conversationId, paso: "extraccion" },
    });

    const fields = parse(completion.choices[0]?.message?.content ?? "");
    if (!fields) return { success: false, error: "La extracción no devolvió un JSON usable" };
    return { success: true, fields };
  } catch (err) {
    return { success: false, error: safeError(err) };
  }
}

export { parse as __parseExtractionForTests };
