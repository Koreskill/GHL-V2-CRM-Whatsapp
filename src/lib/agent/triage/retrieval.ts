import {
  detectOperation,
  detectTypes,
  extractAmounts,
  findReferencedProperties,
  normalize,
  searchCatalog,
  type CatalogProperty,
  type SearchCriteria,
} from "./catalog-search";

/**
 * Qué propiedades se ponen delante del modelo en este turno.
 *
 * Es la ÚNICA puerta por la que una propiedad llega a la respuesta. El modelo recibe estas, con
 * una clave corta (P1, P2, P3), y solo puede mostrar esas claves. Una propiedad que no pasó por
 * acá no puede aparecer en el mensaje: no tiene clave, y el código no le arma ficha.
 */

export type Offered = {
  /** Clave corta que ve el modelo. No es el id de la base: no hace falta exponerlo. */
  ref: string;
  property: CatalogProperty;
  alternativa: boolean;
  motivo: string[];
};

export type RetrievalMode =
  /** El cliente nombró una propiedad puntual (pegó la tarjeta, el título, el precio, el link). */
  | "referencia"
  /** Describió lo que busca y se buscó en el catálogo. */
  | "busqueda"
  /** No dijo nada nuevo, pero se venía hablando de propiedades ya mostradas ("¿tenés fotos?"). */
  | "conversacion"
  /** No hay con qué buscar todavía: hay que preguntar qué necesita. */
  | "ninguna";

export type Retrieval = {
  mode: RetrievalMode;
  offered: Offered[];
  totalExact: number;
  totalAlternatives: number;
  criteria: SearchCriteria;
  currencyUsed: string | null;
};

export type ProfileSnapshot = {
  operation: string | null;
  propertyTypes: string[];
  zones: string[];
  priceMin: number | null;
  priceMax: number | null;
  /** Solo si el cliente la DIJO. La columna tiene default USD, que no es un dato del cliente. */
  currency: string | null;
  bedroomsMin: number | null;
};

/** Zonas del catálogo que el texto nombra. Se buscan contra las zonas reales, no contra una lista fija. */
export function detectZones(text: string, catalog: CatalogProperty[]): string[] {
  const norm = ` ${normalize(text)} `;
  const zones = new Set<string>();
  for (const p of catalog) {
    if (!p.zone) continue;
    const z = normalize(p.zone);
    if (z.length >= 3 && norm.includes(` ${z} `)) zones.add(p.zone);
  }
  return [...zones];
}

/**
 * Criterios de búsqueda del turno: lo que dijo AHORA pisa lo que se sabía antes, y lo que no dijo
 * se toma del perfil acumulado. Así "¿y en Centro?" cambia la zona sin perder el presupuesto.
 *
 * La detección por texto es la red de seguridad: si la extracción no corrió (una aclaración, por
 * ejemplo) o no captó la zona, igual se busca con lo que el cliente escribió literalmente.
 */
export function buildCriteria(input: {
  text: string;
  profile: ProfileSnapshot | null;
  catalog: CatalogProperty[];
  thisTurn: {
    /** De la pregunta `operacion` de Jev, que mira TODA la conversación. Va último. */
    operation: string | null;
    /**
     * Operación del ÚLTIMO mensaje, derivada del intent (buy→venta, rent→alquiler). Manda sobre
     * todo lo demás: si venía preguntando por alquiler y ahora dice "¿y en venta?", busca venta.
     */
    intentOperation?: string | null;
    propertyType: string | null;
    zones?: string[];
    priceMin?: number | null;
    priceMax?: number | null;
    currency?: string | null;
    bedrooms?: number | null;
  };
}): SearchCriteria {
  const { text, profile, catalog, thisTurn } = input;

  const textOp = detectOperation(text);
  const textTypes = detectTypes(text);
  const textZones = detectZones(text, catalog);

  // Orden: lo MÁS RECIENTE Y ESPECÍFICO primero.
  //   1. El texto del último mensaje ("¿y en venta?") — literal, sin interpretación.
  //   2. El intent de Jev, que se calcula sobre el último mensaje (buy→venta, rent→alquiler).
  //   3. La pregunta `operacion` de Jev, que mira TODA la conversación.
  //   4. El perfil acumulado.
  //
  // El orden importa y ya rompió en producción: un cliente preguntó por alquiler en Pichincha y
  // después "¿y en venta?". Jev respondió `operacion: alquiler` (mirando toda la conversación) y
  // eso pisaba el "venta" del mensaje actual, así que se buscaban alquileres y el bot contestaba
  // "tampoco tengo en venta" teniendo uno publicado.
  const operation = textOp ?? thisTurn.intentOperation ?? thisTurn.operation ?? profile?.operation ?? null;

  const turnTypes = [...new Set([...(thisTurn.propertyType ? [thisTurn.propertyType] : []), ...textTypes])];
  const propertyTypes = turnTypes.length ? turnTypes : profile?.propertyTypes ?? [];

  const turnZones = [...new Set([...(thisTurn.zones ?? []), ...textZones])];
  const zones = turnZones.length ? turnZones : profile?.zones ?? [];

  // Presupuesto: lo extraído en este turno, o el del perfil.
  const priceMax = thisTurn.priceMax !== undefined ? thisTurn.priceMax : profile?.priceMax ?? null;
  const priceMin = thisTurn.priceMin !== undefined ? thisTurn.priceMin : profile?.priceMin ?? null;

  return {
    operation,
    propertyTypes,
    zones,
    priceMin,
    priceMax,
    currency: thisTurn.currency ?? profile?.currency ?? null,
    bedroomsMin: thisTurn.bedrooms ?? profile?.bedroomsMin ?? null,
  };
}

