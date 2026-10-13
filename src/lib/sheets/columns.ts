// Interpretación de la hoja de propiedades: qué significa cada columna y cada valor. Puro (sin base
// de datos ni red) para poder probarlo con encabezados reales.
//
// Regla de fondo, la misma de siempre: NUNCA se completa un dato por las nuestras. Si algo no se
// entiende queda sin cargar y se avisa; no se adivina.

export type Field =
  | "externalId" | "title" | "status" | "operation" | "propertyType"
  | "price" | "currency" | "priceSale" | "priceSaleCurrency" | "priceRent" | "priceRentCurrency" | "priceSourceText"
  | "addressPublic" | "zone" | "city" | "mapUrl"
  | "areaM2" | "areaRaw" | "areaKind" | "landAreaM2" | "areaCoveredM2" | "areaSemiCoveredM2"
  | "rooms" | "bedrooms" | "bathrooms" | "toilettes" | "parking"
  | "amenities" | "description"
  | "coverUrl" | "coverPreview" | "galleryUrls" | "videoUrl" | "tour360Url" | "sourceUrl"
  | "externalUpdatedAt" | "internalNotes" | "qualityNote";

// Cada campo con los nombres que puede tener su encabezado, en español y en inglés (snake_case o
// con espacios). Se comparan sin acentos, sin mayúsculas y tratando _ - . como espacio.
export const COLUMNS: Record<Field, string[]> = {
  externalId: ["property_id", "id", "id propiedad", "codigo", "código", "listing_id", "external_id", "ref", "referencia"],
  title: ["titulo", "título", "nombre", "listing_title", "title", "titulo aviso", "titulo del aviso", "titulo propiedad", "property title", "headline", "nombre propiedad", "aviso"],
  status: ["estado", "disponibilidad", "record_status", "status", "estado del registro", "estado aviso", "situacion", "estado actual", "availability", "listing_status", "stock"],
  operation: ["operacion", "operación", "venta o alquiler", "tipo de operacion", "operation_type", "operation", "tipo operacion", "listing_type", "tipo de aviso", "transaccion", "transaction", "transaction_type", "modalidad", "negocio"],
  propertyType: ["tipo de inmueble", "tipo", "tipo inmueble", "property_type", "tipo de propiedad", "tipo propiedad", "tipo de unidad", "categoria", "category", "tipologia", "kind", "tipo de bien"],

  price: ["precio", "valor", "price", "monto", "precio usd", "precio u$s", "precio ars", "list price", "asking price", "precio publicado"],
  currency: ["moneda", "currency", "divisa"],
  priceSale: ["price_sale_amount", "precio venta", "precio de venta", "monto venta", "price sale", "sale_price"],
  priceSaleCurrency: ["price_sale_currency", "moneda venta", "moneda de venta", "sale_currency"],
  priceRent: ["price_rent_amount", "precio alquiler", "precio de alquiler", "monto alquiler", "price rent", "rent_price", "precio renta"],
  priceRentCurrency: ["price_rent_currency", "moneda alquiler", "moneda de alquiler", "rent_currency"],
  priceSourceText: ["price_source_text", "precio original", "texto precio", "precio texto", "price_text"],

  addressPublic: ["direccion publicable", "dirección publicable", "direccion", "dirección", "address", "calle", "domicilio", "street", "direccion completa", "calle y numero", "street address"],
  zone: ["barrio", "zona", "neighborhood", "neighbourhood", "district", "barrio zona", "sector", "area", "neighbourhood name"],
  city: ["ciudad", "localidad", "locality", "city", "municipio", "partido", "ciudad localidad", "town", "ubicacion ciudad"],
  mapUrl: ["ubicacion", "ubicación", "mapa", "ubicacion/mapa", "ubicación/mapa", "map_url", "maps", "google maps"],

  areaM2: ["superficie total", "superficie", "sup total", "m2", "metros", "surface_total_m2", "total_area_m2", "sup. total", "m2 totales", "superficie total m2", "sup", "sup total m2", "total area", "area total", "area m2", "total surface", "surface m2", "tamano", "m2 total"],
  areaRaw: ["surface_total_raw", "superficie original", "superficie texto", "superficie total texto"],
  areaKind: ["surface_total_kind", "tipo de superficie", "tipo superficie"],
  landAreaM2: ["land_area_m2", "superficie terreno", "superficie del terreno", "terreno m2", "m2 terreno", "lote m2", "superficie lote"],
  areaCoveredM2: ["superficie cubierta", "sup cubierta", "m2 cubiertos", "covered_area_m2", "m2 cubierta", "sup. cubierta", "cubierta m2", "covered area", "area cubierta", "covered surface", "built area", "m2 construidos", "superficie construida"],
  areaSemiCoveredM2: ["semi_covered_area_m2", "superficie semicubierta", "sup semicubierta", "semicubierta m2", "m2 semicubiertos"],

  rooms: ["ambientes", "rooms", "cantidad de ambientes", "ambientes totales", "amb", "cant amb", "cant ambientes", "room count", "total rooms"],
  bedrooms: ["dormitorios", "habitaciones", "bedrooms", "cuartos", "dorm", "cantidad de dormitorios", "recamaras", "dorm", "cant dorm", "cant dormitorios", "cantidad de habitaciones", "num bedrooms", "bedroom count", "beds"],
  bathrooms: ["banos", "baños", "bathrooms", "cantidad de banos", "bano", "ban", "cant banos", "bath", "baths", "bathroom count", "num bathrooms"],
  toilettes: ["toilettes", "toilette", "toilets", "aseos", "medio bano"],
  parking: ["cocheras", "cochera", "garage", "garajes", "parking_spaces", "parking", "estacionamientos", "plazas de garaje", "cant cocheras", "coch", "cant cocheras", "garages", "car spaces", "parking count"],

  amenities: ["amenities", "comodidades", "servicios", "caracteristicas", "características"],
  description: ["descripcion", "descripción", "description_source", "description", "detalle", "descripcion del aviso", "descripcion larga", "texto", "detalles", "listing_description", "long description"],

  coverUrl: ["url de portada", "portada", "url portada", "imagen principal", "cover_image_url", "cover image url", "imagen portada", "foto principal", "main_image", "foto portada", "imagen destacada", "featured image", "thumbnail", "main photo", "cover photo", "cover"],
  coverPreview: ["cover_image_preview", "vista previa portada", "preview", "imagen preview"],
  galleryUrls: ["urls de galeria", "urls de galería", "galeria", "galería", "fotos", "imagenes", "imágenes", "gallery_urls", "images", "photos", "image_urls"],
  videoUrl: ["url de video", "video", "url video", "video_url"],
  tour360Url: ["url de tour 360", "tour 360", "tour360", "url tour 360", "tour virtual", "tour_360_url", "tour_url", "virtual_tour_url"],
  sourceUrl: ["enlace original", "link original", "url original", "enlace", "listing_url", "url del aviso", "url aviso", "link", "url", "link del aviso", "url publicacion", "link publicacion", "publicacion", "listing link", "source url", "source_url", "web"],

  externalUpdatedAt: ["fecha de actualizacion", "fecha de actualización", "actualizado", "ultima actualizacion", "source_checked_at", "updated_at", "fecha verificacion", "verificado"],
  internalNotes: ["observaciones internas", "observaciones", "notas internas", "notes", "notas"],
  qualityNote: ["data_quality_note", "nota de calidad", "nota calidad", "quality_note", "calidad del dato"],
};

