import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contacts,
  dealProperties,
  deals,
  messages,
  properties,
  prospectRequirements,
  visits,
  type Channel,
} from "@/db/schema";

/**
 * El contexto que se manda a los modelos.
 *
 * TODO lo que sale de acá se filtra por `organizationId`: un prompt con datos de otra
 * inmobiliaria es una fuga, aunque el modelo no la repita. Se arma una sola vez y lo comparten
 * Jev (para clasificar) y GPT (para redactar).
 *
 * No incluye notas internas de propiedades ni documentos: son privados del equipo y no tienen
 * por qué pasar por un modelo que después redacta un mensaje al cliente.
 */

const HISTORY_LIMIT = 12;
const MAX_CHARS = 700;

export type TriageProperty = {
  id: string;
  externalId: string | null;
  title: string;
  operation: string;
  propertyType: string;
  status: string;
  price: string | null;
  currency: string;
  zone: string | null;
  city: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  areaM2: string | null;
  amenities: string[];
  /** Lo que la ficha NO tiene: le dice al modelo qué no puede afirmar. */
  datosFaltantes: string[];
};

export type TriageContext = {
  organizationId: string;
  conversationId: string;
  channel: Channel;
  mensajeEntrante: string;
  contactoNombre: string | null;
  historial: { de: "contacto" | "inmobiliaria"; texto: string }[];
  oportunidad: {
    id: string;
    titulo: string;
    etapa: string;
    estado: string;
    ultimaActualizacion: string;
  } | null;
  queBusca: {
    operacion: string | null;
    tipos: string[];
    zonas: string[];
    presupuestoMin: string | null;
    presupuestoMax: string | null;
    moneda: string;
    /** La columna tiene default USD: esto dice si el cliente la dijo de verdad. */
    monedaExplicita: boolean;
    dormitoriosMin: number | null;
  } | null;
  propiedadesDeInteres: TriageProperty[];
  visitas: { propiedad: string; estado: string; fecha: string | null }[];
};

function faltantes(p: {
  price: string | null;
  areaM2: string | null;
  bedrooms: number | null;
  zone: string | null;
  coverUrl: string | null;
  syncIssues: string[];
}): string[] {
  const out: string[] = [];
  if (!p.price) out.push("precio");
  if (!p.areaM2) out.push("superficie");
  if (p.bedrooms === null) out.push("dormitorios");
  if (!p.zone) out.push("zona");
  if (!p.coverUrl) out.push("foto de portada");
  // Los avisos de la sincronización también cuentan como datos que no se pueden afirmar.
  for (const issue of p.syncIssues) out.push(issue.toLowerCase());
  return [...new Set(out)];
}

