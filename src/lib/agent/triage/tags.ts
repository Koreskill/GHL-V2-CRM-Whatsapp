import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contacts,
  dealProperties,
  deals,
  prospectRequirements,
  type LeadTemperature,
  type PaymentMethod,
  type ProspectUrgency,
} from "@/db/schema";
import { readChoice, readNoul, readScore, type DecisionAnswer } from "@/lib/ai/decisions";
import { TEMPERATURES, URGENCIES } from "./questions";
import type { ExtractedFields } from "./extract";

/**
 * Persistencia de las etiquetas del contacto.
 *
 * El perfil (qué busca) vive en `prospect_requirements`, que ya existía y es lo que lee el
 * Pipeline y el contexto del triaje. NO se duplica en otra tabla: dos lugares con la zona y el
 * presupuesto del mismo contacto terminan diciendo cosas distintas.
 *
 * La temperatura vive en `contacts` porque es de la PERSONA: la misma persona escribiendo por
 * WhatsApp y por Instagram tiene una sola temperatura, aunque sean dos conversaciones.
 */

const TIPOS = [
  "departamento",
  "casa",
  "ph",
  "terreno",
  "local",
  "oficina",
  "cochera",
  "desconocido",
] as const;

export type TagDecisions = {
  operation: "venta" | "alquiler" | "temporario" | null;
  propertyType: string | null;
  urgency: ProspectUrgency | null;
  paymentMethod: PaymentMethod | null;
  temperature: LeadTemperature | null;
  interestedInShownProperty: number;
};

/**
 * Lee las respuestas tipadas de Jev.
 * "desconocida" no es un valor: es la forma de decir que el contacto no lo dijo, y se guarda
 * como null para no pisar lo que ya se sabía de mensajes anteriores.
 */
export function readTagDecisions(answers: Record<string, DecisionAnswer>): TagDecisions {
  // `operacion` ya NO se le pregunta a Jev: la dice el intent, que además mira el último mensaje
  // (la pregunta miraba toda la conversación y se quedaba con la operación vieja). El llamador
  // pisa este campo con la operación resuelta del turno, así que acá queda siempre null.
  const operacion = null;
  const tipo = readChoice(answers.tipo_propiedad, TIPOS);
  // `forma_pago` tampoco se pregunta: es poco frecuente que lo digan y, cuando lo dicen, lo
  // captura la extracción junto con el tipo de crédito.
  const pago = null;
  const urgencia = readScore(answers.urgencia, URGENCIES.length);
  const temperatura = readScore(answers.temperatura, TEMPERATURES.length);

  return {
    operation: operacion,
    // "desconocido" no es un valor: es que no lo dijo. Va null para no pisar lo que ya se sabía.
    propertyType: tipo && tipo.choice !== "desconocido" ? tipo.choice : null,
    urgency: urgencia ? URGENCIES[urgencia.level] : null,
    paymentMethod: pago,
    temperature: temperatura ? TEMPERATURES[temperatura.level] : null,
    interestedInShownProperty: readNoul(answers.interes_propiedad) ?? 0,
  };
}

/**
 * Aplica etiquetas y extracción sobre el perfil del contacto.
 *
 * Es INCREMENTAL: lo que no vino no se toca. Un mensaje que solo dice "sí, dale" no puede
 * borrar la zona y el presupuesto que el contacto dio hace cinco mensajes.
 */