/** Sin acentos, en minúsculas, con _ - . / como espacio y espacios colapsados. */
export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string) => normalize(s).split(" ").filter(Boolean);

export type HeaderMapping = {
  index: Partial<Record<Field, number>>;
  recognized: { header: string; field: Field; how: "exacto" | "aproximado" }[];
  unrecognized: string[];
};

/**
 * Asocia cada columna de la hoja con un campo.
 *  1. Primero, coincidencia EXACTA con algún alias (la que vale en el 95% de los casos).
 *  2. Después, aproximada: todas las palabras de un alias están en el encabezado y este no trae más
 *     de dos palabras de más ("precio de venta usd" -> precio de venta). Nunca pisa una exacta.
 * Un campo se asigna a UNA sola columna: la primera que lo reconoce.
 */
export function mapHeader(header: string[]): HeaderMapping {
  const index: Partial<Record<Field, number>> = {};
  const taken = new Set<number>();
  const recognized: HeaderMapping["recognized"] = [];

  const exact = new Map<string, Field>();
  for (const [field, aliases] of Object.entries(COLUMNS) as [Field, string[]][]) {
    for (const a of aliases) if (!exact.has(normalize(a))) exact.set(normalize(a), field);
  }

  header.forEach((raw, i) => {
    const field = exact.get(normalize(raw));
    if (field && index[field] === undefined) {
      index[field] = i;
      taken.add(i);
      recognized.push({ header: raw, field, how: "exacto" });
    }
  });

  header.forEach((raw, i) => {
    if (taken.has(i) || !normalize(raw)) return;
    const h = new Set(tokens(raw));
    let best: { field: Field; size: number } | null = null;
    for (const [field, aliases] of Object.entries(COLUMNS) as [Field, string[]][]) {
      if (index[field] !== undefined) continue;
      for (const a of aliases) {
        const t = tokens(a);
        if (t.length < 2 || !t.every((w) => h.has(w))) continue;
        if (h.size - t.length > 2) continue;
        if (!best || t.length > best.size) best = { field, size: t.length };
      }
    }
    if (best) {
      index[best.field] = i;
      taken.add(i);
      recognized.push({ header: raw, field: best.field, how: "aproximado" });
    }
  });

  return { index, recognized, unrecognized: header.filter((h, i) => !taken.has(i) && h.trim() !== "") };
}

