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
};

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