export async function applyTags(input: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  decisions: TagDecisions;
  extracted: ExtractedFields;
}): Promise<{ requirementId: string; temperature: LeadTemperature | null }> {
  const db = getDb();
  const { organizationId, contactId, conversationId, decisions, extracted } = input;

  // Perfil vigente del contacto, o uno nuevo si es su primera consulta.
  const [existing] = await db
    .select()
    .from(prospectRequirements)
    .where(
      and(
        eq(prospectRequirements.contactId, contactId),
        eq(prospectRequirements.organizationId, organizationId),
        eq(prospectRequirements.status, "activo"),
      ),
    )
    .orderBy(desc(prospectRequirements.updatedAt))
    .limit(1);

  // Solo se arma el patch con lo que realmente cambia. `undefined` = no vino; `null` = vaciar.
  const patch: Record<string, unknown> = {};
  const setIf = (key: string, value: unknown) => {
    if (value !== undefined) patch[key] = value;
  };

  setIf("operation", decisions.operation ?? undefined);
  setIf("urgency", decisions.urgency ?? undefined);
  setIf("paymentMethod", decisions.paymentMethod ?? undefined);
  setIf("creditType", extracted.tipo_credito);
  setIf("bedroomsMin", extracted.dormitorios);
  setIf(
    "priceMin",
    extracted.presupuesto_min === undefined ? undefined : extracted.presupuesto_min === null ? null : String(extracted.presupuesto_min),
  );
  setIf(
    "priceMax",
    extracted.presupuesto_max === undefined ? undefined : extracted.presupuesto_max === null ? null : String(extracted.presupuesto_max),
  );
  // La columna currency tiene default USD, así que un "USD" guardado NO dice si el cliente lo
  // dijo. Se marca aparte cuándo fue explícito: si no, un presupuesto de alquiler de 60.000 pesos
  // se comparaba contra dólares y no encontraba nada.
  if (extracted.moneda) {
    patch.currency = extracted.moneda;
    patch.rawExtraction = { ...(existing?.rawExtraction ?? {}), ...(patch.rawExtraction as object), moneda_explicita: true };
  }

  // Las zonas y los tipos se ACUMULAN: si antes dijo Palermo y ahora agrega Colegiales, busca
  // en las dos. Solo se reemplazan si la extracción devuelve una lista nueva completa.
  if (extracted.zonas?.length) {
    const previas = existing?.zones ?? [];
    patch.zones = [...new Set([...previas, ...extracted.zonas])].slice(0, 15);
  }
  if (decisions.propertyType) {
    const previos = existing?.propertyTypes ?? [];
    patch.propertyTypes = [...new Set([...previos, decisions.propertyType])].slice(0, 8);
  }
  // Los ambientes no tienen columna propia: van en raw_extraction, como el resto de lo suelto.
  if (extracted.ambientes !== undefined) {
    // Se acumula sobre lo que ya se puso en este mismo patch (moneda_explicita), no se reemplaza.
    patch.rawExtraction = {
      ...(existing?.rawExtraction ?? {}),
      ...((patch.rawExtraction as object | undefined) ?? {}),
      ambientes: extracted.ambientes,
    };
  }

  let requirementId: string;
  if (existing) {
    if (Object.keys(patch).length) {
      await db
        .update(prospectRequirements)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(prospectRequirements.id, existing.id));
    }
    requirementId = existing.id;
  } else {
    const [created] = await db
      .insert(prospectRequirements)
      .values({ organizationId, contactId, conversationId, ...patch })
      .returning({ id: prospectRequirements.id });
    requirementId = created.id;
  }

  // La temperatura solo se escribe si Jev la pudo determinar: no se degrada a "frío" por un
  // mensaje corto cuando antes estaba caliente.
  if (decisions.temperature) {
    await db
      .update(contacts)
      .set({ temperature: decisions.temperature, temperatureAt: new Date() })
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
  }

  return { requirementId, temperature: decisions.temperature };
}

/**
 * Marca interés en las propiedades que ya se le mostraron al contacto.
 *
 * "Mostrada" es que exista la fila en deal_properties. "Con interés" es que tenga temperatura.
 * No se adivina CUÁL de las propiedades le interesó: si hay una sola vinculada, es esa; si hay
 * varias, se marcan todas con la temperatura del contacto, porque el modelo no distingue cuál
 * sin que el contacto la nombre, y elegir una al azar sería inventar.
 */
export async function markPropertyInterest(input: {
  organizationId: string;
  contactId: string;
  temperature: LeadTemperature;
}): Promise<number> {
  const db = getDb();
  const { organizationId, contactId, temperature } = input;

  const [deal] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        eq(deals.contactId, contactId),
        eq(deals.organizationId, organizationId),
        eq(deals.status, "abierta"),
      ),
    )
    .orderBy(desc(deals.updatedAt))
    .limit(1);
  if (!deal) return 0;

  const updated = await db
    .update(dealProperties)
    .set({ interest: temperature, lastInterestAt: new Date() })
    .where(
      and(eq(dealProperties.dealId, deal.id), eq(dealProperties.organizationId, organizationId)),
    )
    .returning({ id: dealProperties.id });

  return updated.length;
}

/** Vincula a la oportunidad una propiedad que se le mostró al contacto. */
export async function markPropertyShown(input: {
  organizationId: string;
  dealId: string;
  propertyId: string;
}) {
  await getDb()
    .insert(dealProperties)
    .values({
      organizationId: input.organizationId,
      dealId: input.dealId,
      propertyId: input.propertyId,
    })
    .onConflictDoNothing()
    .catch(() => {});
}