// ─── Valores ────────────────────────────────────────────────────────────────

export const OPERATIONS: Record<string, "venta" | "alquiler" | "temporario"> = {
  venta: "venta", vender: "venta", sale: "venta", sell: "venta", "for sale": "venta", comprar: "venta", compra: "venta",
  alquiler: "alquiler", alquilar: "alquiler", renta: "alquiler", rent: "alquiler", rental: "alquiler", "for rent": "alquiler", locacion: "alquiler",
  temporario: "temporario", temporal: "temporario", "alquiler temporario": "temporario", "alquiler temporal": "temporario", temporary: "temporario", "short term": "temporario",
};

export const TYPES: Record<string, string> = {
  departamento: "departamento", depto: "departamento", dpto: "departamento", apartment: "departamento", flat: "departamento", apto: "departamento", monoambiente: "departamento", duplex: "departamento",
  casa: "casa", house: "casa", chalet: "casa", quinta: "casa", cabana: "casa",
  ph: "ph", "p h": "ph",
  terreno: "terreno", lote: "terreno", land: "terreno", lot: "terreno", fraccion: "terreno", campo: "terreno",
  local: "local", "local comercial": "local", store: "local", shop: "local", comercial: "local", fondo: "local", "fondo de comercio": "local",
  oficina: "oficina", office: "oficina", consultorio: "oficina",
  galpon: "otro", deposito: "otro", edificio: "otro", warehouse: "otro", industrial: "otro",
  cochera: "cochera", garage: "cochera", garaje: "cochera", parking: "cochera",
};

export const STATUSES: Record<string, string> = {
  borrador: "borrador", draft: "borrador",
  // Estados del PROCESO de carga de la hoja (no de disponibilidad): el registro existe, se muestra.
  extraido: "disponible", extraida: "disponible", extracted: "disponible", ok: "disponible", verificado: "disponible", verificada: "disponible", verified: "disponible",
  revisar: "disponible", "a revisar": "disponible", review: "disponible", "needs review": "disponible", pendiente: "disponible", "pendiente de revision": "disponible",
  disponible: "disponible", activa: "disponible", activo: "disponible", active: "disponible", available: "disponible", publicada: "disponible", publicado: "disponible", online: "disponible",
  reservada: "reservada", reservado: "reservada", reserved: "reservada",
  vendida: "vendida", vendido: "vendida", sold: "vendida",
  alquilada: "alquilada", alquilado: "alquilada", rented: "alquilada", leased: "alquilada",
  pausada: "pausada", pausado: "pausada", paused: "pausada", inactiva: "pausada", inactivo: "pausada", inactive: "pausada", baja: "pausada", removed: "pausada", deleted: "pausada", expired: "pausada", vencida: "pausada", "dada de baja": "pausada",
};

const lookup = <T,>(table: Record<string, T>, raw: string | undefined): T | undefined => {
  const n = normalize(raw ?? "");
  return table[n] ?? table[n.replace(/s$/, "")];
};

export const parseOperation = (raw: string | undefined) => lookup(OPERATIONS, raw);
export const parseType = (raw: string | undefined) => lookup(TYPES, raw);
export const parseStatus = (raw: string | undefined) => lookup(STATUSES, raw);

/** La hoja marcó la fila para revisar a mano: se importa, pero la ficha lo señala. */
export const needsReview = (raw: string | undefined) => ["revisar", "a revisar", "review", "needs review", "pendiente", "pendiente de revision"].includes(normalize(raw ?? ""));

/**
 * Números en formato argentino o inglés: "USD 120.000", "120,000", "1.250,50", "85,5", "120.5".
 * Un punto seguido de exactamente tres dígitos es separador de miles ("120.000" = 120000), no decimal.
 */