export async function buildTriageContext(input: {
  organizationId: string;
  conversationId: string;
  channel: Channel;
  /** Null hasta que el mensaje se asocia a un contacto: sin contacto no hay oportunidad ni fichas. */
  contactId: string | null;
  incomingText: string;
}): Promise<TriageContext> {
  const db = getDb();
  const { organizationId, conversationId, contactId } = input;

  const [history, contact, dealRow] = await Promise.all([
    // Historial de ESTA conversación, no del contacto: no se mezcla WhatsApp con Instagram.
    db
      .select({ direction: messages.direction, body: messages.body, type: messages.type })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.organizationId, organizationId),
          ne(messages.status, "failed"),
        ),
      )
      .orderBy(desc(messages.sentAt))
      .limit(HISTORY_LIMIT),

    contactId
      ? db
          .select({ name: contacts.name })
          .from(contacts)
          .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
          .limit(1)
      : Promise.resolve([]),

    // La oportunidad abierta del contacto. Una sola, con varias propiedades: no se duplica
    // la oportunidad por cada propiedad consultada.
    contactId
      ? db
          .select({
            id: deals.id,
            title: deals.title,
            stage: deals.stage,
            status: deals.status,
            updatedAt: deals.updatedAt,
            prospectRequirementId: deals.prospectRequirementId,
          })
          .from(deals)
          .where(
            and(
              eq(deals.contactId, contactId),
              eq(deals.organizationId, organizationId),
              eq(deals.status, "abierta"),
            ),
          )
          .orderBy(desc(deals.updatedAt))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const deal = dealRow[0] ?? null;

  const [requirement, props, visitRows] = await Promise.all([
    // El perfil se busca POR CONTACTO, no solo por la oportunidad. Antes se cargaba únicamente
    // desde deal.prospect_requirement_id: un cliente nuevo no tiene oportunidad, así que lo que
    // dijo en un mensaje ("Pichincha", "alquiler", "60.000") se guardaba pero el turno siguiente
    // lo veía vacío, y el bot volvía a preguntar lo mismo.
    deal?.prospectRequirementId
      ? db
          .select()
          .from(prospectRequirements)
          .where(
            and(
              eq(prospectRequirements.id, deal.prospectRequirementId),
              eq(prospectRequirements.organizationId, organizationId),
            ),
          )
          .limit(1)
      : contactId
        ? db
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
            .limit(1)
        : Promise.resolve([]),

    deal
      ? db
          .select({
            id: properties.id,
            externalId: properties.externalId,
            title: properties.title,
            operation: properties.operation,
            propertyType: properties.propertyType,
            status: properties.status,
            price: properties.price,
            currency: properties.currency,
            zone: properties.zone,
            city: properties.city,
            bedrooms: properties.bedrooms,
            bathrooms: properties.bathrooms,
            parking: properties.parking,
            areaM2: properties.areaM2,
            amenities: properties.amenities,
            coverUrl: properties.coverUrl,
            syncIssues: properties.syncIssues,
          })
          .from(dealProperties)
          .innerJoin(properties, eq(properties.id, dealProperties.propertyId))
          .where(
            and(eq(dealProperties.dealId, deal.id), eq(dealProperties.organizationId, organizationId)),
          )
          .limit(10)
      : Promise.resolve([]),

    deal
      ? db
          .select({
            title: properties.title,
            status: visits.status,
            scheduledAt: visits.scheduledAt,
          })
          .from(visits)
          .innerJoin(properties, eq(properties.id, visits.propertyId))
          .where(and(eq(visits.dealId, deal.id), eq(visits.organizationId, organizationId)))
          .orderBy(desc(visits.requestedAt))
          .limit(5)
      : Promise.resolve([]),
  ]);

  const req = requirement[0] ?? null;

  return {
    organizationId,
    conversationId,
    channel: input.channel,
    mensajeEntrante: input.incomingText.slice(0, MAX_CHARS * 2),
    contactoNombre: contact[0]?.name ?? null,
    historial: history
      .reverse()
      .map((m) => ({
        de: m.direction === "inbound" ? ("contacto" as const) : ("inmobiliaria" as const),
        texto: (m.body ?? `[${m.type}]`).slice(0, MAX_CHARS),
      })),
    oportunidad: deal
      ? {
          id: deal.id,
          titulo: deal.title ?? contact[0]?.name ?? "Sin nombre",
          etapa: deal.stage,
          estado: deal.status,
          ultimaActualizacion: deal.updatedAt.toISOString(),
        }
      : null,
    queBusca: req
      ? {
          operacion: req.operation,
          tipos: req.propertyTypes,
          zonas: req.zones,
          presupuestoMin: req.priceMin,
          presupuestoMax: req.priceMax,
          moneda: req.currency,
          monedaExplicita: (req.rawExtraction as { moneda_explicita?: boolean } | null)?.moneda_explicita === true,
          dormitoriosMin: req.bedroomsMin,
        }
      : null,
    propiedadesDeInteres: props.map((p) => ({
      id: p.id,
      externalId: p.externalId,
      title: p.title ?? "Sin título",
      operation: p.operation,
      propertyType: p.propertyType,
      status: p.status,
      price: p.price,
      currency: p.currency,
      zone: p.zone,
      city: p.city,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      parking: p.parking,
      areaM2: p.areaM2,
      amenities: p.amenities,
      datosFaltantes: faltantes(p),
    })),
    visitas: visitRows.map((v) => ({
      propiedad: v.title ?? "Sin título",
      estado: v.status,
      fecha: v.scheduledAt?.toISOString() ?? null,
    })),
  };
}

/**
 * Lo que se le manda a Jev: menos que a GPT.
 * Para clasificar la intención no hacen falta los amenities ni el detalle de cada ficha, y todo
 * lo que se manda se paga por token de entrada.
 */
export function stateForDecision(ctx: TriageContext) {
  return {
    canal: ctx.channel,
    mensaje_entrante: ctx.mensajeEntrante,
    contexto_reciente: ctx.historial.slice(-6),
    oportunidad: ctx.oportunidad
      ? { etapa: ctx.oportunidad.etapa, estado: ctx.oportunidad.estado }
      : null,
    que_busca: ctx.queBusca,
    propiedades_consultadas: ctx.propiedadesDeInteres.map((p) => ({
      titulo: p.title,
      operacion: p.operation,
      estado: p.status,
      zona: p.zone,
    })),
    visitas: ctx.visitas,
  };
}

// Conteo aproximado, para no mandar un estado enorme a un modelo con 32k de contexto.
export const approxTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