const hasAnyCriteria = (c: SearchCriteria) =>
  Boolean(c.operation || c.propertyTypes.length || c.zones.length || c.priceMax !== null || c.priceMin !== null);

// Si el mensaje nombra algo nuevo para buscar, no es una pregunta sobre lo que ya se mostró.
const mentionsSomethingNew = (text: string, catalog: CatalogProperty[]) =>
  Boolean(detectOperation(text) || detectTypes(text).length || detectZones(text, catalog).length || extractAmounts(text).length);

export function retrieve(input: {
  text: string;
  catalog: CatalogProperty[];
  criteria: SearchCriteria;
  /** Propiedades ya mostradas en esta conversación (las de la oportunidad), por id. */
  shownIds: string[];
  limit?: number;
}): Retrieval {
  const { text, catalog, criteria, shownIds } = input;
  const limit = input.limit ?? 3;

  const withRefs = (items: Omit<Offered, "ref">[]): Offered[] =>
    items.slice(0, limit).map((o, i) => ({ ...o, ref: `P${i + 1}` }));

  // 1. Nombró una propiedad puntual: esa, sin vueltas.
  const referenced = findReferencedProperties(text, catalog);
  if (referenced.length) {
    return {
      mode: "referencia",
      offered: withRefs(referenced.map((r) => ({ property: r.property, alternativa: false, motivo: r.signals }))),
      totalExact: referenced.length,
      totalAlternatives: 0,
      criteria,
      currencyUsed: null,
    };
  }

  // 2. Pregunta sobre lo que ya se venía hablando ("¿tenés fotos?", "¿cuántos baños tiene?").
  //    Solo si no trae criterios nuevos: si dice "¿y en Centro?", es una búsqueda nueva.
  // Solo las que siguen siendo pertinentes: si se le mostró una venta y después dijo que quiere
  // ALQUILAR, esa venta ya no es "de lo que se venía hablando". Antes se la volvía a ofrecer como
  // si fuera lo que buscaba.
  const shown = shownIds
    .map((id) => catalog.find((p) => p.id === id))
    .filter((p): p is CatalogProperty => Boolean(p))
    .filter((p) => !criteria.operation || p.operation === criteria.operation);
  if (shown.length && !mentionsSomethingNew(text, catalog)) {
    return {
      mode: "conversacion",
      offered: withRefs(shown.map((p) => ({ property: p, alternativa: false, motivo: ["ya mostrada"] }))),
      totalExact: shown.length,
      totalAlternatives: 0,
      criteria,
      currencyUsed: null,
    };
  }

  // 3. Búsqueda por criterios.
  if (hasAnyCriteria(criteria)) {
    const result = searchCatalog(criteria, catalog, limit);
    return {
      mode: "busqueda",
      offered: withRefs(result.hits.map((h) => ({ property: h.property, alternativa: h.alternativa, motivo: h.motivo }))),
      totalExact: result.totalExact,
      totalAlternatives: result.totalAlternatives,
      criteria,
      currencyUsed: result.currencyUsed,
    };
  }

  return { mode: "ninguna", offered: [], totalExact: 0, totalAlternatives: 0, criteria, currencyUsed: null };
}

/** Lo que el modelo ve de cada propiedad ofrecida: solo datos, sin ids internos. */
export function offeredForPrompt(offered: Offered[], mode: RetrievalMode = "busqueda") {
  return offered.map((o) => {
    const p = o.property;
    const faltan: string[] = [];
    if (p.price === null) faltan.push("precio");
    if (p.areaM2 === null) faltan.push("superficie");
    if (!p.coverUrl && !p.galleryUrls.length && !p.sourceUrl) faltan.push("fotos");
    if (!p.videoUrl) faltan.push("video");
    if (!p.tour360Url) faltan.push("tour virtual");
    if (!p.addressPublic) faltan.push("dirección exacta");

    return {
      clave: o.ref,
      titulo: p.title,
      operacion: p.operation,
      tipo: p.propertyType,
      estado: p.status,
      precio: p.price,
      moneda: p.currency,
      barrio: p.zone,
      ciudad: p.city,
      dormitorios: p.bedrooms,
      banos: p.bathrooms,
      cocheras: p.parking,
      superficie_m2: p.areaM2,
      amenities: p.amenities,
      descripcion: p.description?.slice(0, 400) ?? null,
      // Uno por medio: que haya fotos no dice nada del video.
      tiene_fotos: Boolean(p.coverUrl || p.galleryUrls.length || p.sourceUrl),
      tiene_video: Boolean(p.videoUrl),
      tiene_tour_360: Boolean(p.tour360Url),
      // Si la ficha que se adjunta lleva un enlace. Sin enlace, no hay "ficha online" que mirar.
      la_ficha_trae_enlace: Boolean(p.sourceUrl || p.tour360Url || p.videoUrl || p.coverUrl || p.galleryUrls.length),
      es_alternativa: o.alternativa,
      // El cliente nombró ESTA propiedad: su ficha sale sí o sí, la elija el modelo o no.
      se_adjunta_siempre: mode === "referencia",
      por_que: o.motivo,
      datos_que_no_tenemos: faltan,
    };
  });
}