export function num(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^\d.,-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  let normalized: string;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) normalized = cleaned.replace(/,/g, "");
  else if (cleaned.includes(",") && !cleaned.includes(".")) normalized = cleaned.replace(",", ".");
  else if (cleaned.includes(",") && cleaned.includes(".")) normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  else normalized = cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? String(n) : null;
}

export const int = (value: string | undefined): number | null => {
  const n = num(value);
  return n === null ? null : Math.round(Number(n));
};

/** "U$S", "US$", "USD", "dólares" -> USD; "$", "ARS", "pesos" -> ARS. Otra cosa: null (no se adivina). */
export function parseCurrency(raw: string | undefined): string | null {
  const n = normalize(raw ?? "").replace(/\s/g, "");
  if (!n) return null;
  if (["usd", "us$", "u$s", "u$d", "dolar", "dolares", "dollar", "dollars", "us"].includes(n)) return "USD";
  if (["ars", "$", "peso", "pesos", "arg"].includes(n)) return "ARS";
  if (/^[a-z]{3}$/.test(n)) return n.toUpperCase();
  return null;
}

/** Moneda que se dice dentro de un texto de precio ("USD 120.000", "$ 450.000"). */
export function currencyInText(text: string | undefined): string | null {
  const t = normalize(text ?? "");
  if (/\b(usd|u s d|us|dolares?|dollars?)\b|u\$s|us\$/.test(t)) return "USD";
  if (/\b(ars|pesos?)\b|^\$|\s\$/.test(t)) return "ARS";
  return null;
}

export type PriceResult = { price: string | null; currency: string | null; note: string | null; error: string | null };

/**
 * Precio según la operación. La hoja trae precio de venta y de alquiler por separado: se toma el que
 * corresponde a la operación de ESA fila. Si no hay columnas separadas se usa la columna genérica.
 * Último recurso: el texto original del precio, avisando que de ahí salió.
 */
export function resolvePrice(operation: "venta" | "alquiler" | "temporario", cells: Partial<Record<Field, string | undefined>>): PriceResult {
  const sale = { amount: num(cells.priceSale), cur: parseCurrency(cells.priceSaleCurrency) };
  const rent = { amount: num(cells.priceRent), cur: parseCurrency(cells.priceRentCurrency) };
  const pick = operation === "venta" ? sale : rent;

  if (pick.amount && Number(pick.amount) > 0) return { price: pick.amount, currency: pick.cur, note: null, error: null };

  const generic = num(cells.price);
  if (generic && Number(generic) > 0) return { price: generic, currency: parseCurrency(cells.currency) ?? currencyInText(cells.price), note: null, error: null };

  // No hay monto para esta operación. Si el texto original lo trae, se usa y se avisa.
  const fromText = num(cells.priceSourceText);
  if (fromText && Number(fromText) > 0) {
    return { price: fromText, currency: currencyInText(cells.priceSourceText), note: "Precio tomado del texto original: conviene verificarlo", error: null };
  }
  return { price: null, currency: null, note: null, error: null };
}

/** Si la hoja no dice la operación, se deduce SOLO cuando hay un único precio posible. */
export function inferOperation(cells: Partial<Record<Field, string | undefined>>): "venta" | "alquiler" | null {
  const sale = Boolean(num(cells.priceSale) && Number(num(cells.priceSale)) > 0);
  const rent = Boolean(num(cells.priceRent) && Number(num(cells.priceRent)) > 0);
  if (sale && !rent) return "venta";
  if (rent && !sale) return "alquiler";
  return null; // ambos o ninguno: no se adivina
}

