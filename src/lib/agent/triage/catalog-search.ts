import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { properties } from "@/db/schema";
import { mediaFromDescription } from "@/lib/properties/media";

/**
 * Búsqueda en el catálogo de la inmobiliaria.
 *
 * Antes de esto el agente NUNCA miraba el catálogo: solo veía las propiedades ya vinculadas a una
 * oportunidad. Un cliente nuevo no tiene ninguna, así que el modelo recibía una lista vacía y
 * contestaba "no tengo" aunque la propiedad existiera. Y cuando el cliente insistía, inventaba
 * avisos para llenar el hueco.
 *
 * Dos caminos, porque son dos situaciones distintas:
 *
 *  1. REFERENCIA: el cliente nombra una propiedad puntual. Pegó el texto de la tarjeta
 *     ("venta · departamento · Pichincha, Rosario"), el título, el precio o el enlace.
 *  2. CRITERIOS: el cliente describe lo que busca ("un 2 ambientes en Centro hasta 80 mil").
 *
 * Las funciones de puntaje son PURAS (reciben filas, no tocan la base) para poder probarlas.
 */

export type CatalogProperty = {
  id: string;
  externalId: string | null;
  title: string | null;
  operation: string;
  propertyType: string;
  status: string;
  price: number | null;
  currency: string;
  zone: string | null;
  city: string | null;
  addressPublic: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  areaM2: number | null;
  areaCoveredM2: number | null;
  amenities: string[];
  description: string | null;
  coverUrl: string | null;
  galleryUrls: string[];
  videoUrl: string | null;
  tour360Url: string | null;
  sourceUrl: string | null;
  mapUrl: string | null;
  features: Record<string, unknown>;
};

// Solo se ofrece lo que se puede ofrecer. Una vendida o alquilada no es una opción, y
// ofrecerla es peor que no ofrecer nada: el cliente se ilusiona con algo que no existe.
export const OFFERABLE_STATUSES = ["disponible", "reservada"] as const;

// ─── Normalización ──────────────────────────────────────────────────────────

export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Palabras que aparecen en cualquier título o mensaje y no identifican nada.
const STOPWORDS = new Set(
  "a al con de del el en la las lo los para por un una unos unas y o que es mi me te se su sus hola buenas buen dia tarde noche quiero queria busco estoy buscando me interesa intereso interesaria propiedad propiedades info informacion consulta sobre esta este esa ese hay tenes tienen tengo ver vi mas muy".split(
    " ",
  ),
);

const tokens = (value: string) =>
  normalize(value)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

// Sinónimos → valor canónico del catálogo. Así "depto", "dpto" y "departamento" son lo mismo.
const TYPE_SYNONYMS: Record<string, string> = {
  departamento: "departamento",
  depto: "departamento",
  dpto: "departamento",
  deptos: "departamento",
  departamentos: "departamento",
  monoambiente: "departamento",
  duplex: "departamento",
  casa: "casa",
  casas: "casa",
  chalet: "casa",
  ph: "ph",
  pasillo: "ph",
  terreno: "terreno",
  terrenos: "terreno",
  lote: "terreno",
  lotes: "terreno",
  local: "local",
  locales: "local",
  oficina: "oficina",
  oficinas: "oficina",
  cochera: "cochera",
  cocheras: "cochera",
  garage: "cochera",
  galpon: "otro",
};

const OPERATION_SYNONYMS: Record<string, string> = {
  venta: "venta",
  vender: "venta",
  vendo: "venta",
  compra: "venta",
  comprar: "venta",
  compro: "venta",
  alquiler: "alquiler",
  alquilar: "alquiler",
  alquilo: "alquiler",
  alquileres: "alquiler",
  renta: "alquiler",
  rentar: "alquiler",
  temporario: "temporario",
  temporal: "temporario",
  temporada: "temporario",
};

export function detectOperation(text: string): string | null {
  for (const t of normalize(text).split(" ")) if (OPERATION_SYNONYMS[t]) return OPERATION_SYNONYMS[t];
  return null;
}

export function detectTypes(text: string): string[] {
  const found = new Set<string>();
  const words = normalize(text).split(" ");
  words.forEach((t, i) => {
    if (!TYPE_SYNONYMS[t]) return;
    // "departamento CON cochera": la cochera es un amenity, no lo que busca. Sin esto, pegar el
    // título "Departamento con Cochera" buscaba también cocheras sueltas.
    if (i > 0 && (words[i - 1] === "con" || words[i - 1] === "y")) return;
    found.add(TYPE_SYNONYMS[t]);
  });
  return [...found];
}

