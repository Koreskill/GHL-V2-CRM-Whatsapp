import {
  COLUMNS, FIELD_INFO, inferOperation, mapHeader, normalize, parseOperation, parseStatus, parseType, resolvePrice,
  type Field, type FieldLevel,
} from "./columns";

// Revisión de una hoja SIN importar nada: qué se entendió de cada columna, qué falta y qué valores
// no se reconocen. Pura. Sirve para que quien carga la hoja vea qué va a pasar antes de sincronizar.

export type Analysis = {
  rows: number;
  mapped: { header: string; field: Field; label: string; how: "exacto" | "aproximado" }[];
  unused: string[];
  missing: { field: Field; label: string; level: FieldLevel; hint: string }[];
  /** Valores de operación, tipo y estado que no se reconocen, con cuántas filas los traen. */
  unknownValues: { column: "operación" | "tipo" | "estado"; value: string; count: number }[];
  counts: {
    importable: number;
    sinIdentificador: number;
    identificadorRepetido: number;
    operacionNoReconocida: number;
    ambasOperaciones: number;
    sinPrecio: number;
    sinPortada: number;
    sinZona: number;
  };
};

const LABELS: Partial<Record<Field, string>> = {
  ...Object.fromEntries(Object.entries(FIELD_INFO).map(([k, v]) => [k, v!.label])),
  priceSaleCurrency: "Moneda de venta", priceRentCurrency: "Moneda de alquiler", priceSourceText: "Precio (texto original)",
  coverPreview: "Vista previa de portada", areaRaw: "Superficie (texto original)", areaKind: "Tipo de superficie",
  landAreaM2: "Superficie del terreno", areaSemiCoveredM2: "Superficie semicubierta", toilettes: "Toilettes",
  amenities: "Comodidades", videoUrl: "Video", tour360Url: "Tour 360", mapUrl: "Mapa", internalNotes: "Notas internas",
  qualityNote: "Nota de calidad", currency: "Moneda",
};
export const labelOf = (f: Field) => LABELS[f] ?? f;

export function analyzeRows(all: string[][]): Analysis {
  const [header = [], ...rows] = all;
  const m = mapHeader(header);
  const idx = m.index;
  const get = (r: string[], f: Field) => (idx[f] === undefined ? undefined : r[idx[f]!]?.trim() || undefined);
  const cells = (r: string[]) => Object.fromEntries((Object.keys(idx) as Field[]).map((f) => [f, get(r, f)])) as Partial<Record<Field, string | undefined>>;

  const has = (f: Field) => idx[f] !== undefined;
  // Un campo cuenta como presente si está él o su equivalente (precio de venta, de alquiler o genérico).
  const equivalents: Partial<Record<Field, Field[]>> = { priceSale: ["priceSale", "price"], priceRent: ["priceRent", "price"], price: ["price", "priceSale", "priceRent"], city: ["city", "zone"] };
  const missing = (Object.entries(FIELD_INFO) as [Field, NonNullable<(typeof FIELD_INFO)[Field]>][])
    .filter(([f, info]) => info.level !== "opcional" && !(equivalents[f] ?? [f]).some(has))
    // Una hoja puede tener solo precio de venta o solo de alquiler: no se pide el otro.
    .filter(([f]) => !(f === "priceRent" && has("priceSale")) && !(f === "priceSale" && has("priceRent")))
    .filter(([f]) => !(f === "price" && (has("priceSale") || has("priceRent"))))
    // Sin ninguna columna de precio se pide UNA, no cada variante por separado.
    .filter(([f]) => !((f === "priceSale" || f === "priceRent") && !has("priceSale") && !has("priceRent") && !has("price")))
    .map(([field, info]) => ({ field, label: info.label, level: info.level, hint: info.hint }));

  const unknown = new Map<string, number>();
  const bump = (col: string, v: string) => unknown.set(`${col}\u0000${v}`, (unknown.get(`${col}\u0000${v}`) ?? 0) + 1);

  const counts = { importable: 0, sinIdentificador: 0, identificadorRepetido: 0, operacionNoReconocida: 0, ambasOperaciones: 0, sinPrecio: 0, sinPortada: 0, sinZona: 0 };
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.some((v) => v.trim())) continue;
    const id = get(r, "externalId");
    if (!id) {
      counts.sinIdentificador++;
      continue;
    }
    if (seen.has(id)) {
      counts.identificadorRepetido++;
      continue;
    }
    seen.add(id);

    const c = cells(r);
    const opRaw = get(r, "operation");
    const op = opRaw ? parseOperation(opRaw) : inferOperation(c);
    if (!op) {
      if (opRaw && /venta/i.test(opRaw) && /alquiler|renta|rent/i.test(opRaw)) counts.ambasOperaciones++;
      else counts.operacionNoReconocida++;
      if (opRaw) bump("operación", opRaw);
      continue;
    }
    counts.importable++;
    const t = get(r, "propertyType");
    if (t && !parseType(t)) bump("tipo", t);
    const s = get(r, "status");
    if (s && !parseStatus(s)) bump("estado", s);
    if (!resolvePrice(op, c).price) counts.sinPrecio++;
    if (!get(r, "coverUrl") && !get(r, "coverPreview")) counts.sinPortada++;
    if (!get(r, "zone") && !get(r, "city")) counts.sinZona++;
  }

  return {
    rows: rows.length,
    mapped: m.recognized.map((x) => ({ header: x.header, field: x.field, label: labelOf(x.field), how: x.how })),
    unused: m.unrecognized,
    missing,
    unknownValues: [...unknown.entries()]
      .map(([k, count]) => ({ column: k.split("\u0000")[0] as "operación" | "tipo" | "estado", value: k.split("\u0000")[1], count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    counts,
  };
}

/** Todos los nombres que se aceptan para un campo, sin repetir, para mostrar como ayuda. */
export const acceptedNames = (field: Field) => COLUMNS[field].filter((a, i, arr) => arr.findIndex((b) => normalize(b) === normalize(a)) === i);