export function url(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Un enlace dentro de una fórmula =IMAGE("https://...") o =HYPERLINK("https://...") de la hoja. */
export function urlFromFormula(value: string | undefined): string | null {
  const m = /https?:\/\/[^"')\s]+/.exec(value ?? "");
  return m ? url(m[0]) : null;
}

export const urlList = (value: string | undefined): string[] =>
  (value ?? "").split(/[\n,;|]/).map((v) => url(v)).filter((v): v is string => v !== null);

export const list = (value: string | undefined): string[] =>
  (value ?? "").split(/[\n,;|]/).map((v) => v.trim()).filter(Boolean);

export function date(value: string | undefined): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  // dd/mm/aaaa es lo habitual en una hoja en castellano; Date lo leería como mm/dd.
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  const parsed = dmy ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ─── Qué pide cada campo (para los requisitos y el análisis de la hoja) ─────

export type FieldLevel = "obligatoria" | "recomendada" | "opcional";

export const FIELD_INFO: Partial<Record<Field, { label: string; level: FieldLevel; hint: string }>> = {
  externalId: { label: "Identificador", level: "obligatoria", hint: "Único y estable por propiedad. Si cambia, se toma como otra propiedad." },
  operation: { label: "Operación", level: "obligatoria", hint: "venta, alquiler o temporario (también sale / rent). Una por fila." },
  propertyType: { label: "Tipo de propiedad", level: "recomendada", hint: "casa, departamento, PH, terreno, local, oficina, cochera." },
  title: { label: "Título", level: "recomendada", hint: "Lo primero que ve el contacto." },
  priceSale: { label: "Precio de venta", level: "recomendada", hint: "Solo el número (120000 o 120.000), sin texto. Con su moneda al lado." },
  priceRent: { label: "Precio de alquiler", level: "recomendada", hint: "Solo el número, con su moneda al lado." },
  price: { label: "Precio", level: "recomendada", hint: "Alternativa si la hoja no separa venta y alquiler." },
  zone: { label: "Barrio / zona", level: "recomendada", hint: "Con esto el agente busca y compara propiedades." },
  city: { label: "Localidad / ciudad", level: "recomendada", hint: "Ej. Funes, Rosario." },
  coverUrl: { label: "Foto de portada", level: "recomendada", hint: "Enlace https directo a la imagen. Una imagen pegada en la celda no sirve." },
  sourceUrl: { label: "Enlace del aviso", level: "recomendada", hint: "Es lo que el agente manda cuando alguien pide la ficha." },
  status: { label: "Estado", level: "opcional", hint: "disponible, reservada, vendida, alquilada o pausada. Vacío = disponible." },
  bedrooms: { label: "Dormitorios", level: "opcional", hint: "Número." },
  bathrooms: { label: "Baños", level: "opcional", hint: "Número." },
  rooms: { label: "Ambientes", level: "opcional", hint: "Número." },
  parking: { label: "Cocheras", level: "opcional", hint: "Número." },
  areaM2: { label: "Superficie total (m²)", level: "opcional", hint: "Número." },
  areaCoveredM2: { label: "Superficie cubierta (m²)", level: "opcional", hint: "Número." },
  addressPublic: { label: "Dirección", level: "opcional", hint: "La que se puede mostrar." },
  description: { label: "Descripción", level: "opcional", hint: "Texto libre; los enlaces de video o tour que contenga se detectan." },
  galleryUrls: { label: "Galería de fotos", level: "opcional", hint: "Enlaces https separados por coma." },
  externalUpdatedAt: { label: "Fecha de verificación", level: "opcional", hint: "dd/mm/aaaa." },
};

// Un nombre en inglés y uno en castellano para mostrar como ejemplo (todos los de COLUMNS se entienden).
const EXAMPLES: Partial<Record<Field, { es: string; en: string }>> = {
  externalId: { en: "property_id", es: "codigo" },
  operation: { en: "operation_type", es: "operacion" },
  propertyType: { en: "property_type", es: "tipo de inmueble" },
  title: { en: "listing_title", es: "titulo" },
  priceSale: { en: "price_sale_amount", es: "precio venta" },
  priceRent: { en: "price_rent_amount", es: "precio alquiler" },
  price: { en: "price", es: "precio" },
  zone: { en: "neighborhood", es: "barrio" },
  city: { en: "locality", es: "localidad" },
  coverUrl: { en: "cover_image_url", es: "url de portada" },
  sourceUrl: { en: "listing_url", es: "enlace original" },
  status: { en: "record_status", es: "estado" },
  bedrooms: { en: "bedrooms", es: "dormitorios" },
  bathrooms: { en: "bathrooms", es: "baños" },
  rooms: { en: "rooms", es: "ambientes" },
  parking: { en: "parking_spaces", es: "cocheras" },
  areaM2: { en: "surface_total_m2", es: "superficie total" },
  areaCoveredM2: { en: "covered_area_m2", es: "superficie cubierta" },
  addressPublic: { en: "address", es: "direccion" },
  description: { en: "description", es: "descripcion" },
  galleryUrls: { en: "gallery_urls", es: "galeria" },
  externalUpdatedAt: { en: "source_checked_at", es: "fecha de actualizacion" },
};

export function exampleNames(field: Field): { es: string; en: string } {
  return EXAMPLES[field] ?? { es: COLUMNS[field][0], en: COLUMNS[field][0] };
}