/**
 * Montos mencionados en el texto, en unidades: "88 mil" → 88000, "88.000" → 88000,
 * "88k" → 88000, "1,5 millones" → 1500000. Sirve para reconocer "el de 88 mil".
 */
export function extractAmounts(text: string): number[] {
  const out: number[] = [];
  // Sin tildes: "1 millón" y "1 millon" son lo mismo. Se conservan puntos y comas, que separan miles.
  const lower = text
    // Los números de una URL (ids de fotos, de avisos) no son montos: uno leyó 114 cuatrillones.
    .replace(/https?:\/\/\S+/gi, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  // "88 mil", "1,5 millones", "88k", "150 lucas", "3 palos".
  // Dos trampas que ya mordieron:
  //  - "millon" va ANTES que "mil" en la alternancia: si no, "mil" matchea el comienzo de
  //    "millones" y 1,5 millones daba 1.500.
  //  - NO hay "m" suelta para millón: en inmobiliaria "m" es METROS, y "65 m²" daba 65 millones.
  for (const m of lower.matchAll(/(\d+(?:[.,]\d+)?)\s*(millon(?:es)?|palos?|mil\b|lucas?|k\b)/g)) {
    const n = Number(m[1].replace(",", "."));
    if (!Number.isFinite(n)) continue;
    const factor = /millon|palo/.test(m[2]) ? 1_000_000 : 1_000;
    out.push(Math.round(n * factor));
  }

  // "88.000", "88,000", "88000", "1.250.000". Se ignoran números cortos (1, 2, 3 ambientes).
  for (const m of lower.matchAll(/\b\d{1,3}(?:[.,]\d{3})+\b|\b\d{4,}\b/g)) {
    const n = Number(m[0].replace(/[.,]/g, ""));
    if (Number.isFinite(n) && n >= 1000) out.push(n);
  }

  return [...new Set(out)];
}

// ─── 1. Referencia directa ──────────────────────────────────────────────────

export type ReferenceMatch = { property: CatalogProperty; score: number; signals: string[] };

/**
 * Qué tanto el texto apunta a UNA propiedad puntual.
 *
 * No alcanza con que coincida la zona: "algo en Centro" coincide con 20 propiedades y no es una
 * referencia, es una búsqueda. Una referencia se reconoce porque varias señales independientes
 * (zona + operación + tipo, o el título, o el precio) apuntan a la misma propiedad.
 */
export function scoreReference(text: string, p: CatalogProperty): ReferenceMatch {
  const norm = ` ${normalize(text)} `;
  const signals: string[] = [];
  let score = 0;

  // Enlace o id: decisivo. Si pegó el link del aviso, no hay dudas.
  if (p.sourceUrl && text.includes(p.sourceUrl)) {
    return { property: p, score: 100, signals: ["enlace"] };
  }
  if (p.externalId && new RegExp(`\\b(?:id|codigo|ref|referencia|propiedad)\\s*#?\\s*${p.externalId}\\b`).test(norm)) {
    return { property: p, score: 100, signals: ["property_id"] };
  }

  // Zona: con límite de palabra, para que "centro" no coincida dentro de otra palabra.
  if (p.zone) {
    const zone = normalize(p.zone);
    if (zone && norm.includes(` ${zone} `)) {
      score += 3;
      signals.push("zona");
    }
  }

  if (p.city) {
    const city = normalize(p.city);
    if (city && norm.includes(` ${city} `)) {
      score += 0.5;
      signals.push("ciudad");
    }
  }

  const op = detectOperation(text);
  if (op) {
    if (op === p.operation) {
      score += 2;
      signals.push("operacion");
    } else {
      // Pide venta y esta es alquiler: no es la que busca.
      score -= 4;
    }
  }

  const types = detectTypes(text);
  if (types.length) {
    if (types.includes(p.propertyType)) {
      score += 2;
      signals.push("tipo");
    } else {
      score -= 3;
    }
  }

  // Precio: si nombra un monto y coincide (±2%), es una señal fuerte.
  if (p.price !== null) {
    const amounts = extractAmounts(text);
    if (amounts.some((a) => Math.abs(a - p.price!) / p.price! <= 0.02)) {
      score += 4;
      signals.push("precio");
    }
  }

  // Título: cuántas palabras significativas del título aparecen en el mensaje.
  if (p.title) {
    const titleTokens = tokens(p.title);
    const msgTokens = new Set(tokens(text));
    if (titleTokens.length) {
      const hits = titleTokens.filter((t) => msgTokens.has(t)).length;
      const ratio = hits / titleTokens.length;
      if (ratio >= 0.6 && hits >= 3) {
        score += 6;
        signals.push("titulo");
      } else if (hits >= 2) {
        score += hits;
        signals.push("palabras_del_titulo");
      }
    }
  }

  // Dormitorios: "1 dormitorio", "2 dorm", "3 amb".
  if (p.bedrooms !== null) {
    const m = norm.match(/ (\d) (?:dormitorios?|dorm|habitaciones?|cuartos?) /);
    if (m) {
      if (Number(m[1]) === p.bedrooms) {
        score += 1.5;
        signals.push("dormitorios");
      } else {
        score -= 1.5;
      }
    }
  }

  return { property: p, score, signals };
}

/**
 * Propiedades a las que el texto se refiere.
 *
 * Devuelve la ganadora solo si se DESTACA: puntaje alto y clara ventaja sobre la segunda. Si
 * varias empatan, no es una referencia a una propiedad sino una búsqueda, y la maneja el otro camino.
 */
export function findReferencedProperties(text: string, catalog: CatalogProperty[]): ReferenceMatch[] {
  if (!text.trim()) return [];
  const ranked = catalog
    .map((p) => scoreReference(text, p))
    .filter((r) => r.score >= 5)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return [];
  const [first, second] = ranked;

  // Enlace o id: se devuelve sin más.
  if (first.score >= 100) return [first];
  // Una sola candidata, o la primera le saca ventaja clara a la segunda.
  if (!second || first.score - second.score >= 2) return [first];
  // Empate entre pocas: se devuelven todas para que el agente pregunte cuál.
  const tied = ranked.filter((r) => first.score - r.score < 2);
  return tied.length <= 3 ? tied : [];
}

// ─── 2. Búsqueda por criterios ──────────────────────────────────────────────

export type SearchCriteria = {
  operation: string | null;
  propertyTypes: string[];
  zones: string[];
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  bedroomsMin: number | null;
};

export type SearchHit = {
  property: CatalogProperty;
  score: number;
  /** No cumple todo (otra zona, apenas fuera de presupuesto): se ofrece como alternativa, dicho así. */
  alternativa: boolean;
  motivo: string[];
};

const zoneMatches = (wanted: string, zone: string | null) => {
  if (!zone) return false;
  const a = normalize(wanted);
  const b = normalize(zone);
  // En los dos sentidos: "Pichincha" busca "Pichincha", y "Pichincha Norte" también cae en "Pichincha".
  return a === b || b.includes(a) || a.includes(b);
};

/**
 * Moneda del presupuesto cuando el cliente no la dijo.
 *
 * No se asume "alquiler = pesos" a ciegas, porque depende del país. Se mira qué moneda usa el
 * CATÁLOGO de esta inmobiliaria para esa operación: si todas sus ventas están en USD, un
 * presupuesto de venta sin moneda se compara contra USD.
 */
export function inferCurrency(catalog: CatalogProperty[], operation: string | null): string | null {
  const pool = catalog.filter((p) => p.price !== null && (!operation || p.operation === operation));
  if (!pool.length) return null;
  const counts = new Map<string, number>();
  for (const p of pool) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  // Solo si es claramente dominante; si está mezclado, mejor no suponer.
  return top && top[1] / pool.length >= 0.8 ? top[0] : null;
}

export type SearchResult = {
  hits: SearchHit[];
  /** Cuántas cumplen TODO. Si es mucho más que `hits`, conviene acotar antes de mostrar. */
  totalExact: number;
  /** Cuántas alternativas había (otra zona, apenas fuera de presupuesto). */
  totalAlternatives: number;
  /** Moneda con la que se comparó el presupuesto, dicha o inferida del catálogo. */
  currencyUsed: string | null;
};

export function searchCatalog(criteria: SearchCriteria, catalog: CatalogProperty[], limit = 3): SearchResult {
  const currency = criteria.currency ?? inferCurrency(catalog, criteria.operation);
  const hasBudget = criteria.priceMin !== null || criteria.priceMax !== null;

  const scored = catalog.map((p): SearchHit & { excluded: boolean } => {
    const motivo: string[] = [];
    let score = 0;
    let alternativa = false;
    let excluded = false;

    // Operación: excluyente. Comprar y alquilar no se mezclan nunca.
    if (criteria.operation) {
      if (p.operation !== criteria.operation) excluded = true;
      else score += 3;
    }

    // Tipo: excluyente si lo pidió.
    if (criteria.propertyTypes.length) {
      if (criteria.propertyTypes.includes(p.propertyType)) score += 2;
      else excluded = true;
    }

    // Zona: si no coincide, no se descarta: queda como alternativa, y el agente lo dice.
    if (criteria.zones.length) {
      if (criteria.zones.some((z) => zoneMatches(z, p.zone))) {
        score += 3;
        motivo.push(`en ${p.zone}`);
      } else {
        alternativa = true;
        motivo.push(`en otra zona (${p.zone ?? "sin zona"})`);
      }
    }

    // Presupuesto: SOLO se compara en la misma moneda. Comparar 60.000 pesos con USD 60.000
    // es un error de tres órdenes de magnitud.
    if (hasBudget && p.price !== null) {
      if (currency && p.currency !== currency) {
        excluded = true;
      } else {
        const over = criteria.priceMax !== null && p.price > criteria.priceMax;
        const under = criteria.priceMin !== null && p.price < criteria.priceMin;
        if (over) {
          // Hasta un 15% arriba se muestra como alternativa; más, se descarta.
          if (p.price <= criteria.priceMax! * 1.15) {
            alternativa = true;
            motivo.push("un poco arriba del presupuesto");
          } else excluded = true;
        } else if (under) {
          score += 0.5;
        } else {
          score += 2;
          motivo.push("dentro del presupuesto");
        }
      }
    }

    if (criteria.bedroomsMin !== null && p.bedrooms !== null) {
      if (p.bedrooms >= criteria.bedroomsMin) score += 1;
      else {
        alternativa = true;
        motivo.push(`${p.bedrooms} dormitorio(s)`);
      }
    }

    // Leve preferencia por las que están disponibles sobre las reservadas.
    if (p.status === "disponible") score += 0.5;

    return { property: p, score, alternativa, motivo, excluded };
  });

  const kept: SearchHit[] = scored
    .filter((h) => !h.excluded)
    .map((h) => ({ property: h.property, score: h.score, alternativa: h.alternativa, motivo: h.motivo }));
  const exact = kept.filter((h) => !h.alternativa).sort((a, b) => b.score - a.score);
  const alternatives = kept.filter((h) => h.alternativa).sort((a, b) => b.score - a.score);

  // Si hay coincidencias exactas, se muestran SOLO esas. Las alternativas aparecen únicamente
  // cuando no hay nada exacto: si no, a quien pidió Pichincha se le mezcla un penthouse de otra
  // zona que no tiene nada que ver.
  return {
    hits: (exact.length ? exact : alternatives).slice(0, limit),
    totalExact: exact.length,
    totalAlternatives: alternatives.length,
    currencyUsed: currency,
  };
}

// ─── Carga desde la base ────────────────────────────────────────────────────

/** Catálogo ofrecible de UNA inmobiliaria. Nunca mezcla carteras. */
export async function loadOfferableCatalog(orgId: string): Promise<CatalogProperty[]> {
  const rows = await getDb()
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
      addressPublic: properties.addressPublic,
      bedrooms: properties.bedrooms,
      bathrooms: properties.bathrooms,
      parking: properties.parking,
      areaM2: properties.areaM2,
      areaCoveredM2: properties.areaCoveredM2,
      amenities: properties.amenities,
      description: properties.description,
      coverUrl: properties.coverUrl,
      galleryUrls: properties.galleryUrls,
      videoUrl: properties.videoUrl,
      tour360Url: properties.tour360Url,
      sourceUrl: properties.sourceUrl,
      mapUrl: properties.mapUrl,
      features: properties.features,
    })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        inArray(properties.status, [...OFFERABLE_STATUSES]),
      ),
    );

  return rows.map((r) => {
    // Los campos cargados mandan; los vacíos se completan con los enlaces que la inmobiliaria
    // escribió en la descripción (en la cartera real, ahí estaban TODOS).
    const m = mediaFromDescription(r.description);
    return {
      ...r,
      price: r.price === null ? null : Number(r.price),
      areaM2: r.areaM2 === null ? null : Number(r.areaM2),
      areaCoveredM2: r.areaCoveredM2 === null ? null : Number(r.areaCoveredM2),
      sourceUrl: r.sourceUrl ?? m.ficha,
      videoUrl: r.videoUrl ?? m.video,
      tour360Url: r.tour360Url ?? m.tour,
      galleryUrls: r.galleryUrls.length ? r.galleryUrls : m.fotos,
    };
  });
}
